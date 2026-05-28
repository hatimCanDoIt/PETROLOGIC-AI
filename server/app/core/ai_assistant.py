"""Interactive AI assistant for zone picks and depth-interval explanations.

Stateless multi-turn chat: the client sends message history plus context
identifiers (zone id or depth interval). Each call rebuilds curve context
from stored log data and calls Claude.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import numpy as np

from ..config import settings
from .ai_shared import build_curve_csv, build_well_context, extract_json
from .petrophysics import PetroResult, summarize_zone_from_result

logger = logging.getLogger(__name__)

ContextType = Literal["zone", "interval"]

DISCLAIMER = (
    "This AI-generated interpretation requires validation by a licensed "
    "petrophysicist before use in any well or business decision."
)

SYSTEM_PROMPT = """You are a senior petrophysicist assisting a colleague who is \
reviewing a well log in PETROLOGIC AI.

The deterministic engine has already computed porosity, saturations, Vsh, lithology, \
and pay-zone picks. Do NOT recalculate petrophysical properties — interpret the \
numbers and log character provided.

You may be asked about:
  • An existing pay zone (why it was picked, fluid type, risks).
  • A user-selected depth interval that is NOT yet a pay zone (general log character, \
    whether it could be pay, what data support or contradict pay).

When the user discusses adding a new pay zone, you may propose one ONLY if the \
evidence in the curves supports it. Use the exact depth interval under discussion.

Your reply must be valid JSON matching this schema:
{
  "reply": "string — conversational answer (markdown-lite: short paragraphs, bullet lists ok)",
  "proposed_zone": null | {
    "zone_type": "OIL" | "GAS",
    "top_ft": number,
    "bot_ft": number,
    "rationale": "string — why add this zone",
    "confidence": "high" | "medium" | "low"
  }
}

Rules:
  • Set proposed_zone only when you believe the interval should be added as HC pay \
    AND the user is discussing that interval (or explicitly asks to add it).
  • top_ft/bot_ft must lie within the interval context and match what the user selected.
  • Be concise but technically precise. Reference specific curves (GR, RT, NPHI, DPHI, Sw, PEF).
  • If ANTHROPIC or data is insufficient, explain what is missing in reply and leave \
    proposed_zone null.
  • Respond with ONLY the JSON object — no markdown fences."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _zone_dict_from_orm(zone: Any) -> dict[str, Any]:
    return {
        "id": zone.id,
        "zone_type": zone.zone_type,
        "top_ft": zone.top_ft,
        "bot_ft": zone.bot_ft,
        "thick_ft": zone.thick_ft,
        "shc_pct": zone.shc_pct,
        "sw_pct": zone.sw_pct,
        "phi_pct": zone.phi_pct,
        "rt_mean": zone.rt_mean,
        "gr_mean": zone.gr_mean,
        "vsh_pct": zone.vsh_pct,
        "pef_mean": zone.pef_mean,
        "bvw_mean": zone.bvw_mean,
        "producible_pct": zone.producible_pct,
        "lith_flag": zone.lith_flag,
        "ai_note": zone.ai_note,
        "ai_rationale": zone.ai_rationale,
        "ai_confidence": zone.ai_confidence,
    }


def _zone_ai_snippet(ai: dict | None, zone_index: int) -> dict | None:
    if not isinstance(ai, dict):
        return None
    for entry in ai.get("zone_interpretations") or []:
        try:
            idx = int(entry.get("zone_index", -1))
        except (TypeError, ValueError):
            continue
        if idx == zone_index:
            return entry
    return None


def build_curve_csv_depth_window(
    result: PetroResult,
    top_ft: float,
    bot_ft: float,
    *,
    max_rows: int = 1200,
) -> str:
    """CSV of curves limited to [top_ft, bot_ft] for the assistant."""
    return build_curve_csv(result, max_rows=max_rows, top_ft=top_ft, bot_ft=bot_ft)


