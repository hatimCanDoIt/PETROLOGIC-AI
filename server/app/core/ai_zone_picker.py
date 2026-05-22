"""LLM-driven hydrocarbon zone picker.

This module provides an alternative to the deterministic ``_find_intervals``
flow in ``petrophysics.py``. Given a fully-computed ``PetroResult`` (curves
already calculated; only the zones list is replaced) it asks Claude (Sonnet 4.6
by default) to read the curves and pick pay zones the way a senior
petrophysicist would.

We deliberately do NOT let the LLM compute saturations, porosities, etc.
The LLM is only responsible for **where** the pay zones are and **what
fluid** is in them; the per-zone numerical summary (avg Vsh, avg Sw, etc.)
is recomputed from the actual curves using ``summarize_zone_from_result``.
That keeps the engine consistent across modes — only the zone *picking* is
delegated, not the arithmetic.

If the API key is missing or the call fails, ``run_llm_zone_picker`` returns
an empty zone list with an explanatory warning so the rest of the pipeline
still produces a usable report.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np

from ..config import settings
from .ai_shared import build_curve_csv, build_well_context, extract_json
from .petrophysics import PetroResult, hc_type_from_zones, summarize_zone_from_result

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a senior petrophysicist with 25+ years picking pay
zones from open-hole well logs in clastic and carbonate reservoirs. Given the
already-computed curves below, identify hydrocarbon (oil or gas) pay zones.

Apply the following physics:

  • Clean reservoir rock: Vsh below the user's cutoff (typical 0.30 - 0.40).
  • Adequate effective porosity: phi_eff above the user's cutoff (typical 0.06 - 0.10).
  • Hydrocarbon-bearing: Sw below the user's cutoff (typical 0.40 - 0.50) AND
    deep resistivity (RT) clearly above the wet-rock baseline (Rt cutoff
    typically 5 - 20 ohm.m).
  • Gas signature: density-derived porosity DPHI greater than neutron porosity
    NPHI by ~0.03 v/v (gas crossover). Otherwise treat the zone as oil.
  • Reject false positives: shallow fresh-water sand can look porous and
    moderately resistive yet still be wet — require a clear contrast with
    surrounding wet rock and a plausible Sw < cutoff.
  • Bridge data drop-outs <= ~1.5 ft inside an otherwise pay-flagged interval.
  • Each zone must be at least 3 ft thick.
  • Bottom-hole temperature, mud invasion, and bad-hole effects can perturb
    individual samples — judge zones, not samples.

Return STRICT JSON with this exact schema (and nothing else):

  {
    "zones": [
      {
        "type": "OIL" | "GAS",
        "top_ft": <number>,
        "bot_ft": <number>,
        "confidence": "high" | "medium" | "low",
        "rationale": "<1-3 sentences explaining the call: which curves moved,
                       why you ruled out shale/wet-rock alternatives>"
      },
      ...
    ],
    "well_summary": "<2-4 sentences on the overall reservoir character>"
  }

Rules:
  - top_ft and bot_ft must be in feet, monotonic (bot > top), non-overlapping,
    and inside the supplied depth range.
  - Use the full precision available in the curve table (depth steps may be
    2-3 ft after downsampling).
  - Do not invent zones; if no pay is present, return an empty array.
  - No prose outside the JSON. No markdown fences. No backticks."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_llm_zone_picker(
    result: PetroResult,
    meta: dict,
    api_key: str | None = None,
    model: str | None = None,
    max_curve_rows: int = 3500,
) -> dict:
    """Replace ``result.zones`` (and ``result.hc_type``) with LLM-driven picks.

    Mutates ``result`` in place. Returns a metadata dict suitable for
    persisting alongside the zones (model used, raw rationale, generated_at).

    On failure, ``result.zones`` is set to an empty list and the returned
    dict carries an ``error`` field — callers should still serve the report,
    just with no zones.
    """
    key = api_key or settings.ANTHROPIC_API_KEY
    chosen_model = model or settings.ANTHROPIC_ZONE_PICKER_MODEL

    meta_out: dict[str, Any] = {
        "model": chosen_model,
        "generated_at": _now_iso(),
        "mode": "llm",
    }

    if not key:
        result.zones = []
        result.hc_type = np.zeros(result.depth.size, dtype=np.int8)
        meta_out["error"] = "ANTHROPIC_API_KEY not configured."
        return meta_out

    try:
        import anthropic
    except ImportError as exc:
        result.zones = []
        result.hc_type = np.zeros(result.depth.size, dtype=np.int8)
        meta_out["error"] = f"anthropic SDK not installed: {exc}"
        return meta_out

    context = build_well_context(result, meta)
    csv_text = build_curve_csv(result, max_rows=max_curve_rows)
    user_message = (
        "Read the well context and the supplied curve table and pick all "
        "pay zones. Respond with the JSON object specified in the system "
        "prompt and nothing else.\n\n"
        f"WELL_CONTEXT:\n{json.dumps(context, default=str, indent=2)}\n\n"
        f"CURVES_CSV (header row, then one sample per line; "
        f"{csv_text.count(chr(10))} rows):\n{csv_text}"
    )

    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        msg = await client.messages.create(
            model=chosen_model,
            max_tokens=8000,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )
        text_parts: list[str] = []
        for block in getattr(msg, "content", []) or []:
            if getattr(block, "type", None) == "text":
                text_parts.append(getattr(block, "text", "") or "")
        raw_text = "\n".join(text_parts).strip()
    except Exception as exc:
        logger.exception("LLM zone picker call failed")
        result.zones = []
        result.hc_type = np.zeros(result.depth.size, dtype=np.int8)
        meta_out["error"] = str(exc)
        return meta_out

    parsed = extract_json(raw_text)
    if not parsed or "zones" not in parsed:
        result.zones = []
        result.hc_type = np.zeros(result.depth.size, dtype=np.int8)
        meta_out["error"] = "LLM did not return parseable {'zones': [...] }"
        meta_out["raw_text"] = raw_text[:1500]
        return meta_out

    well_summary = parsed.get("well_summary")
    raw_zones = parsed.get("zones") or []

    depth_min = float(result.depth.min()) if result.depth.size else 0.0
    depth_max = float(result.depth.max()) if result.depth.size else 0.0

    accepted: list[dict] = []
    skipped: list[str] = []
    for raw in raw_zones:
        try:
            ztype = str(raw.get("type", "")).upper()
            top = float(raw.get("top_ft"))
            bot = float(raw.get("bot_ft"))
            confidence = str(raw.get("confidence", "medium")).lower()
            rationale = str(raw.get("rationale", ""))[:600]
        except (TypeError, ValueError):
            skipped.append(f"unparseable zone: {raw!r}")
            continue
        if ztype not in ("OIL", "GAS"):
            skipped.append(f"unknown type {ztype!r}")
            continue
        if not (np.isfinite(top) and np.isfinite(bot) and bot > top):
            skipped.append(f"non-monotonic depths {top}->{bot}")
            continue
        # Clamp to the well's depth range to avoid out-of-domain hallucinations
        top = max(top, depth_min)
        bot = min(bot, depth_max)
        if bot - top < 0.5:
            skipped.append(f"out-of-range or degenerate zone {top}-{bot}")
            continue
        zd = summarize_zone_from_result(
            result, top_ft=top, bot_ft=bot, zone_type=ztype
        )
        if zd is None:
            skipped.append(f"no curve samples in {top}-{bot}")
            continue
        zd["ai_confidence"] = (
            confidence if confidence in ("high", "medium", "low") else "medium"
        )
        zd["ai_rationale"] = rationale
        accepted.append(zd)

    accepted.sort(key=lambda z: z["top_ft"])

    # Replace what the deterministic engine produced with the LLM picks.
    result.zones = accepted
    result.hc_type = hc_type_from_zones(result.depth, accepted)

    meta_out["zone_count"] = len(accepted)
    meta_out["well_summary"] = well_summary
    if skipped:
        meta_out["skipped"] = skipped[:20]
    return meta_out
