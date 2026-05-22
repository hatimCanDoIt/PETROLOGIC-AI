import numpy as np
import pandas as pd

DEFAULT_CONFIG = {
    "vsh_cut": 0.35,
    "phi_cut": 0.05,
    "sw_cut": 0.65,
    "rt_cut": 10.0,
    "co2_cut": 0.05,
    "xover_threshold": 0.02,
    "rw": 0.05,
    "rho_matrix": 2.65,
    "rho_fluid": 1.0,
    "archie_a": 1.0,
    "archie_m": 2.0,
    "archie_n": 2.0,
}


def detect_pay_zones(df, config=None):
    """Apply physics-based pay zone detection.

    Returns df with added columns: VSH, PHIT_CALC, PHIE_CALC, SW_CALC,
    ND_XOVER, FLUID_TYPE, PAY_FLAG.
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    out = df.copy()

    # ── Shale Volume from GR ───────────────────────────────────────────────
    if "GR" in out.columns and out["GR"].notna().any():
        gr = out["GR"].clip(lower=0)
        gr_clean = gr.quantile(0.10)
        gr_shale = gr.quantile(0.90)
        span = gr_shale - gr_clean
        if span > 0:
            out["VSH"] = ((gr - gr_clean) / span).clip(0, 1)
        else:
            out["VSH"] = 0.0
    else:
        out["VSH"] = np.nan

    # ── Total Porosity ─────────────────────────────────────────────────────
    if "PHIT" in out.columns and out["PHIT"].notna().any():
        out["PHIT_CALC"] = out["PHIT"].clip(0, 0.5)
    elif "DPHI" in out.columns and out["DPHI"].notna().any():
        out["PHIT_CALC"] = out["DPHI"].clip(0, 0.5)
    elif "RHOB" in out.columns and out["RHOB"].notna().any():
        rho_mat = cfg["rho_matrix"]
        rho_fl = cfg["rho_fluid"]
        out["PHIT_CALC"] = ((rho_mat - out["RHOB"]) / (rho_mat - rho_fl)).clip(0, 0.5)
    elif "NPHI" in out.columns and out["NPHI"].notna().any():
        out["PHIT_CALC"] = out["NPHI"].clip(0, 0.5)
    else:
        out["PHIT_CALC"] = np.nan

    # ── Effective Porosity ─────────────────────────────────────────────────
    if "PHIE" in out.columns and out["PHIE"].notna().any():
        out["PHIE_CALC"] = out["PHIE"].clip(0, 0.5)
    else:
        vsh = out["VSH"].fillna(0)
        out["PHIE_CALC"] = (out["PHIT_CALC"] * (1 - vsh)).clip(0, 0.5)

    # ── Water Saturation ───────────────────────────────────────────────────
    if "SW" in out.columns and out["SW"].notna().any():
        out["SW_CALC"] = out["SW"].clip(0, 1)
    elif "RT" in out.columns and out["RT"].notna().any() and out["PHIE_CALC"].notna().any():
        rw = cfg["rw"]
        a  = cfg["archie_a"]
        m  = cfg["archie_m"]
        n  = cfg["archie_n"]
        phi = out["PHIE_CALC"].replace(0, np.nan)
        rt  = out["RT"].replace(0, np.nan)
        sw_archie = (a * rw / (rt * phi ** m)) ** (1.0 / n)
        out["SW_CALC"] = sw_archie.clip(0, 1)
    else:
        out["SW_CALC"] = np.nan

    # ── Neutron-Density Crossover ──────────────────────────────────────────
    if "NPHI" in out.columns and "DPHI" in out.columns:
        out["ND_XOVER"] = out["NPHI"] - out["DPHI"]
    else:
        out["ND_XOVER"] = np.nan

    # ── Fluid Classification ───────────────────────────────────────────────
    xover_thresh = cfg["xover_threshold"]
    co2_cut = cfg["co2_cut"]
    sw_cut  = cfg["sw_cut"]

    out["FLUID_TYPE"] = "water"

    if out["ND_XOVER"].notna().any():
        out.loc[out["ND_XOVER"] > xover_thresh, "FLUID_TYPE"] = "gas"

    if out["SW_CALC"].notna().any():
        oil_mask = (
            (out["SW_CALC"] < sw_cut)
            & (out["ND_XOVER"].fillna(0) <= xover_thresh)
            & (out["FLUID_TYPE"] != "gas")
        )
        out.loc[oil_mask, "FLUID_TYPE"] = "oil"

    if "SXGA" in out.columns and out["SXGA"].notna().any():
        out.loc[out["SXGA"] > co2_cut, "FLUID_TYPE"] = "CO2"

    # ── Pay Zone Flag ──────────────────────────────────────────────────────
    vsh_cut = cfg["vsh_cut"]
    phi_cut = cfg["phi_cut"]
    rt_cut  = cfg["rt_cut"]

    pay = pd.Series(True, index=out.index)

    if out["VSH"].notna().any():
        pay &= out["VSH"].fillna(1) < vsh_cut
    if out["PHIE_CALC"].notna().any():
        pay &= out["PHIE_CALC"].fillna(0) > phi_cut
    if out["SW_CALC"].notna().any():
        pay &= out["SW_CALC"].fillna(1) < sw_cut
    if "RT" in out.columns and out["RT"].notna().any():
        pay &= out["RT"].fillna(0) > rt_cut

    out["PAY_FLAG"] = pay.astype(int)

    return out


def get_pay_intervals(df, min_thickness=2.0):
    """Summarise flagged pay depths into depth intervals.

    Returns a DataFrame with: top_ft, base_ft, thickness_ft,
    avg_vsh, avg_phie, avg_sw, avg_kint_md, fluid_type.
    """
    if "PAY_FLAG" not in df.columns or df["PAY_FLAG"].sum() == 0:
        return pd.DataFrame(columns=[
            "top_ft", "base_ft", "thickness_ft",
            "avg_vsh", "avg_phie", "avg_sw", "avg_kint_md", "fluid_type",
        ])

    sorted_df = df.sort_values("DEPTH").reset_index(drop=True)
    rows = []
    in_zone = False
    top = None

    for i, row in sorted_df.iterrows():
        if row["PAY_FLAG"] == 1 and not in_zone:
            in_zone = True
            top = row["DEPTH"]
        elif row["PAY_FLAG"] == 0 and in_zone:
            in_zone = False
            base = row["DEPTH"]
            if base - top >= min_thickness:
                zone = sorted_df[(sorted_df["DEPTH"] >= top) & (sorted_df["DEPTH"] < base)]
                rows.append(_zone_summary(zone, top, base))
            top = None

    if in_zone and top is not None:
        base = sorted_df["DEPTH"].iloc[-1]
        if base - top >= min_thickness:
            zone = sorted_df[sorted_df["DEPTH"] >= top]
            rows.append(_zone_summary(zone, top, base))

    if not rows:
        return pd.DataFrame(columns=[
            "top_ft", "base_ft", "thickness_ft",
            "avg_vsh", "avg_phie", "avg_sw", "avg_kint_md", "fluid_type",
        ])

    return pd.DataFrame(rows)


def _zone_summary(zone, top, base):
    row = {
        "top_ft": round(float(top), 1),
        "base_ft": round(float(base), 1),
        "thickness_ft": round(float(base - top), 1),
    }
    for col, key in [
        ("VSH",       "avg_vsh"),
        ("PHIE_CALC", "avg_phie"),
        ("SW_CALC",   "avg_sw"),
        ("KINT",      "avg_kint_md"),
    ]:
        row[key] = round(float(zone[col].mean()), 4) if col in zone.columns and zone[col].notna().any() else None

    if "FLUID_TYPE" in zone.columns and zone["FLUID_TYPE"].notna().any():
        row["fluid_type"] = zone["FLUID_TYPE"].mode().iloc[0]
    else:
        row["fluid_type"] = "unknown"

    return row