def build_assistant_context(
    result: PetroResult,
    meta: dict,
    *,
    context_type: ContextType,
    zone: Any | None = None,
    zone_index: int | None = None,
    top_ft: float | None = None,
    bot_ft: float | None = None,
    ai_interpretation: dict | None = None,
    all_zones: list[Any] | None = None,
) -> dict[str, Any]:
    """Bundle sent to Claude on every explain/chat turn."""
    ctx: dict[str, Any] = {
        "context_type": context_type,
        "well_context": build_well_context(result, meta),
        "existing_pay_zones": [
            _zone_dict_from_orm(z) for z in (all_zones or [])
        ],
    }

    if context_type == "zone" and zone is not None:
        t_top, t_bot = float(zone.top_ft), float(zone.bot_ft)
        ctx["focus"] = {
            "kind": "existing_zone",
            "zone": _zone_dict_from_orm(zone),
            "zone_index": zone_index,
            "ai_interpretation": _zone_ai_snippet(ai_interpretation, zone_index or 0),
            "interval_stats": summarize_zone_from_result(
                result,
                top_ft=t_top,
                bot_ft=t_bot,
                zone_type=str(zone.zone_type),
            ),
            "curve_csv": build_curve_csv_depth_window(result, t_top, t_bot),
        }
    elif context_type == "interval" and top_ft is not None and bot_ft is not None:
        lo, hi = float(min(top_ft, bot_ft)), float(max(top_ft, bot_ft))
        # Infer likely fluid from gas crossover in window
        mask = (result.depth >= lo) & (result.depth < hi)
        gas_xover = False
        if np.any(mask):
            dphi = result.DPHI[mask]
            nphi = result.NPHI[mask]
            finite = np.isfinite(dphi) & np.isfinite(nphi)
            if np.any(finite):
                gas_xover = bool(np.nanmean(dphi[finite] - nphi[finite]) > 0.03)
        probe_type = "GAS" if gas_xover else "OIL"
        ctx["focus"] = {
            "kind": "depth_interval",
            "top_ft": lo,
            "bot_ft": hi,
            "thickness_ft": round(hi - lo, 2),
            "interval_stats_if_pay": summarize_zone_from_result(
                result,
                top_ft=lo,
                bot_ft=hi,
                zone_type=probe_type,
            ),
            "curve_csv": build_curve_csv_depth_window(result, lo, hi),
            "overlapping_zones": [
                _zone_dict_from_orm(z)
                for z in (all_zones or [])
                if z.bot_ft > lo and z.top_ft < hi
            ],
        }
    return ctx


def _fallback_reply(reason: str) -> dict[str, Any]:
    return {
        "reply": (
            f"AI assistant is unavailable ({reason}). "
            "Check that ANTHROPIC_API_KEY is configured on the server."
        ),
        "proposed_zone": None,
        "error": reason,
        "generated_at": _now_iso(),
        "disclaimer": DISCLAIMER,
    }


async def _call_claude(
    context: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    key = api_key or settings.ANTHROPIC_API_KEY
    if not key:
        return _fallback_reply("ANTHROPIC_API_KEY not configured")

    try:
        import anthropic
    except ImportError as exc:
        return _fallback_reply(f"anthropic SDK not installed: {exc}")

    user_blocks = [
        {
            "role": "user",
            "content": (
                "CONTEXT_BUNDLE:\n"
                + json.dumps(context, default=str, indent=2)
                + "\n\nUse the context above. Follow the JSON schema in the system prompt."
            ),
        }
    ]
    for m in messages:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            continue
        user_blocks.append({"role": role, "content": m.get("content", "")})

    try:
        client = anthropic.AsyncAnthropic(api_key=key)
        msg = await client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=4096,
            temperature=0.2,
            system=SYSTEM_PROMPT,
            messages=user_blocks,
        )
        parts: list[str] = []
        for block in getattr(msg, "content", []) or []:
            if getattr(block, "type", None) == "text":
                parts.append(getattr(block, "text", "") or "")
        raw = "\n".join(parts).strip()
        parsed = extract_json(raw)
        if parsed is None:
            return {
                "reply": raw or "I could not produce a structured response.",
                "proposed_zone": None,
                "generated_at": _now_iso(),
                "disclaimer": DISCLAIMER,
                "model": settings.ANTHROPIC_MODEL,
            }
        parsed.setdefault("reply", "")
        parsed.setdefault("proposed_zone", None)
        parsed["generated_at"] = _now_iso()
        parsed["disclaimer"] = DISCLAIMER
        parsed["model"] = settings.ANTHROPIC_MODEL
        return parsed
    except Exception as exc:
        logger.exception("Assistant chat failed")
        return _fallback_reply(str(exc))


async def assistant_explain(
    context: dict[str, Any],
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Initial explanation for a zone or interval."""
    if context.get("context_type") == "zone":
        prompt = (
            "Explain why this pay zone was picked (or would have been picked), "
            "the fluid type reasoning, key risks, and how the curves support your view. "
            "Be specific to this depth interval."
        )
    else:
        prompt = (
            "The user selected this depth interval on the log. Describe the general "
            "log character (lithology, porosity, saturation, resistivity), whether it "
            "resembles pay, and what would strengthen or weaken a pay case. "
            "Do not propose adding a zone unless the evidence is clearly supportive."
        )
    return await _call_claude(context, [{"role": "user", "content": prompt}], api_key=api_key)


async def assistant_chat(
    context: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Follow-up turn in an existing assistant thread."""
    if not messages:
        return _fallback_reply("No messages provided")
    return await _call_claude(context, messages, api_key=api_key)
