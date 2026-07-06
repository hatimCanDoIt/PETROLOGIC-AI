"""LLM-driven petrophysics model tuner.

Asks Claude to read the computed curves and split the well into depth
regimes, choosing per regime the Vsh transform (linear / Larionov / Clavier /
Stieber), the Sw equation (Archie / Simandoux / Indonesia) and the Archie
parameters a / m / n. The returned ``Regime`` list is fed back into
``run_petrophysics`` — the LLM picks the *models*, the numpy engine still
does all the arithmetic.

On any failure an empty regime list is returned with an ``error`` in the
metadata, so the caller can fall back to the global parameters.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from ..config import settings
from .ai_shared import build_curve_csv, build_well_context, extract_json
from .petrophysics import SW_MODELS, VSH_MODELS, PetroResult, Regime

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a senior petrophysicist choosing the correct
computation models for a well-log analysis. You are given the computed curves
from a first-pass analysis (linear Vsh, Archie a=1 m=2 n=2). Split the log
into 1-6 depth regimes of consistent geology and, for each, choose:

  • vsh_model — one of: linear, larionov_tertiary, larionov_pre_tertiary,
    clavier, stieber.
    Larionov tertiary: young unconsolidated Tertiary clastics.
    Larionov pre-tertiary: older consolidated rocks.
    Clavier / Stieber: intermediate; Stieber is most aggressive at
    reducing Vsh. Linear: default / carbonates.
  • sw_model — one of: archie, simandoux, indonesia.
    Archie: clean rock (Vsh below ~0.15).
    Simandoux: shaly sands with saline formation water.
    Indonesia: shaly sands with fresh formation water (high Rw).
  • a, m, n — Archie parameters.
    m ≈ 1.7-1.9 unconsolidated sand, 2.0 consolidated sandstone,
    2.0-2.6 carbonates (vuggy porosity raises m). a ≈ 0.6-1.0 clastics,
    1.0 carbonates. n ≈ 2.0 unless the rock is oil-wet.
  • Rw (optional, ohm.m) — only if an interval clearly has different
    formation water than the global estimate. Omit otherwise.

Return STRICT JSON, nothing else:

  {
    "regimes": [
      {
        "top_ft": <number>, "bot_ft": <number>,
        "vsh_model": "<model>", "sw_model": "<model>",
        "a": <number>, "m": <number>, "n": <number>,
        "Rw": <number, optional>,
        "lithology": "<short label>",
        "rationale": "<1-2 sentences: what in the curves drove the choice>"
      }
    ],
    "well_summary": "<1-3 sentences>"
  }

Rules: regimes must be non-overlapping, bot_ft > top_ft, inside the supplied
depth range, covering at least the intervals that matter (gaps fall back to
global defaults). No markdown fences."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(v: Any, lo: float, hi: float) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not (lo <= f <= hi):
        return None
    return f


async def run_llm_regime_tuner(
    result: PetroResult,
    meta: dict,
    api_key: str | None = None,
    model: str | None = None,
    max_curve_rows: int = 3500,
) -> tuple[list[Regime], dict]:
    """Return ``(regimes, meta)``. ``regimes`` is empty on any failure."""
    key = api_key or settings.ANTHROPIC_API_KEY
    chosen_model = model or settings.ANTHROPIC_ZONE_PICKER_MODEL

    meta_out: dict[str, Any] = {
        "model": chosen_model,
        "generated_at": _now_iso(),
    }

    if not key:
        meta_out["error"] = "ANTHROPIC_API_KEY not configured."
        return [], meta_out

    try:
        import anthropic
    except ImportError as exc:
        meta_out["error"] = f"anthropic SDK not installed: {exc}"
        return [], meta_out

    context = build_well_context(result, meta)
    csv_text = build_curve_csv(result, max_rows=max_curve_rows)
    user_message = (
        "Choose the petrophysical computation regimes for this well. "
        "Respond with the JSON object specified in the system prompt and "
        "nothing else.\n\n"
        f"WELL_CONTEXT:\n{json.dumps(context, default=str, indent=2)}\n\n"
        f"CURVES_CSV:\n{csv_text}"
    )

    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        msg = await client.messages.create(
            model=chosen_model,
            max_tokens=4000,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        text_parts = [
            getattr(b, "text", "") or ""
            for b in (getattr(msg, "content", []) or [])
            if getattr(b, "type", None) == "text"
        ]
        raw_text = "\n".join(text_parts).strip()
    except Exception as exc:
        logger.exception("LLM regime tuner call failed")
        meta_out["error"] = str(exc)
        return [], meta_out

    parsed = extract_json(raw_text)
    if not parsed or "regimes" not in parsed:
        meta_out["error"] = "LLM did not return parseable {'regimes': [...]}"
        meta_out["raw_text"] = raw_text[:1500]
        return [], meta_out

    depth_min = float(result.depth.min()) if result.depth.size else 0.0
    depth_max = float(result.depth.max()) if result.depth.size else 0.0

    regimes: list[Regime] = []
    skipped: list[str] = []
    for raw in (parsed.get("regimes") or [])[:8]:
        try:
            top = float(raw.get("top_ft"))
            bot = float(raw.get("bot_ft"))
        except (TypeError, ValueError):
            skipped.append(f"unparseable regime: {raw!r}")
            continue
        top = max(top, depth_min)
        bot = min(bot, depth_max)
        if not bot > top:
            skipped.append(f"bad interval {top}-{bot}")
            continue
        vsh_model = str(raw.get("vsh_model") or "linear")
        if vsh_model not in VSH_MODELS:
            skipped.append(f"unknown vsh_model {vsh_model!r}")
            vsh_model = "linear"
        sw_model = raw.get("sw_model")
        if sw_model is not None and sw_model not in SW_MODELS:
            skipped.append(f"unknown sw_model {sw_model!r}")
            sw_model = None
        rw = _clamp(raw.get("Rw"), 0.005, 50.0) if raw.get("Rw") is not None else None
        regimes.append(
            Regime(
                top_ft=top,
                bot_ft=bot,
                vsh_model=vsh_model,
                sw_model=sw_model,
                a=_clamp(raw.get("a"), 0.5, 2.5),
                m=_clamp(raw.get("m"), 1.3, 3.0),
                n=_clamp(raw.get("n"), 1.2, 3.0),
                Rw=rw,
                lithology=str(raw.get("lithology", ""))[:120],
                rationale=str(raw.get("rationale", ""))[:600],
            )
        )

    regimes.sort(key=lambda r: r.top_ft)
    meta_out["regime_count"] = len(regimes)
    meta_out["regimes"] = [r.to_dict() for r in regimes]
    meta_out["well_summary"] = parsed.get("well_summary")
    if skipped:
        meta_out["skipped"] = skipped[:20]
    return regimes, meta_out
