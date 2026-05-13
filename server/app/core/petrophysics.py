"""Deterministic petrophysical analysis engine.

Pipeline:
  1. Extract & clean curves
  2. Density porosity (DPHI) from RHOZ
  3. Vsh from gamma ray (linear Larionov)
  4. Effective porosity (neutron-density average, shale-corrected)
  5. Archie water saturation, Shc, BVW
  6. Gas crossover flag (DPHI > NPHI)
  7. Data quality mask
  8. HC detection (oil vs gas)
  9. Lithology from PEF
  10. Contiguous-interval (zone) detection
  11. Well statistics

All log arrays returned by ``run_petrophysics`` are 1-D float64 numpy arrays of
the same length as the input depth array; missing values are ``NaN``. The
returned ``zones`` list contains plain dicts ready to be JSON-serialised.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Parameters & result containers
# ---------------------------------------------------------------------------


@dataclass
class PetroParams:
    """All user-tunable petrophysical parameters."""

    rho_ma: float = 2.71            # limestone default (g/cc)
    rho_fl: float = 1.00            # fluid density (g/cc)
    Rw: float = 1.0                 # formation water resistivity (ohm.m)
    a: float = 1.0                  # Archie tortuosity factor
    m: float = 2.0                  # Archie cementation exponent
    n: float = 2.0                  # Archie saturation exponent
    GR_clean: Optional[float] = None  # override; else auto from p5
    GR_shale: Optional[float] = None  # override; else auto from p90
    Rt_cutoff: float = 15.0           # ohm.m
    Shc_cutoff: float = 0.35
    phi_cutoff: float = 0.08
    Vsh_cutoff: float = 0.40
    Sw_producible: float = 0.60       # below this Sw a sample is "producible"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PetroResult:
    # Per-depth arrays
    depth: np.ndarray
    GR: np.ndarray
    NPHI: np.ndarray
    DPHI: np.ndarray
    RHOZ: np.ndarray
    RT: np.ndarray
    PEF: np.ndarray
    Vsh: np.ndarray
    phi_eff: np.ndarray
    Sw: np.ndarray
    Shc: np.ndarray
    BVW: np.ndarray
    hc_type: np.ndarray              # int8 0/1/2
    lith_flag: np.ndarray            # int8 0/1/2/3

    # Scalars
    GR_clean: float = 0.0
    GR_shale: float = 0.0
    mean_GR: float = 0.0
    mean_RT: float = 0.0
    mean_NPHI: float = 0.0
    mean_phi_eff: float = 0.0
    mean_Sw: float = 0.0
    pef_distribution: dict = field(default_factory=dict)

    zones: list[dict] = field(default_factory=list)
    params_used: PetroParams = field(default_factory=PetroParams)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_LITH_LABELS = {0: "sandstone", 1: "dolomite", 2: "limestone", 3: "uncertain"}


def _extract(df: pd.DataFrame, curve_map: dict, key: str, length: int) -> np.ndarray:
    """Pull a curve as float64; missing column → all-NaN array."""
    col = curve_map.get(key)
    if col is None or col not in df.columns:
        return np.full(length, np.nan, dtype=np.float64)
    return df[col].to_numpy(dtype=np.float64, copy=True)


def _nanmean_safe(arr: np.ndarray, default: float = 0.0) -> float:
    if arr.size == 0:
        return default
    with np.errstate(invalid="ignore"):
        v = np.nanmean(arr)
    if not np.isfinite(v):
        return default
    return float(v)


def _nanpercentile_safe(arr: np.ndarray, q: float, default: float) -> float:
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return default
    return float(np.percentile(finite, q))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def run_petrophysics(
    df: pd.DataFrame, curve_map: dict, params: PetroParams
) -> PetroResult:
    """Run the full deterministic petrophysical pipeline."""
    if "DEPT" not in df.columns:
        raise ValueError("DataFrame must contain a 'DEPT' column.")

    depth = df["DEPT"].to_numpy(dtype=np.float64, copy=True)
    n = len(depth)

    # ----- STEP 1: extract & clean
    GR = _extract(df, curve_map, "GR", n)
    NPHI = _extract(df, curve_map, "NPHI", n)
    RHOZ = _extract(df, curve_map, "RHOZ", n)
    RT = _extract(df, curve_map, "RT", n)
    PEF = _extract(df, curve_map, "PEF", n)

    with np.errstate(invalid="ignore"):
        # Out-of-range values → NaN, not clipped to bounds (keeps interpretability)
        GR[(GR < 0) | (GR > 350)] = np.nan
        NPHI[(NPHI < -0.05) | (NPHI > 0.80)] = np.nan
        RHOZ[(RHOZ < 1.0) | (RHOZ > 3.5)] = np.nan
        RT[(RT < 0.01) | (RT > 10000)] = np.nan
        PEF[(PEF < 0) | (PEF > 20)] = np.nan

    # ----- STEP 2: density porosity
    rho_ma = params.rho_ma
    rho_fl = params.rho_fl
    denom = rho_ma - rho_fl
    if denom == 0:
        DPHI = np.full(n, np.nan, dtype=np.float64)
    else:
        with np.errstate(invalid="ignore"):
            DPHI = (rho_ma - RHOZ) / denom
        DPHI = np.where(np.isfinite(RHOZ), DPHI, np.nan)
    DPHI = np.clip(DPHI, -0.20, 0.65)

    # ----- STEP 3: Vsh from gamma ray (linear Larionov)
    GR_clean = (
        params.GR_clean
        if params.GR_clean is not None
        else _nanpercentile_safe(GR, 5, 30.0)
    )
    GR_shale = (
        params.GR_shale
        if params.GR_shale is not None
        else _nanpercentile_safe(GR, 90, 120.0)
    )
    if GR_shale - GR_clean < 1.0:
        # Pathological well — avoid divide-by-zero
        GR_shale = GR_clean + 1.0
    Vsh = (GR - GR_clean) / (GR_shale - GR_clean)
    Vsh = np.where(np.isfinite(GR), Vsh, np.nan)
    Vsh = np.clip(Vsh, 0.0, 1.0)

    # ----- STEP 4: effective porosity (neutron-density average)
    has_nphi = np.isfinite(NPHI)
    has_dphi = np.isfinite(DPHI)
    with np.errstate(invalid="ignore"):
        phi_nd = np.where(
            has_nphi & has_dphi,
            (NPHI + DPHI) / 2.0,
            np.where(has_nphi, NPHI, np.where(has_dphi, DPHI, np.nan)),
        )
    PHI_SHALE_NPHI = 0.35  # empirical NPHI of pure shale
    phi_eff = phi_nd - np.where(np.isfinite(Vsh), Vsh, 0.0) * PHI_SHALE_NPHI
    phi_eff = np.where(np.isfinite(phi_nd), phi_eff, np.nan)
    phi_eff = np.clip(phi_eff, 0.001, 0.50)

    # ----- STEP 5: Archie Sw
    with np.errstate(divide="ignore", invalid="ignore"):
        Sw = np.power(
            (params.a * params.Rw) / (np.power(phi_eff, params.m) * RT),
            1.0 / params.n,
        )
    Sw = np.where(np.isfinite(RT) & np.isfinite(phi_eff), Sw, np.nan)
    Sw = np.clip(Sw, 0.0, 1.0)
    Shc = 1.0 - Sw
    BVW = phi_eff * Sw

    # ----- STEP 6: gas crossover
    gas_crossover = np.zeros(n, dtype=bool)
    both = np.isfinite(DPHI) & np.isfinite(NPHI)
    gas_crossover[both] = (DPHI[both] - NPHI[both]) > 0.03

    # ----- STEP 7: data quality mask
    valid_mask = (
        np.isfinite(RT)
        & np.isfinite(RHOZ)
        & np.isfinite(NPHI)
        & np.isfinite(GR)
        & np.isfinite(phi_eff)
        & np.isfinite(Sw)
    )

    # ----- STEP 8: HC detection
    hc_mask = (
        valid_mask
        & (Vsh < params.Vsh_cutoff)
        & (phi_eff > params.phi_cutoff)
        & (RT > params.Rt_cutoff)
        & (Shc > params.Shc_cutoff)
    )
    gas_mask = hc_mask & gas_crossover
    oil_mask = hc_mask & ~gas_crossover

    hc_type = np.zeros(n, dtype=np.int8)
    hc_type[oil_mask] = 1
    hc_type[gas_mask] = 2

    # ----- STEP 9: lithology from PEF
    lith_flag = np.full(n, 3, dtype=np.int8)
    valid_pef = np.isfinite(PEF)
    lith_flag[valid_pef & (PEF < 2.5)] = 0
    lith_flag[valid_pef & (PEF >= 2.5) & (PEF < 4.0)] = 1
    lith_flag[valid_pef & (PEF >= 4.0) & (PEF <= 5.5)] = 2
    lith_flag[valid_pef & (PEF > 5.5)] = 3

    # ----- STEP 10: contiguous interval picks
    depth_step = _estimate_step(depth)
    oil_zones = _find_intervals(
        oil_mask,
        depth,
        depth_step,
        "OIL",
        Sw=Sw,
        Shc=Shc,
        phi_eff=phi_eff,
        RT=RT,
        GR=GR,
        Vsh=Vsh,
        PEF=PEF,
        BVW=BVW,
        lith_flag=lith_flag,
        Sw_producible=params.Sw_producible,
    )
    gas_zones = _find_intervals(
        gas_mask,
        depth,
        depth_step,
        "GAS",
        Sw=Sw,
        Shc=Shc,
        phi_eff=phi_eff,
        RT=RT,
        GR=GR,
        Vsh=Vsh,
        PEF=PEF,
        BVW=BVW,
        lith_flag=lith_flag,
        Sw_producible=params.Sw_producible,
    )
    all_zones = sorted(oil_zones + gas_zones, key=lambda z: z["top_ft"])

    # ----- STEP 11: statistics
    mean_GR = _nanmean_safe(GR)
    mean_NPHI = _nanmean_safe(NPHI)
    mean_phi_eff = _nanmean_safe(phi_eff)
    mean_Sw = _nanmean_safe(Sw)
    # Resistivity averaged in log space (geometric mean) → arithmetic mean of log10
    with np.errstate(invalid="ignore", divide="ignore"):
        log_rt = np.log10(RT[np.isfinite(RT) & (RT > 0)])
    mean_RT = float(10.0 ** np.mean(log_rt)) if log_rt.size else 0.0

    total_lith = int(np.sum(np.isfinite(GR)))  # samples with any data
    if total_lith == 0:
        total_lith = n
    pef_distribution = {
        "sandstone_pct": 100.0 * float(np.sum(lith_flag == 0)) / total_lith,
        "dolomite_pct": 100.0 * float(np.sum(lith_flag == 1)) / total_lith,
        "limestone_pct": 100.0 * float(np.sum(lith_flag == 2)) / total_lith,
        "uncertain_pct": 100.0 * float(np.sum(lith_flag == 3)) / total_lith,
    }

    return PetroResult(
        depth=depth,
        GR=GR,
        NPHI=NPHI,
        DPHI=DPHI,
        RHOZ=RHOZ,
        RT=RT,
        PEF=PEF,
        Vsh=Vsh,
        phi_eff=phi_eff,
        Sw=Sw,
        Shc=Shc,
        BVW=BVW,
        hc_type=hc_type,
        lith_flag=lith_flag,
        GR_clean=GR_clean,
        GR_shale=GR_shale,
        mean_GR=mean_GR,
        mean_RT=mean_RT,
        mean_NPHI=mean_NPHI,
        mean_phi_eff=mean_phi_eff,
        mean_Sw=mean_Sw,
        pef_distribution=pef_distribution,
        zones=all_zones,
        params_used=params,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _estimate_step(depth: np.ndarray) -> float:
    """Median spacing between consecutive depth samples."""
    d = np.diff(depth)
    d = d[np.isfinite(d) & (d > 0)]
    if d.size == 0:
        return 0.5
    return float(np.median(d))


def _find_intervals(
    mask: np.ndarray,
    depth: np.ndarray,
    depth_step: float,
    zone_type: str,
    *,
    Sw: np.ndarray,
    Shc: np.ndarray,
    phi_eff: np.ndarray,
    RT: np.ndarray,
    GR: np.ndarray,
    Vsh: np.ndarray,
    PEF: np.ndarray,
    BVW: np.ndarray,
    lith_flag: np.ndarray,
    Sw_producible: float,
    min_thickness_ft: float = 1.0,
) -> list[dict]:
    """Group contiguous True samples into zone dicts."""
    if not np.any(mask):
        return []

    n = len(mask)
    # Find run boundaries via diff of int mask
    m_int = mask.astype(np.int8)
    diff = np.diff(np.concatenate(([0], m_int, [0])))
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]  # exclusive

    intervals: list[dict] = []
    for s, e in zip(starts, ends):
        top = float(depth[s])
        # bot is depth of the last sample IN the run, plus one sample's worth
        last = min(e - 1, n - 1)
        bot = float(depth[last]) + depth_step
        thick = max(0.0, bot - top)
        if thick < min_thickness_ft:
            continue

        sl = slice(s, e)
        sw_seg = Sw[sl]
        shc_seg = Shc[sl]
        phi_seg = phi_eff[sl]
        rt_seg = RT[sl]
        gr_seg = GR[sl]
        vsh_seg = Vsh[sl]
        pef_seg = PEF[sl]
        bvw_seg = BVW[sl]
        lith_seg = lith_flag[sl]

        # Dominant lithology label (mode), preferring non-uncertain
        lith_label = _dominant_lith(lith_seg)

        producible_pct = (
            100.0
            * float(np.sum(np.isfinite(sw_seg) & (sw_seg < Sw_producible)))
            / max(1, sw_seg.size)
        )

        hc_pv = _nanmean_safe(phi_seg * shc_seg)

        intervals.append(
            {
                "type": zone_type,
                "top_ft": round(top, 2),
                "bot_ft": round(bot, 2),
                "thick_ft": round(thick, 2),
                "shc_pct": round(100.0 * _nanmean_safe(shc_seg), 2),
                "sw_pct": round(100.0 * _nanmean_safe(sw_seg), 2),
                "phi_pct": round(100.0 * _nanmean_safe(phi_seg), 2),
                "rt_mean": round(_nanmean_safe(rt_seg), 2),
                "gr_mean": round(_nanmean_safe(gr_seg), 2),
                "vsh_pct": round(100.0 * _nanmean_safe(vsh_seg), 2),
                "pef_mean": round(_nanmean_safe(pef_seg), 2),
                "bvw_mean": round(_nanmean_safe(bvw_seg), 4),
                "producible_pct": round(producible_pct, 2),
                "lith_flag": lith_label,
                "hc_pore_vol_index": round(hc_pv, 4),
            }
        )
    return intervals


def _dominant_lith(lith_seg: np.ndarray) -> str:
    """Return the most-common lithology label in an interval."""
    if lith_seg.size == 0:
        return "uncertain"
    # Prefer non-uncertain values
    non_unc = lith_seg[lith_seg != 3]
    pool = non_unc if non_unc.size else lith_seg
    vals, counts = np.unique(pool, return_counts=True)
    if vals.size == 0:
        return "uncertain"
    winner = int(vals[np.argmax(counts)])
    return _LITH_LABELS.get(winner, "uncertain")
