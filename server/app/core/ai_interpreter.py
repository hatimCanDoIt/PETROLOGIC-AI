"""Claude-based AI interpretation layer.

Given the deterministic ``PetroResult`` and well metadata, this module produces
a JSON-structured "senior petrophysicist" review. The deterministic numbers
(Sw, Vsh, porosity, zone picks) are passed in and Claude is instructed NOT to
recompute them — only to interpret them geologically.

If the Claude API key is missing or the call fails, ``get_ai_interpretation``
returns a structured error dict so the rest of the report can still render.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from ..config import settings
from .petrophysics import PetroResult

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are a senior petrophysicist with 25+ years of experience \
analyzing well logs in Gulf Coast carbonate and clastic reservoirs, with deep \
expertise in Tuscaloosa Formation, lower Cretaceous carbonates, and mixed \
carbonate-clastic sequences.

You are reviewing computed petrophysical results from a deterministic analysis \
engine. The numbers (Sw, Vsh, porosity, zone picks) are already computed — do \
NOT recalculate them. Your job is to interpret what the numbers mean geologically \
and from a reservoir engineering perspective.

Your response must be valid JSON matching exactly this schema:
{
  "well_narrative": "string - 3-5 sentence overall interpretation of this well",
  "reservoir_context": "string - what formation/depositional environment is likely based on the log character",
  "zone_interpretations": [
    {
      "zone_index": 0,
      "fluid_type_confidence": "high|medium|low",
      "interpretation": "string - 2-3 sentences interpreting this specific zone",
      "producibility_assessment": "string - 1-2 sentences on expected flow behavior",
      "concerns": ["list of specific technical concerns or caveats"],
      "recommended_actions": ["list of follow-up tests or data needed"]
    }
  ],
  "data_quality_flags": [
    {
      "severity": "warning|critical",
      "curve": "curve mnemonic or 'general'",
      "message": "specific data quality concern"
    }
  ],
  "lithology_summary": "string - overall lithology interpretation for the well",
  "overall_confidence": "high|medium|low",
  "overall_confidence_reason": "string - why this confidence level",
  "disclaimer": "This AI-generated interpretation requires validation by a licensed petrophysicist before use in any well or business decision."
}

Be technically precise. Use proper petrophysics and geology terminology. \
Flag any inconsistencies in the data (e.g. high PEF + high porosity is unusual \
for a clean reservoir, very high NPHI may indicate vuggy porosity or gas effect, \
low BVW in a high-phi zone supports producibility). \
If a zone has PEF > 5.5, always flag potential heavy mineral or borehole effect. \
Always include the disclaimer field exactly as specified. \
Respond with ONLY the JSON object — no preface, no markdown fences."""


DISCLAIMER = (
    "This AI-generated interpretation requires validation by a licensed "
    "petrophysicist before use in any well or business decision."
)


# ---------------------------------------------------------------------------
# Payload construction
# ---------------------------------------------------------------------------


def build_analysis_payload(result: PetroResult, meta: dict) -> dict:
    """Build a compact summary dict to feed to Claude. No raw arrays."""
    depth_start = float(result.depth[0]) if len(result.depth) else 0.0
    depth_stop = float(result.depth[-1]) if len(result.depth) else 0.0

    return {
        "well_metadata": {
            "well_name": meta.get("well_name"),
            "field": meta.get("field"),
            "operator": meta.get("operator"),
            "log_date": meta.get("log_date"),
            "depth_interval_ft": [depth_start, depth_stop],
            "total_depth_ft": float(depth_stop - depth_start),
            "curves_available": meta.get("curves_available", []),
        },
        "petrophysical_parameters": {
            "matrix_density_gcc": result.params_used.rho_ma,
            "Rw_ohmm": result.params_used.Rw,
            "archie_a": result.params_used.a,
            "archie_m": result.params_used.m,
            "archie_n": result.params_used.n,
            "GR_clean_gapi": round(result.GR_clean, 2),
            "GR_shale_gapi": round(result.GR_shale, 2),
            "Rt_cutoff_ohmm": result.params_used.Rt_cutoff,
            "Shc_cutoff_fraction": result.params_used.Shc_cutoff,
        },
        "well_statistics": {
            "mean_GR_gapi": round(result.mean_GR, 1),
            "mean_Rt_ohmm": round(result.mean_RT, 2),
            "mean_NPHI_fraction": round(result.mean_NPHI, 3),
            "mean_phi_eff_fraction": round(result.mean_phi_eff, 3),
            "mean_Sw_fraction": round(result.mean_Sw, 3),
            "pef_lithology_distribution_pct": result.pef_distribution,
            "total_hc_zones_detected": len(result.zones),
            "oil_zones": len([z for z in result.zones if z["type"] == "OIL"]),
            "gas_zones": len([z for z in result.zones if z["type"] == "GAS"]),
        },
        "hc_zones": [
            {
                "zone_index": i,
                "type": z["type"],
                "depth_interval_ft": [z["top_ft"], z["bot_ft"]],
                "gross_thickness_ft": z["thick_ft"],
                "mean_Shc_pct": z["shc_pct"],
                "mean_Sw_pct": z["sw_pct"],
                "mean_phi_eff_pct": z["phi_pct"],
                "mean_Rt_ohmm": z["rt_mean"],
                "mean_GR_gapi": z["gr_mean"],
                "mean_Vsh_pct": z["vsh_pct"],
                "mean_PEF": z["pef_mean"],
                "mean_BVW": z["bvw_mean"],
                "producible_fraction_pct": z["producible_pct"],
                "dominant_lithology": z["lith_flag"],
                "hc_pore_volume_index": z["hc_pore_vol_index"],
                "gas_crossover_detected": z["type"] == "GAS",
            }
            for i, z in enumerate(result.zones)
        ],
        "data_quality_indicators": {
            "pef_anomaly_zones": [
                f"{z['top_ft']:.0f}-{z['bot_ft']:.0f} ft (PEF={z['pef_mean']:.1f})"
                for z in result.zones
                if z["pef_mean"] > 5.5 or z["pef_mean"] < 1.0
            ],
            "high_nphi_zones": "present" if result.mean_NPHI > 0.40 else "not flagged",
            "low_rt_background": "yes" if result.mean_RT < 2.0 else "no",
        },
    }


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _strip_json_fence(text: str) -> str:
    """Remove ```json ... ``` fences if present."""
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def _repair_json_text(text: str) -> str:
    """Fix common LLM JSON mistakes before parsing."""
    cleaned = _strip_json_fence(text)
    cleaned = cleaned.replace("\ufeff", "").strip()
    # Strip trailing commas before } or ]
    cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
    return cleaned


