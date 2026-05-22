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


# Deep resistivity for Archie / pay — deepest reading first.
RT_DEEP_ALIASES: list[str] = [
    "AT90",
    "AF90",
    "AO90",
    "AHT90",
    "AT60",
    "AF60",
    "AO60",
    "ILD",
    "LLD",
    "RT",
    "RILD",
    "RLLD",
    "RD",
    "M2R9",
    "AORT",
]

# Medium / shallow flushed-zone resistivity (diagnostic overlays).
RT_SHALLOW_ALIASES: list[str] = [
    "AT30",
    "AF30",
    "AO30",
    "AT20",
    "AF20",
    "AO20",
    "AT10",
    "AF10",
    "AO10",
    "RXO",
    "AORX",
    "RXOZ",
    "ILS",
    "RILS",
    "M2R1",
    "SFL",
    "RLLS",
]

# Micro / mud-cake resistivity (invasion QC).
RT_MICRO_ALIASES: list[str] = [
    "RXO8",
    "HMIN",
    "HMNO",
    "MSFL",
    "BMIN",
    "BMNO",
]

# All resistivity mnemonics for log-viewer overlays (priority order).
RESISTIVITY_ALIASES: list[str] = (
    RT_DEEP_ALIASES + RT_SHALLOW_ALIASES + RT_MICRO_ALIASES
)

