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
    """All user-tunable petrophysical parameters.

    ``rho_ma`` and ``Rw`` default to None which means "estimate from the logs".
    The matrix density is recovered from RHOZ + NPHI in clean intervals; the
    water resistivity is recovered from the minimum apparent water resistivity
    (Rwa) in clean, porous, presumed-wet intervals. The resolved values are
    written back into ``params_used`` on the result so the UI and the AI
    interpreter can see what was actually applied.
    """

    rho_ma: Optional[float] = None  # g/cc; None → auto-estimate
    rho_fl: float = 1.00            # fluid density (g/cc)
    Rw: Optional[float] = None      # ohm.m; None → auto-estimate (Rwa method)
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
    SP: np.ndarray
    Vsh: np.ndarray
    phi_eff: np.ndarray
    Sw: np.ndarray
    Shc: np.ndarray
    BVW: np.ndarray
    hc_type: np.ndarray              # int8 0/1/2
    lith_flag: np.ndarray            # int8 0/1/2/3
    permeable_sp: np.ndarray         # bool; True where SP indicates permeable rock

    # Scalars
    GR_clean: float = 0.0
    GR_shale: float = 0.0
    mean_GR: float = 0.0
    mean_RT: float = 0.0
    mean_NPHI: float = 0.0
    mean_phi_eff: float = 0.0
    mean_Sw: float = 0.0
    pef_distribution: dict = field(default_factory=dict)

    # Auto-estimation diagnostics (helpful for UI + AI explanation)
    rho_ma_auto: bool = False
    Rw_auto: bool = False
    sp_shale_baseline: Optional[float] = None
    sp_sand_line: Optional[float] = None
    sp_used: bool = False
    used_phi_input: bool = False
    used_sw_input: bool = False

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
# Auto-estimation helpers
# ---------------------------------------------------------------------------


def _auto_rho_ma(
    RHOZ: np.ndarray, NPHI: np.ndarray, Vsh: np.ndarray, rho_fl: float
) -> float:
    """Recover the matrix density from RHOZ + NPHI in clean intervals.

    Standard apparent matrix density relation:

        rho_ma_app = (rho_b - phi * rho_fl) / (1 - phi)

    Restrict the population to clean, non-pathological samples (low Vsh,
    sensible neutron porosity range) and take the median. Falls back to a
    sensible limestone value (2.71) when there's not enough good data.
    """
    if (
        RHOZ.size == 0
        or not np.any(np.isfinite(RHOZ))
        or not np.any(np.isfinite(NPHI))
    ):
        return 2.71

    finite_vsh = np.where(np.isfinite(Vsh), Vsh, 1.0)
    mask = (
        np.isfinite(RHOZ)
        & np.isfinite(NPHI)
        & (finite_vsh < 0.20)
        & (NPHI > 0.02)
        & (NPHI < 0.30)
        & (RHOZ > 2.20)  # exclude obvious gas effect / cave-ins
    )
    if int(mask.sum()) < 50:
        return 2.71

    phi = NPHI[mask]
    rho_b = RHOZ[mask]
    with np.errstate(divide="ignore", invalid="ignore"):
        rho_ma_app = (rho_b - phi * rho_fl) / (1.0 - phi)
    rho_ma_app = rho_ma_app[np.isfinite(rho_ma_app)]
    if rho_ma_app.size < 50:
        return 2.71

    val = float(np.median(rho_ma_app))
    return max(2.55, min(3.00, val))


def _auto_rw(
    RT: np.ndarray,
    phi_eff: np.ndarray,
    Vsh: np.ndarray,
    a: float,
    m: float,
) -> float:
    """Recover Rw from the minimum apparent water resistivity in clean rock.

    In any sample, ``Rwa = Rt * phi^m / a``. In a water-bearing zone
    (Sw = 1) Rwa equals Rw; in hydrocarbon zones Rwa is much higher.
    Taking the p10 of Rwa over clean, porous, finite samples therefore
    yields a robust estimate of Rw that does not depend on the user.
    """
    finite_vsh = np.where(np.isfinite(Vsh), Vsh, 1.0)
    mask = (
        np.isfinite(RT)
        & np.isfinite(phi_eff)
        & (finite_vsh < 0.30)
        & (phi_eff > 0.08)
        & (RT > 0.1)
        & (RT < 2000.0)
    )
    if int(mask.sum()) < 50:
        return 0.10

    with np.errstate(invalid="ignore"):
        rwa = RT[mask] * np.power(phi_eff[mask], m) / max(a, 1e-6)
    rwa = rwa[np.isfinite(rwa) & (rwa > 0)]
    if rwa.size < 20:
        return 0.10

    val = float(np.percentile(rwa, 10))
    return max(0.01, min(5.0, val))


