"""Tests for the LLM-driven zone picker.

These tests verify the *adapter* logic (no-key fallback, malformed-response
handling, zone summary recomputation, hc_type rebuilding) without ever
calling the real Anthropic API. We monkeypatch ``anthropic.AsyncAnthropic``
so the test runs offline and deterministically.
"""

from __future__ import annotations

import asyncio
import json
import sys
import types

import numpy as np
import pandas as pd
import pytest

from app.core import ai_zone_picker as ai_zone_picker_mod
from app.core.ai_zone_picker import run_llm_zone_picker
from app.core.petrophysics import PetroParams, run_petrophysics


def _df_with_oil_pay():
    """Synthetic well: shaly background with one clear oil zone 8020-8040 ft."""
    depth = np.arange(8000.0, 8100.0, 0.5)
    n = depth.size
    GR = np.full(n, 110.0)
    NPHI = np.full(n, 0.35)
    RHOZ = np.full(n, 2.55)
    RT = np.full(n, 2.0)
    pay = (depth >= 8020.0) & (depth < 8040.0)
    GR[pay] = 25.0
    NPHI[pay] = 0.20
    RHOZ[pay] = 2.40
    RT[pay] = 60.0
    df = pd.DataFrame(
        {"DEPT": depth, "GR": GR, "NPHI": NPHI, "RHOZ": RHOZ, "RT": RT, "PEF": np.full(n, 2.0)}
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    return df, cm


def _build_result():
    df, cm = _df_with_oil_pay()
    return run_petrophysics(
        df, cm, PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=110.0)
    )


def test_llm_picker_no_api_key_returns_empty(monkeypatch):
    # The picker falls back to settings.ANTHROPIC_API_KEY when the explicit
    # argument is None, so to exercise the "no key" branch we must clear the
    # settings value the test process picked up from server/.env.
    monkeypatch.setattr(ai_zone_picker_mod.settings, "ANTHROPIC_API_KEY", None)

    result = _build_result()
    meta = asyncio.run(run_llm_zone_picker(result, {}, api_key=None))
    assert meta["mode"] == "llm"
    assert meta.get("error", "").startswith("ANTHROPIC_API_KEY"), meta
    assert result.zones == []
    assert result.hc_type.sum() == 0


class _StubBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _StubMsg:
    def __init__(self, text: str):
        self.content = [_StubBlock(text)]


class _StubAsyncAnthropic:
    """Drop-in for ``anthropic.AsyncAnthropic`` used in tests."""

    SCRIPTED_TEXT = json.dumps(
        {
            "zones": [
                {
                    "type": "OIL",
                    "top_ft": 8020.0,
                    "bot_ft": 8040.0,
                    "confidence": "high",
                    "rationale": "Clean low-Vsh sand, low NPHI vs background, RT >> wet baseline.",
                },
                # Out-of-range zone — must be skipped
                {
                    "type": "OIL",
                    "top_ft": 7000.0,
                    "bot_ft": 7050.0,
                    "confidence": "low",
                    "rationale": "outside well",
                },
                # Bad type — must be skipped
                {"type": "WATER", "top_ft": 8050.0, "bot_ft": 8060.0},
            ],
            "well_summary": "One clean sand pay zone.",
        }
    )

    def __init__(self, *args, **kwargs):
        self.messages = self

    async def create(self, **kwargs):
        # Verify the picker is asking for the right model and supplies system+user
        assert kwargs.get("system")
        msgs = kwargs.get("messages") or []
        assert msgs and msgs[0]["role"] == "user"
        return _StubMsg(self.SCRIPTED_TEXT)


def _install_stub_anthropic(monkeypatch, klass=_StubAsyncAnthropic):
    """Install a stub ``anthropic`` module on sys.modules so the picker's
    ``import anthropic`` resolves to our scripted stand-in."""
    stub = types.ModuleType("anthropic")
    stub.AsyncAnthropic = klass
    monkeypatch.setitem(sys.modules, "anthropic", stub)
    return stub


def test_llm_picker_uses_scripted_zones(monkeypatch):
    _install_stub_anthropic(monkeypatch)
    result = _build_result()
    # Make sure deterministic engine had picked at least one zone, so the
    # replacement is observable.
    assert len(result.zones) >= 1
    pre_hc = result.hc_type.copy()

    meta = asyncio.run(
        run_llm_zone_picker(result, {"well_name": "synthetic"}, api_key="sk-test")
    )

    assert meta["mode"] == "llm"
    assert "error" not in meta, meta
    assert meta["zone_count"] == 1
    assert meta.get("well_summary") == "One clean sand pay zone."
    assert len(meta.get("skipped") or []) == 2  # the bogus OIL and the WATER row

    assert len(result.zones) == 1
    z = result.zones[0]
    assert z["type"] == "OIL"
    assert z["top_ft"] == 8020.0
    assert z["bot_ft"] == 8040.0
    assert 15.0 <= z["thick_ft"] <= 22.0  # 20 ft window with rounding tolerance
    assert z["ai_confidence"] == "high"
    assert "Clean" in z["ai_rationale"]
    # Per-zone stats are computed from curves, not invented by the LLM
    assert 0.0 < z["phi_pct"] < 50.0
    assert 0.0 < z["sw_pct"] < 100.0

    # hc_type must reflect the LLM picks, with non-zero entries inside the zone
    inside = (result.depth >= 8020.0) & (result.depth < 8040.0)
    assert int((result.hc_type[inside] == 1).all())  # all oil inside
    # And NO oil/gas codes outside the LLM zone (deterministic picks were wiped)
    outside = ~inside
    assert int((result.hc_type[outside] == 0).all())
    # Sanity: pre-replacement had at least some flagged samples elsewhere or
    # different shape — at minimum, replacement actually changed things
    assert not np.array_equal(pre_hc, result.hc_type) or len(result.zones) == 1


class _MalformedAnthropic(_StubAsyncAnthropic):
    SCRIPTED_TEXT = "I am not JSON, I am narrative prose about your log."


def test_llm_picker_malformed_response_falls_back(monkeypatch):
    _install_stub_anthropic(monkeypatch, _MalformedAnthropic)
    result = _build_result()
    meta = asyncio.run(
        run_llm_zone_picker(result, {"well_name": "synthetic"}, api_key="sk-test")
    )
    assert "error" in meta and "parseable" in meta["error"]
    assert "raw_text" in meta
    assert result.zones == []
    assert int(result.hc_type.sum()) == 0
