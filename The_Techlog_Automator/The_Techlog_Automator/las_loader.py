import lasio
import pandas as pd
import numpy as np
from pathlib import Path

CURVE_MAP = {
    "GR":   ["GR", "GR_EDTC", "ECGR", "HGR"],
    "RHOB": ["RHOZ", "RHOB"],
    "NPHI": ["TNPH", "HTNP", "NPHI", "HNPO", "NPOR", "HTNP_SAN"],
    "DPHI": ["DPHZ", "DPHI"],
    "PE":   ["PEFZ", "PE"],
    "RT":   ["AT90", "AF90", "AO90"],
    "RXO":  ["RXO8", "RXOZ", "AORX"],
    "SW":   ["SUWI", "SW"],
    "PHIT": ["PHIT", "TPHI", "PHIC", "SPHI"],
    "PHIE": ["PIGN"],
    "KINT": ["KINT"],
    "SXGA": ["SXGA"],
    "SIGM": ["SIGM"],
    "DT":   ["DT"],
    "SP":   ["SP", "ASFI"],
    "CAL":  ["HCAL", "DCAL"],
}

# Physical validity ranges — values outside these are measurement artifacts or nulls.
# Any reading outside [lo, hi] is set to NaN rather than clipped to keep data honest.
CURVE_RANGES = {
    "GR":   (0.0,    400.0),   # GAPI
    "RHOB": (1.0,    3.5),     # g/cc
    "NPHI": (-0.15,  0.65),    # v/v
    "DPHI": (-0.15,  0.65),    # v/v
    "PE":   (0.0,    15.0),    # b/e
    "RT":   (0.001,  50000.0), # ohm·m
    "RXO":  (0.001,  50000.0), # ohm·m
    "SW":   (0.0,    1.0),     # fraction
    "PHIT": (0.0,    0.70),    # v/v
    "PHIE": (0.0,    0.70),    # v/v
    "KINT": (0.0,    1e6),     # mD
    "SXGA": (0.0,    1.0),     # fraction
    "SIGM": (0.0,    100.0),   # capture units
    "DT":   (40.0,   400.0),   # us/ft
    "SP":   (-300.0, 300.0),   # mV
    "CAL":  (2.0,    30.0),    # inches
}


def load_las(path):
    """Return (well_name, df, available_raw) for a single LAS file.

    df has a 'DEPTH' column plus canonical curve columns (GR, RHOB, ...).
    available_raw maps canonical name -> original mnemonic found in the file.
    """
    las = lasio.read(str(path), ignore_header_errors=True)
    raw_df = las.df().reset_index()

    # Normalise depth column to 'DEPTH'
    depth_col = raw_df.columns[0]
    raw_df = raw_df.rename(columns={depth_col: "DEPTH"})

    mapped = {"DEPTH": raw_df["DEPTH"]}
    available_raw = {}
    for canon, aliases in CURVE_MAP.items():
        for alias in aliases:
            if alias in raw_df.columns:
                mapped[canon] = raw_df[alias]
                available_raw[canon] = alias
                break

    df = pd.DataFrame(mapped)
    df = df.sort_values("DEPTH").reset_index(drop=True)

    # ── Null / absent-value scrubbing ──────────────────────────────────────
    # LAS null indicators vary by vendor: -999.25, -9999.25, -999.99, etc.
    # Blanket rule: any value < -900 in a non-depth column is a null marker.
    for col in df.columns:
        if col == "DEPTH":
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df.loc[df[col] < -900, col] = np.nan

    # ── Physical range filter ──────────────────────────────────────────────
    # Values outside the known physical range are artifacts; mark as NaN.
    for canon, (lo, hi) in CURVE_RANGES.items():
        if canon in df.columns:
            mask = df[canon].notna() & ((df[canon] < lo) | (df[canon] > hi))
            df.loc[mask, canon] = np.nan

    well_name = str(las.well.WELL.value).strip() if las.well.WELL.value else Path(path).stem
    if not well_name or well_name in ("-999.25", ""):
        well_name = Path(path).stem

    return well_name, df, available_raw


def merge_las_files(paths):
    """Load and depth-merge multiple LAS files from the same well.

    Curves from later files fill gaps but do not overwrite values already
    present from earlier files.  Returns (well_name, merged_df).
    """
    if not paths:
        return "Unknown", pd.DataFrame()

    well_name = None
    frames = []
    for p in paths:
        try:
            name, df, _ = load_las(p)
        except Exception as exc:
            print(f"[las_loader] skipping {p}: {exc}")
            continue
        if well_name is None:
            well_name = name
        frames.append(df.set_index("DEPTH"))

    if not frames:
        return well_name or "Unknown", pd.DataFrame()

    merged = frames[0]
    for frame in frames[1:]:
        for col in frame.columns:
            if col not in merged.columns:
                merged[col] = frame[col]
            else:
                merged[col] = merged[col].combine_first(frame[col])

    return well_name, merged.reset_index()