def _extract_json(text: str) -> dict | None:
    """Best-effort JSON extraction from a model response."""
    candidates = [_repair_json_text(text)]
    start = candidates[0].find("{")
    end = candidates[0].rfind("}")
    if start != -1 and end > start:
        candidates.append(candidates[0][start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            continue
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fallback_error(reason: str, payload: dict | None = None) -> dict:
    return {
        "error": "AI interpretation unavailable",
        "reason": reason,
        "generated_at": _now_iso(),
        "disclaimer": DISCLAIMER,
        "payload_preview": payload,
    }


async def get_ai_interpretation(
    result: PetroResult,
    meta: dict,
    api_key: str | None = None,
) -> dict:
    """Call Claude to interpret the deterministic analysis.

    Returns a dict that always contains ``generated_at`` and ``disclaimer``.
    On any failure, returns ``{"error": ..., "reason": ...}`` so callers can
    safely persist the result and still serve the rest of the report.
    """
    key = api_key or settings.ANTHROPIC_API_KEY
    payload = build_analysis_payload(result, meta)

    if not key:
        return _fallback_error("ANTHROPIC_API_KEY not configured.", payload)

    try:
        import anthropic
    except ImportError as exc:
        return _fallback_error(f"anthropic SDK not installed: {exc}", payload)

    try:
        client = anthropic.AsyncAnthropic(api_key=key, timeout=45.0, max_retries=1)
        zone_count = len(payload.get("hc_zones") or [])
        brevity = ""
        if zone_count > 8:
            brevity = (
                f"\n\nThere are {zone_count} HC zones. Keep each "
                "zone_interpretations entry to 1-2 concise sentences so the "
                "full JSON fits in the response."
            )
        user_message = (
            "Interpret the following deterministic petrophysical analysis. "
            "Return the JSON object specified in the system prompt and nothing "
            "else."
            + brevity
            + "\n\nANALYSIS_PAYLOAD:\n"
            + json.dumps(payload, default=str, indent=2)
        )
        msg = await client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=8192,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        # Gather text from all text blocks
        text_parts: list[str] = []
        for block in getattr(msg, "content", []) or []:
            if getattr(block, "type", None) == "text":
                text_parts.append(getattr(block, "text", "") or "")
        raw_text = "\n".join(text_parts).strip()

        parsed: dict[str, Any] | None = _extract_json(raw_text)
        if parsed is None and raw_text:
            retry = await client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=8192,
                temperature=0,
                system=SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": user_message},
                    {"role": "assistant", "content": raw_text},
                    {
                        "role": "user",
                        "content": (
                            "Your previous reply was not valid JSON. Return ONLY "
                            "a corrected JSON object matching the schema — no "
                            "markdown fences, no commentary."
                        ),
                    },
                ],
            )
            retry_parts: list[str] = []
            for block in getattr(retry, "content", []) or []:
                if getattr(block, "type", None) == "text":
                    retry_parts.append(getattr(block, "text", "") or "")
            raw_text = "\n".join(retry_parts).strip()
            parsed = _extract_json(raw_text)

        if parsed is None:
            logger.warning(
                "AI interpretation JSON parse failed (len=%s): %s",
                len(raw_text),
                raw_text[:500],
            )
            return {
                "error": "AI returned non-JSON response",
                "reason": "Could not parse model output as JSON.",
                "raw_text": raw_text,
                "generated_at": _now_iso(),
                "disclaimer": DISCLAIMER,
            }

        parsed.setdefault("disclaimer", DISCLAIMER)
        parsed["generated_at"] = _now_iso()
        parsed["model"] = settings.ANTHROPIC_MODEL
        return parsed

    except Exception as exc:  # network, auth, rate limit, etc.
        logger.exception("Claude interpretation failed")
        return _fallback_error(str(exc), payload)