# Mnemonic aliases — first match wins per family
CURVE_ALIASES: dict[str, list[str]] = {
    "GR": ["GR", "ECGR", "CGR", "HGR", "GRD", "GRGC", "SGR"],
    # Deep resistivity only — shallow curves must not drive Archie Sw.
    "RT": RT_DEEP_ALIASES
    + [
        "AT30",
        "AF30",
        "AO30",
        "AT20",
        "AF20",
        "AO20",
        "AT10",
        "AF10",
        "AO10",
    ],
    "NPHI": [
        "NPHI",
        "TNPH",
        "HNPO",
        "HTNP",
        "NPOR",
        "CNL",
        "PHIN",
    ],
    "RHOZ": ["RHOZ", "RHOB", "DEN", "ZDEN", "DENS", "RHO", "RHOM"],
    # Vendor density porosity — prefer over in-house RHOZ-derived DPHI when present.
    "DPHI_INPUT": ["DPHZ", "DPHI", "DPOR", "PHID", "PHID_M"],
    # Apparent water resistivity from vendor petrophysics (log-method Rw).
    "RWA": ["RWA", "RWA_HILT", "RWA8", "RWAP"],
    "PEF": ["PEFZ", "PEF", "PE", "PDPE", "PE8"],
    "SP": ["SP", "ASFI", "SPONT", "SPR"],
    "CALI": ["HCAL", "CALI", "DCAL", "CAL", "CALR", "CALS"],
    # ELAN / GeoFrame effective porosity already solved on the file
    "PHI_INPUT": [
        "PIGN",
        "PHIE",
        "PHIT",
        "TPHI",
        "PHIC",
        "PHIE_M",
    ],
    # Processed water saturation — avoids failing uploads that only carry RST/sigma Sw
    "SW_INPUT": [
        "SUWI",
        "SW",
        "SXWI",
        "SXOT",
        "SWDS",
        "SWM",
        "SWE",
        "SWT",
    ],
    # Gas / CO2 indicators (RST, ELAN) — augments NPHI–DPHI gas crossover
    "GAS_FLAG": ["VXGA", "SXGA", "XGAS", "SBOG"],
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
    found = _find_all_mnemonics(columns, aliases)
    return found[0] if found else None


def find_resistivity_mnemonics(columns: list[str]) -> list[str]:
    """Return every resistivity mnemonic present, deep → shallow → micro."""
    return _find_all_mnemonics(columns, RESISTIVITY_ALIASES)


def _find_all_mnemonics(columns: list[str], aliases: list[str]) -> list[str]:
    """Return every column matching ``aliases``, in alias priority order."""
    upper_map = {str(c).upper(): c for c in columns}
    out: list[str] = []
    seen: set[str] = set()
    for alias in aliases:
        key = alias.upper()
        if key in upper_map:
            orig = upper_map[key]
            if orig not in seen:
                out.append(orig)
                seen.add(orig)
            continue
        for upper, original in upper_map.items():
            if upper.startswith(key) and original not in seen:
                out.append(original)
                seen.add(original)
    return out


def validate_curves(las_data: LASData) -> dict:
    """Inspect the parsed LAS to determine which standard curves are present."""
    cols = [c for c in las_data.df.columns if c != "DEPT"]

    gr = _find_mnemonic(cols, CURVE_ALIASES["GR"])
    rt = _find_mnemonic(cols, CURVE_ALIASES["RT"])
    rt_all = find_resistivity_mnemonics(cols)
    rt_sh = _find_mnemonic(cols, RT_SHALLOW_ALIASES)
    rt_mi = _find_mnemonic(cols, RT_MICRO_ALIASES)
    rwa = _find_mnemonic(cols, CURVE_ALIASES["RWA"])
    dphi_in = _find_mnemonic(cols, CURVE_ALIASES["DPHI_INPUT"])
    nphi = _find_mnemonic(cols, CURVE_ALIASES["NPHI"])
    rhoz = _find_mnemonic(cols, CURVE_ALIASES["RHOZ"])
    pef = _find_mnemonic(cols, CURVE_ALIASES["PEF"])
    sp = _find_mnemonic(cols, CURVE_ALIASES["SP"])
    cali = _find_mnemonic(cols, CURVE_ALIASES["CALI"])
    phi_in = _find_mnemonic(cols, CURVE_ALIASES["PHI_INPUT"])
    sw_in = _find_mnemonic(cols, CURVE_ALIASES["SW_INPUT"])
    gas_flag = _find_mnemonic(cols, CURVE_ALIASES["GAS_FLAG"])

    missing_critical: list[str] = []
    warnings: list[str] = []

    if gr is None:
        missing_critical.append("GR (gamma ray)")

    has_phi = nphi is not None or rhoz is not None or phi_in is not None
    if not has_phi:
        missing_critical.append(
            "NPHI or RHOZ or processed porosity (e.g. PIGN, PHIT, PHIC, TPHI)"
        )

    # Need either a resistivity log (for Archie) or processed water saturation (RST/ELAN).
    if rt is None and sw_in is None:
        missing_critical.append(
            "RT (resistivity) or processed Sw (e.g. SUWI, SW, SXWI)"
        )

    if pef is None:
        warnings.append("PEF missing — lithology classification will be uncertain.")
    if sp is None:
        warnings.append("SP missing.")
    if cali is None:
        warnings.append("Caliper missing — cannot QC borehole condition.")
    if phi_in is not None:
        warnings.append(
            f"Using processed porosity curve {phi_in} where present (ELAN / vendor)."
        )
    if sw_in is not None:
        warnings.append(
            f"Using processed water saturation {sw_in} where present "
            "( RST / sigma / ELAN ); Archie Sw fills gaps only."
        )
    if rt is None and sw_in is not None:
        warnings.append("No deep resistivity — saturation driven by processed Sw curve.")
    if gas_flag is not None:
        warnings.append(f"Optional gas indicator curve present: {gas_flag}.")
    if rwa is not None:
        warnings.append(
            f"Apparent water resistivity curve {rwa} present — "
            "used for log-method Rw when auto-estimating."
        )
    if dphi_in is not None:
        warnings.append(
            f"Using vendor density porosity {dphi_in} where present."
        )

    return {
        "has_gr": gr is not None,
        "has_resistivity": rt is not None,
        "has_neutron": nphi is not None,
        "has_density": rhoz is not None,
        "has_pef": pef is not None,
        "has_sp": sp is not None,
        "has_caliper": cali is not None,
        "has_phi_input": phi_in is not None,
        "has_sw_input": sw_in is not None,
        "has_gas_flag": gas_flag is not None,
        "has_rwa": rwa is not None,
        "has_dphi_input": dphi_in is not None,
        "gr_mnemonic": gr,
        "rt_mnemonic": rt,
        "rt_mnemonics": rt_all,
        "rt_shallow_mnemonic": rt_sh,
        "rt_micro_mnemonic": rt_mi,
        "rwa_mnemonic": rwa,
        "dphi_input_mnemonic": dphi_in,
        "nphi_mnemonic": nphi,
        "rhoz_mnemonic": rhoz,
        "pef_mnemonic": pef,
        "sp_mnemonic": sp,
        "cali_mnemonic": cali,
        "phi_input_mnemonic": phi_in,
        "sw_input_mnemonic": sw_in,
        "gas_flag_mnemonic": gas_flag,
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
        ("PHI_INPUT", "phi_input_mnemonic"),
        ("SW_INPUT", "sw_input_mnemonic"),
        ("GAS_FLAG", "gas_flag_mnemonic"),
        ("DPHI_INPUT", "dphi_input_mnemonic"),
        ("RWA", "rwa_mnemonic"),
        ("RT_SHALLOW", "rt_shallow_mnemonic"),
        ("RT_MICRO", "rt_micro_mnemonic"),
    ):
        mnem = validation.get(key)
        if mnem and mnem in df.columns:
            mapping[std] = mnem
    return mapping
