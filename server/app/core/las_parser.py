"""LAS 2.0 parser + curve validation.

Thin wrapper over `lasio` that:
* parses raw bytes,
* extracts well metadata,
* normalises null values (defaults to -999.25, also values within 1e-3),
* validates that a depth column and at least one data curve are present,
* maps common mnemonic aliases to the canonical curve set used downstream.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Optional

import lasio
import numpy as np
import pandas as pd

NULL_DEFAULT = -999.25
NULL_TOLERANCE = 1e-3


class LASParseError(ValueError):
    """Raised when a LAS file cannot be parsed or fails validation."""


# Mnemonic aliases — first match wins
CURVE_ALIASES: dict[str, list[str]] = {
    "GR": ["GR", "ECGR", "CGR", "HGR", "GRD", "GRGC", "SGR"],
    "RT": [
        "AF90", "AT90", "AHT90", "AO90",
        "ILD", "LLD", "RT", "RILD", "RLLD", "RD",
        "AF60", "AT60",
    ],
    "NPHI": ["NPHI", "TNPH", "HNPO", "HTNP", "NPOR", "CNL", "PHIN"],
    "RHOZ": ["RHOZ", "RHOB", "DEN", "ZDEN", "DENS", "RHO", "RHOM"],
    "PEF": ["PEFZ", "PEF", "PE", "PDPE", "PE8"],
    "SP": ["SP", "ASFI", "SPONT", "SPR"],
    "CALI": ["HCAL", "CALI", "DCAL", "CAL", "CALR", "CALS"],
}


@dataclass
class LASMeta:
    well_name: str
    api_number: Optional[str]
    operator: Optional[str]
    field: Optional[str]
    log_date: Optional[str]
    depth_start: float
    depth_stop: float
    depth_step: float
    null_value: float
    curves: list[dict] = field(default_factory=list)
    raw_params: dict = field(default_factory=dict)


@dataclass
class LASData:
    meta: LASMeta
    df: pd.DataFrame  # indexed by depth


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _safe_meta(las: "lasio.LASFile", key: str) -> Optional[str]:
    """Pull a value from las.well or return None."""
    try:
        item = las.well[key]
    except (KeyError, AttributeError):
        return None
    val = getattr(item, "value", None)
    if val in (None, "", "UNKNOWN"):
        return None
    return str(val).strip() or None


def parse_las(file_bytes: bytes) -> LASData:
    """Parse a LAS 2.0 file from raw bytes.

    Raises ``LASParseError`` on any parse/validation failure.
    """
    if not file_bytes:
        raise LASParseError("Empty file uploaded.")

    try:
        text = file_bytes.decode("utf-8", errors="replace")
        las = lasio.read(io.StringIO(text), engine="normal")
    except Exception as exc:  # lasio raises various exceptions
        raise LASParseError(f"Could not parse LAS file: {exc}") from exc

    # ----- metadata
    well_name = _safe_meta(las, "WELL") or "UNKNOWN WELL"
    api_number = _safe_meta(las, "API") or _safe_meta(las, "UWI")
    operator = _safe_meta(las, "COMP") or _safe_meta(las, "OPERATOR")
    field_name = _safe_meta(las, "FLD") or _safe_meta(las, "FIELD")
    log_date = _safe_meta(las, "DATE")

    # Null value: prefer ~Well NULL, fall back to ~Parameter, default
    null_value = NULL_DEFAULT
    try:
        nv = las.well["NULL"].value
        if nv is not None and nv != "":
            null_value = float(nv)
    except (KeyError, AttributeError, ValueError, TypeError):
        try:
            nv = las.params["NULL"].value
            if nv is not None and nv != "":
                null_value = float(nv)
        except (KeyError, AttributeError, ValueError, TypeError):
            null_value = NULL_DEFAULT

    # ----- curves descriptor
    curves_meta = [
        {
            "name": str(c.mnemonic),
            "unit": str(c.unit or ""),
            "desc": str(c.descr or ""),
        }
        for c in las.curves
    ]

    # ----- parameter section (best-effort)
    raw_params: dict = {}
    try:
        for k in las.params.keys():
            try:
                raw_params[k] = str(las.params[k].value)
            except Exception:
                pass
    except Exception:
        pass

    # ----- DataFrame
    try:
        df = las.df()
    except Exception as exc:
        raise LASParseError(f"Could not convert LAS to DataFrame: {exc}") from exc

    if df is None or df.empty:
        raise LASParseError("LAS file contains zero data rows.")

    # lasio sets the depth column as the index. Make it a regular column for clarity.
    df = df.reset_index()
    depth_col = df.columns[0]
    if str(depth_col).upper() not in ("DEPT", "DEPTH", "MD"):
        # Some files name the depth differently — try to find one
        for col in df.columns:
            if str(col).upper() in ("DEPT", "DEPTH", "MD"):
                depth_col = col
                break
        else:
            raise LASParseError(
                "No depth column found (expected DEPT, DEPTH, or MD)."
            )
    df = df.rename(columns={depth_col: "DEPT"})

    # Replace null sentinels with NaN (exact + within tolerance)
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    if len(numeric_cols):
        block = df[numeric_cols].to_numpy(dtype=float, copy=True)
        mask = (block == null_value) | (np.abs(block - null_value) < NULL_TOLERANCE)
        block[mask] = np.nan
        df.loc[:, numeric_cols] = block

    # Depth sanity
    dept = df["DEPT"].to_numpy(dtype=float)
    if not np.isfinite(dept).any():
        raise LASParseError("Depth column contains no valid values.")

    finite_depth = dept[np.isfinite(dept)]
    depth_start = float(finite_depth.min())
    depth_stop = float(finite_depth.max())

    if len(finite_depth) < 2:
        raise LASParseError("Need at least two depth samples.")

    # Estimate step from the first two finite depth samples
    diffs = np.diff(finite_depth)
    diffs = diffs[np.isfinite(diffs) & (diffs > 0)]
    depth_step = float(diffs.min()) if len(diffs) else 0.5

    # Need at least one non-depth data curve
    data_curves = [c for c in df.columns if c != "DEPT"]
    if not data_curves:
        raise LASParseError("LAS file has no data curves besides depth.")

    # Need at least one curve with some finite values
    has_data = any(np.isfinite(df[c].to_numpy(dtype=float)).any() for c in data_curves)
    if not has_data:
        raise LASParseError("All data curves are null.")

    meta = LASMeta(
        well_name=well_name,
        api_number=api_number,
        operator=operator,
        field=field_name,
        log_date=log_date,
        depth_start=depth_start,
        depth_stop=depth_stop,
        depth_step=depth_step,
        null_value=null_value,
        curves=curves_meta,
        raw_params=raw_params,
    )
    return LASData(meta=meta, df=df)


# ---------------------------------------------------------------------------
# Curve validation
# ---------------------------------------------------------------------------


def _find_mnemonic(columns: list[str], aliases: list[str]) -> Optional[str]:
    """Return the first column matching any of ``aliases`` (case-insensitive)."""
    upper_map = {str(c).upper(): c for c in columns}
    for alias in aliases:
        if alias.upper() in upper_map:
            return upper_map[alias.upper()]
    # try prefix match (some vendors append zones, e.g. GR_1)
    for alias in aliases:
        for upper, original in upper_map.items():
            if upper.startswith(alias.upper()):
                return original
    return None


def validate_curves(las_data: LASData) -> dict:
    """Inspect the parsed LAS to determine which standard curves are present."""
    cols = [c for c in las_data.df.columns if c != "DEPT"]

    gr = _find_mnemonic(cols, CURVE_ALIASES["GR"])
    rt = _find_mnemonic(cols, CURVE_ALIASES["RT"])
    nphi = _find_mnemonic(cols, CURVE_ALIASES["NPHI"])
    rhoz = _find_mnemonic(cols, CURVE_ALIASES["RHOZ"])
    pef = _find_mnemonic(cols, CURVE_ALIASES["PEF"])
    sp = _find_mnemonic(cols, CURVE_ALIASES["SP"])
    cali = _find_mnemonic(cols, CURVE_ALIASES["CALI"])

    missing_critical: list[str] = []
    warnings: list[str] = []

    if gr is None:
        missing_critical.append("GR (gamma ray)")
    if rt is None:
        missing_critical.append("RT (resistivity)")
    if nphi is None and rhoz is None:
        missing_critical.append("NPHI or RHOZ (need at least one porosity log)")

    if pef is None:
        warnings.append("PEF missing — lithology classification will be uncertain.")
    if sp is None:
        warnings.append("SP missing.")
    if cali is None:
        warnings.append("Caliper missing — cannot QC borehole condition.")

    return {
        "has_gr": gr is not None,
        "has_resistivity": rt is not None,
        "has_neutron": nphi is not None,
        "has_density": rhoz is not None,
        "has_pef": pef is not None,
        "has_sp": sp is not None,
        "has_caliper": cali is not None,
        "gr_mnemonic": gr,
        "rt_mnemonic": rt,
        "nphi_mnemonic": nphi,
        "rhoz_mnemonic": rhoz,
        "pef_mnemonic": pef,
        "sp_mnemonic": sp,
        "cali_mnemonic": cali,
        "missing_critical": missing_critical,
        "warnings": warnings,
    }


def auto_select_curves(df: pd.DataFrame, validation: dict) -> dict:
    """Map standard names → actual column names present in ``df``."""
    mapping: dict = {}
    for std, key in (
        ("GR", "gr_mnemonic"),
        ("RT", "rt_mnemonic"),
        ("NPHI", "nphi_mnemonic"),
        ("RHOZ", "rhoz_mnemonic"),
        ("PEF", "pef_mnemonic"),
        ("SP", "sp_mnemonic"),
        ("CALI", "cali_mnemonic"),
    ):
        mnem = validation.get(key)
        if mnem and mnem in df.columns:
            mapping[std] = mnem
    return mapping
