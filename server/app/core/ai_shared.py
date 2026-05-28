"""Shared utilities for the LLM-driven analysis modes.

The LLM zone picker (``ai_zone_picker``) and interpreter share these blocks:

  * downsample the curve grid to a row budget the model can handle,
  * format curve cells as a tolerant CSV (empty for NaN),
  * build the same well-context JSON for the system message,
  * strip code fences and recover JSON from the model's reply.

These helpers live here so the picker modules stay focused on what's
actually different about each mode (zones / regimes / curves).
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from .petrophysics import PetroResult


CURVE_FIELDS = [
    "depth", "GR", "RT", "NPHI", "DPHI", "RHOZ", "PEF", "SP",
    "Vsh", "phi_eff", "Sw", "Shc",
]


def downsample_indices(n: int, max_rows: int) -> np.ndarray:
    if n <= max_rows:
        return np.arange(n)
    return np.linspace(0, n - 1, max_rows).astype(int)


def fmt_cell(v: float, decimals: int = 3) -> str:
    if v is None or not np.isfinite(v):
        return ""
    return f"{round(float(v), decimals)}"


def build_curve_csv(
    result: PetroResult,
    max_rows: int = 3500,
    *,
    fields: list[str] | None = None,
    include_lith: bool = True,
    top_ft: float | None = None,
    bot_ft: float | None = None,
) -> str:
    """Compact CSV-like view of the curves for the LLM.

    Missing values are emitted as empty cells (tolerated by the model
    better than literal ``NaN`` tokens, which sometimes leak into JSON
    output and break parsing).
    """
    use_fields = fields or CURVE_FIELDS
    depth = result.depth
    if top_ft is not None and bot_ft is not None:
        lo, hi = float(min(top_ft, bot_ft)), float(max(top_ft, bot_ft))
        window = (depth >= lo) & (depth <= hi)
        if not np.any(window):
            return ",".join(use_fields + (["lith"] if include_lith else []))
        depth = depth[window]
        n = depth.size
        row_idx = downsample_indices(n, max_rows)
        full_idx = np.where(window)[0][row_idx]
    else:
        n = depth.size
        full_idx = downsample_indices(n, max_rows)
    idx = full_idx
    arrays: dict[str, tuple[np.ndarray, int]] = {
        "depth": (result.depth, 2),
        "GR": (result.GR, 1),
        "RT": (result.RT, 3),
        "NPHI": (result.NPHI, 4),
        "DPHI": (result.DPHI, 4),
        "RHOZ": (result.RHOZ, 4),
        "PEF": (result.PEF, 2),
        "SP": (result.SP, 1),
        "Vsh": (result.Vsh, 3),
        "phi_eff": (result.phi_eff, 4),
        "Sw": (result.Sw, 3),
        "Shc": (result.Shc, 3),
    }
    lith_label_map = {0: "ss", 1: "dol", 2: "ls", 3: "?"}

    header_cols = list(use_fields)
    if include_lith:
        header_cols.append("lith")
    out_lines = [",".join(header_cols)]
    for i in idx:
        cells = []
        for col in use_fields:
            arr, dec = arrays[col]
            cells.append(fmt_cell(arr[i], dec))
        if include_lith:
            cells.append(lith_label_map.get(int(result.lith_flag[i]), "?"))
        out_lines.append(",".join(cells))
    return "\n".join(out_lines)


def build_well_context(result: PetroResult, meta: dict) -> dict[str, Any]:
    p = result.params_used
    return {
        "well_metadata": {
            "well_name": meta.get("well_name"),
            "field": meta.get("field"),
            "operator": meta.get("operator"),
            "log_date": meta.get("log_date"),
            "depth_interval_ft": [
                float(result.depth.min()) if result.depth.size else 0.0,
                float(result.depth.max()) if result.depth.size else 0.0,
            ],
            "curves_available": meta.get("curves_available", []),
        },
        "petrophysics_parameters_used": {
            "rho_ma_gcc": p.rho_ma,
            "Rw_ohmm": p.Rw,
            "archie_a": p.a,
            "archie_m": p.m,
            "archie_n": p.n,
            "GR_clean_gapi": round(float(result.GR_clean), 2),
            "GR_shale_gapi": round(float(result.GR_shale), 2),
            "auto_estimated_rho_ma": bool(result.rho_ma_auto),
            "auto_estimated_Rw": bool(result.Rw_auto),
        },
        "user_pay_cutoffs": {
            "Vsh_max": p.Vsh_cutoff,
            "phi_eff_min": p.phi_cutoff,
            "Sw_max_for_pay": round(1.0 - p.Shc_cutoff, 4),
            "Rt_min_ohmm": p.Rt_cutoff,
            "Sw_max_for_producible": p.Sw_producible,
        },
        "well_statistics": {
            "mean_GR_gapi": round(float(result.mean_GR), 1),
            "mean_RT_ohmm": round(float(result.mean_RT), 2),
            "mean_NPHI_fraction": round(float(result.mean_NPHI), 3),
            "mean_phi_eff_fraction": round(float(result.mean_phi_eff), 3),
            "mean_Sw_fraction": round(float(result.mean_Sw), 3),
            "lithology_distribution_pct": result.pef_distribution,
        },
        "curve_legend": {
            "depth": "feet (MD)",
            "GR": "gamma ray (gAPI)",
            "RT": "deep resistivity (ohm.m)",
            "NPHI": "neutron porosity (v/v)",
            "DPHI": "density-derived porosity (v/v)",
            "RHOZ": "bulk density (g/cc)",
            "PEF": "photoelectric factor (b/e)",
            "SP": "spontaneous potential (mV)",
            "Vsh": "shale volume (v/v, 0-1)",
            "phi_eff": "effective porosity (v/v)",
            "Sw": "water saturation (v/v) — empty cell = NaN, treat as 'unknown' (typically tight rock)",
            "Shc": "hydrocarbon saturation (v/v) — empty cell = NaN",
            "lith": "PEF-derived lithology label: ss=sandstone, dol=dolomite, ls=limestone, ?=uncertain",
        },
    }


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        nl = text.find("\n")
        if nl != -1:
            text = text[nl + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    return text.strip()


def extract_json(text: str) -> dict | None:
    cleaned = _strip_json_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None