def _sp_permeable_mask(
    SP: np.ndarray, Vsh: np.ndarray
) -> tuple[np.ndarray, Optional[float], Optional[float], bool]:
    """Derive a permeability flag from the SP curve.

    Returns ``(permeable_mask, shale_baseline, sand_line, used)``.

    The standard "two-line" interpretation is used: the shale baseline is the
    median SP in high-Vsh rock, the sand line is the p10 of SP in clean rock,
    and a sample is considered permeable when its SP deflects at least 30 % of
    SSP toward the sand line. If SP is missing or SSP is too small to be
    meaningful, ``used`` is False and the returned mask is all True (i.e. the
    SP filter is effectively disabled).
    """
    n = SP.size
    if n == 0 or not np.any(np.isfinite(SP)):
        return np.ones(n, dtype=bool), None, None, False

    finite_vsh = np.where(np.isfinite(Vsh), Vsh, 0.5)
    shale_mask = np.isfinite(SP) & (finite_vsh > 0.55)
    sand_mask = np.isfinite(SP) & (finite_vsh < 0.25)
    if int(shale_mask.sum()) < 25 or int(sand_mask.sum()) < 25:
        return np.ones(n, dtype=bool), None, None, False

    shale_baseline = float(np.median(SP[shale_mask]))
    # sand_line is the SP value most "deflected" relative to shale. SP can be
    # negative or positive polarity depending on the borehole / mud system, so
    # we pick the percentile that is furthest from the baseline.
    sand_low = float(np.percentile(SP[sand_mask], 10))
    sand_high = float(np.percentile(SP[sand_mask], 90))
    if abs(sand_low - shale_baseline) >= abs(sand_high - shale_baseline):
        sand_line = sand_low
    else:
        sand_line = sand_high

    ssp = sand_line - shale_baseline  # signed: negative for normal polarity
    if abs(ssp) < 8.0:  # mV — too small to be a reliable indicator
        return np.ones(n, dtype=bool), shale_baseline, sand_line, False

    # delta toward sand line, normalised
    with np.errstate(invalid="ignore"):
        deflection = (SP - shale_baseline) / ssp  # 0=shale, 1=sand
    permeable = np.where(np.isfinite(deflection), deflection >= 0.30, False)
    return permeable, shale_baseline, sand_line, True


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
    SP = _extract(df, curve_map, "SP", n)

    with np.errstate(invalid="ignore"):
        # Out-of-range values → NaN, not clipped to bounds (keeps interpretability)
        GR[(GR < 0) | (GR > 350)] = np.nan
        NPHI[(NPHI < -0.05) | (NPHI > 0.80)] = np.nan
        RHOZ[(RHOZ < 1.0) | (RHOZ > 3.5)] = np.nan
        RT[(RT < 0.01) | (RT > 10000)] = np.nan
        PEF[(PEF < 0) | (PEF > 20)] = np.nan
        SP[(SP < -500) | (SP > 500)] = np.nan  # millivolts; absurd values → NaN

    rho_fl = params.rho_fl

    # ----- STEP 3 (pre-pass): Vsh — needed before rho_ma auto-estimation
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
        GR_shale = GR_clean + 1.0
    Vsh = (GR - GR_clean) / (GR_shale - GR_clean)
    Vsh = np.where(np.isfinite(GR), Vsh, np.nan)
    Vsh = np.clip(Vsh, 0.0, 1.0)

    # ----- STEP 2: density porosity (with auto-estimated rho_ma if needed)
    rho_ma_auto = params.rho_ma is None
    if rho_ma_auto:
        rho_ma = _auto_rho_ma(RHOZ, NPHI, Vsh, rho_fl)
    else:
        rho_ma = float(params.rho_ma)

    denom = rho_ma - rho_fl
    if denom == 0:
        DPHI = np.full(n, np.nan, dtype=np.float64)
    else:
        with np.errstate(invalid="ignore"):
            DPHI = (rho_ma - RHOZ) / denom
        DPHI = np.where(np.isfinite(RHOZ), DPHI, np.nan)
    DPHI = np.clip(DPHI, -0.20, 0.65)

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

    used_phi_input = False
    used_sw_input = False

    # Optional vendor / ELAN effective porosity (PIGN, PHIT, …) overrides ND-MIN model.
    phi_vendor = _extract(df, curve_map, "PHI_INPUT", n)
    if np.any(np.isfinite(phi_vendor)):
        phi_vendor = np.where(
            np.isfinite(phi_vendor) & (phi_vendor >= -0.05) & (phi_vendor <= 0.65),
            phi_vendor,
            np.nan,
        )
        mask_pv = np.isfinite(phi_vendor)
        if np.any(mask_pv):
            phi_eff = np.where(mask_pv, np.clip(phi_vendor, 0.001, 0.50), phi_eff)
            used_phi_input = True

    # ----- STEP 5: Archie water saturation (with auto-estimated Rw if needed)
    Rw_auto = params.Rw is None
    if Rw_auto:
        Rw = _auto_rw(RT, phi_eff, Vsh, params.a, params.m)
    else:
        Rw = float(params.Rw)

    with np.errstate(divide="ignore", invalid="ignore"):
        Sw_arch = np.power(
            (params.a * Rw) / (np.power(phi_eff, params.m) * RT),
            1.0 / params.n,
        )
    Sw_arch = np.where(np.isfinite(RT) & np.isfinite(phi_eff), Sw_arch, np.nan)
    Sw_arch = np.clip(Sw_arch, 0.0, 1.0)

    sw_log = _extract(df, curve_map, "SW_INPUT", n)
    if np.any(np.isfinite(sw_log)):
        sl = sw_log[np.isfinite(sw_log)]
        if sl.size and float(np.nanmedian(sl)) > 1.5:
            with np.errstate(invalid="ignore"):
                sw_log = np.where(np.isfinite(sw_log), sw_log / 100.0, sw_log)
        sw_log = np.where((sw_log >= 0) & (sw_log <= 1.5), sw_log, np.nan)
        sw_log = np.clip(sw_log, 0.0, 1.0)

    if np.any(np.isfinite(sw_log)):
        Sw = np.where(np.isfinite(sw_log), sw_log, Sw_arch)
        used_sw_input = True
    else:
        Sw = Sw_arch
    Sw = np.clip(Sw, 0.0, 1.0)
    Shc = 1.0 - Sw
    BVW = phi_eff * Sw

    # ----- STEP 6: gas crossover (NPHI–DPHI) + optional RST / ELAN gas curves (VXGA, SXGA)
    gas_crossover = np.zeros(n, dtype=bool)
    both = np.isfinite(DPHI) & np.isfinite(NPHI)
    gas_crossover[both] = (DPHI[both] - NPHI[both]) > 0.03
    gflag = _extract(df, curve_map, "GAS_FLAG", n)
    if np.any(np.isfinite(gflag)):
        gas_crossover = gas_crossover | (np.isfinite(gflag) & (gflag > 0.02))

    # ----- STEP 6b: SP-derived permeability flag
    permeable_sp, sp_baseline, sp_sand_line, sp_used = _sp_permeable_mask(SP, Vsh)

    # ----- STEP 7: data quality mask
    # NOTE: we deliberately do NOT require both NPHI and RHOZ to be finite
    # here. `phi_eff` already encodes "we have at least one porosity log"
    # (it falls back to whichever of NPHI / DPHI is available). Requiring
    # both individually would punch spurious gaps into HC zones whenever a
    # single porosity sample is null (e.g. a -999 NPHI spike), even though
    # the petrophysics at that depth is perfectly well-defined.
    valid_mask = (
        np.isfinite(GR)
        & np.isfinite(phi_eff)
        & np.isfinite(Sw)
    )

    # ----- STEP 8: HC detection
    finite_rt = np.isfinite(RT)
    rt_pass = np.where(finite_rt, RT > params.Rt_cutoff, True)
    # SP filter is applied softly: when SP is unavailable / inconclusive the
    # mask is all-True so it has no effect; otherwise samples that the SP
    # interprets as impermeable shale are excluded even when the saturation
    # equation alone would have qualified them.
    hc_mask = (
        valid_mask
        & (Vsh < params.Vsh_cutoff)
        & (phi_eff > params.phi_cutoff)
        & rt_pass
        & (Shc > params.Shc_cutoff)
        & permeable_sp
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

    # Resolved params actually applied (auto-estimates filled in if needed)
    resolved_params = PetroParams(
        rho_ma=rho_ma,
        rho_fl=rho_fl,
        Rw=Rw,
        a=params.a,
        m=params.m,
        n=params.n,
        GR_clean=GR_clean,
        GR_shale=GR_shale,
        Rt_cutoff=params.Rt_cutoff,
        Shc_cutoff=params.Shc_cutoff,
        phi_cutoff=params.phi_cutoff,
        Vsh_cutoff=params.Vsh_cutoff,
        Sw_producible=params.Sw_producible,
    )

    return PetroResult(
        depth=depth,
        GR=GR,
        NPHI=NPHI,
        DPHI=DPHI,
        RHOZ=RHOZ,
        RT=RT,
        PEF=PEF,
        SP=SP,
        Vsh=Vsh,
        phi_eff=phi_eff,
        Sw=Sw,
        Shc=Shc,
        BVW=BVW,
        hc_type=hc_type,
        lith_flag=lith_flag,
        permeable_sp=permeable_sp,
        GR_clean=GR_clean,
        GR_shale=GR_shale,
        mean_GR=mean_GR,
        mean_RT=mean_RT,
        mean_NPHI=mean_NPHI,
        mean_phi_eff=mean_phi_eff,
        mean_Sw=mean_Sw,
        pef_distribution=pef_distribution,
        rho_ma_auto=rho_ma_auto,
        Rw_auto=Rw_auto,
        sp_shale_baseline=sp_baseline,
        sp_sand_line=sp_sand_line,
        sp_used=sp_used,
        used_phi_input=used_phi_input,
        used_sw_input=used_sw_input,
        zones=all_zones,
        params_used=resolved_params,
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
