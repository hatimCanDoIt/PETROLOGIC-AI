"""Deterministic petrophysical analysis engine.

Pipeline (aligned with industry-standard practice and the petroleum engineer's
reference workflow in ``The_Techlog_Automator``):

  1. Extract & quality-filter curves (out-of-range → NaN, never clipped to a
     bogus floor that would propagate through Archie).
  2. Vsh from gamma ray, linear normalisation between p10 (clean) and p90
     (shale).
  3. Total porosity PHIT — precedence:
       (a) vendor / ELAN PHIT/PHIE/PIGN if present
       (b) neutron–density average where both are finite
       (c) DPHI from RHOZ (with auto-estimated rho_ma)
       (d) NPHI alone
  4. Effective porosity PHIE = PHIT · (1 − Vsh).
     Multiplicative shale correction is numerically stable; it never produces
     negative porosity from a "subtract too much" misadventure the way
     ``phi_nd − 0.35·Vsh`` could.
  5. Water saturation:
       • prefer a processed Sw curve (SUWI / SXWI) when the file ships one
       • else Archie: Sw = ((a·Rw)/(φ^m · Rt))^(1/n)
       • φ < 0.02 → Sw is left as NaN (Archie blows up at vanishing porosity;
         the previous engine clamped φ to 0.001 which produced spurious
         "Sw=1.0 / Shc=0.0" bands in tight rock and made the saturation track
         look like it had gone to extremes below ~2500 ft).
  6. Gas crossover flag (DPHI > NPHI by xover threshold).
  7. Data quality mask.
  8. HC detection (oil vs gas) — joint cutoffs on Vsh, φ, Rt, Sw, optional SP
     permeability, plus gas crossover or processed gas indicator.
  9. Lithology from PEF.
 10. Contiguous-interval (zone) detection. Short data drop-outs (≤ ≈1.5 ft)
     inside an otherwise pay-flagged interval are bridged so a single noisy
     sample no longer splits one zone into several 2 ft slivers.
 11. Well statistics.

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
# Vsh-from-GR model library
#
# All models take IGR (gamma-ray index) in [0, 1] and return Vsh in [0, 1].
# IGR = (GR - GR_clean) / (GR_shale - GR_clean) is computed once at the
# engine level and shared across regimes.
#
# Model selection is significant:
#   - "linear" is conservative; the default. Tends to OVER-estimate Vsh in
#     consolidated rocks because real GR-Vsh response is non-linear.
#   - "larionov_tertiary" — soft, geologically-recent (Tertiary) clastics.
#     Gives lower Vsh than linear at the same GR.
#   - "larionov_pre_tertiary" — older / harder rocks. Between linear and
#     Tertiary Larionov in aggressiveness.
#   - "clavier" — empirical fit; similar to Larionov but with a different
#     curvature; commonly cited in Schlumberger logs.
#   - "stieber" — sharper curvature than Larionov; designed for shaly sands.
# ---------------------------------------------------------------------------


VSH_MODELS = ("linear", "larionov_tertiary", "larionov_pre_tertiary", "clavier", "stieber")


def _vsh_from_igr(igr: np.ndarray, model: str) -> np.ndarray:
    """Convert a GR index array into a Vsh array using the named model.

    ``igr`` may contain NaNs — they are propagated unchanged. Output is
    clipped to ``[0, 1]``. Unknown models fall back to ``linear``.
    """
    igr_c = np.clip(igr, 0.0, 1.0)
    with np.errstate(invalid="ignore"):
        if model == "larionov_tertiary":
            v = 0.083 * (np.power(2.0, 3.7 * igr_c) - 1.0)
        elif model == "larionov_pre_tertiary":
            v = 0.33 * (np.power(2.0, 2.0 * igr_c) - 1.0)
        elif model == "clavier":
            inner = 3.38 - np.power(igr_c + 0.7, 2.0)
            inner = np.where(inner < 0.0, 0.0, inner)
            v = 1.7 - np.sqrt(inner)
        elif model == "stieber":
            denom = 3.0 - 2.0 * igr_c
            v = np.where(denom > 0, igr_c / denom, np.nan)
        else:  # "linear" or unknown
            v = igr_c
    v = np.where(np.isfinite(igr), v, np.nan)
    return np.clip(v, 0.0, 1.0)


# ---------------------------------------------------------------------------
# Regime overrides
# ---------------------------------------------------------------------------


@dataclass
class Regime:
    """A depth-bounded override of the petrophysics model choices.

    Used by the ``llm_params`` analysis mode: the LLM looks at the curves
    and emits one Regime per geological interval (clean Tertiary sand,
    shaly Pre-Tertiary section, tight carbonate, etc.) telling the
    deterministic engine *how* to compute Vsh and Sw inside that window.
    Outside any regime the engine falls back to the global ``PetroParams``.

    All optional fields default to ``None`` meaning "inherit from globals".
    """

    top_ft: float
    bot_ft: float
    vsh_model: str = "linear"
    a: Optional[float] = None
    m: Optional[float] = None
    n: Optional[float] = None
    Rw: Optional[float] = None
    lithology: str = ""  # interpretive label only — not used in math
    rationale: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


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
    GR_clean: Optional[float] = None  # override; else auto from p10
    GR_shale: Optional[float] = None  # override; else auto from p90
    Rt_cutoff: float = 10.0           # ohm.m — pay if Rt > cutoff
    # Shc_cutoff is the legacy expression of the Sw cutoff: a sample is "pay"
    # when Shc > Shc_cutoff, i.e. Sw < (1 − Shc_cutoff). Default 0.50 means
    # Sw < 0.50 (industry-typical for confirmed-pay; previous default 0.35 was
    # equivalent to Sw < 0.65 which let too many fresh-water-charged shallow
    # zones through).
    Shc_cutoff: float = 0.50
    phi_cutoff: float = 0.08          # min effective porosity for pay
    Vsh_cutoff: float = 0.35          # max shale volume for pay
    Sw_producible: float = 0.50       # below this Sw a sample is "producible"

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
    RT_shallow: np.ndarray
    RT_micro: np.ndarray
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
    Rw_method: str = ""  # e.g. sp_ssp, rwa_curve_p10, rwa_computed_p10, manual
    rmf_bht: Optional[float] = None
    ssp_mv: Optional[float] = None
    rw_sp: Optional[float] = None
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
    *,
    rwa_curve: Optional[np.ndarray] = None,
    las_rw: Optional[float] = None,
) -> tuple[float, str]:
    """Recover Rw using the log method (minimum apparent water resistivity).

    Prefer a vendor **RWA** curve when the LAS ships one — that is the
    Schlumberger / GeoFrame apparent-water-resistivity track and is the
    standard "log method" for picking Rw in clean, water-bearing rock.
    Otherwise recompute ``Rwa = Rt · φ^m / a`` from the deep resistivity
    and effective porosity.

    In water zones (Sw ≈ 1) Rwa equals Rw; in hydrocarbon zones Rwa is
    much higher. The p10 over clean, porous samples yields a robust Rw
    that is insensitive to pay intervals.
    """
    finite_vsh = np.where(np.isfinite(Vsh), Vsh, 1.0)
    mask = (
        np.isfinite(phi_eff)
        & (finite_vsh < 0.30)
        & (phi_eff > 0.08)
    )

    if rwa_curve is not None and np.any(np.isfinite(rwa_curve)):
        rwa_mask = mask & np.isfinite(rwa_curve) & (rwa_curve > 0.005) & (rwa_curve < 50.0)
        if int(rwa_mask.sum()) >= 20:
            rwa = rwa_curve[rwa_mask]
            val = float(np.percentile(rwa, 10))
            return max(0.01, min(5.0, val)), "rwa_curve_p10"

    rt_mask = (
        mask
        & np.isfinite(RT)
        & (RT > 0.1)
        & (RT < 2000.0)
    )
    if int(rt_mask.sum()) < 50:
        if las_rw is not None and las_rw > 0:
            return max(0.01, min(5.0, float(las_rw))), "las_header"
        return 0.10, "default_fallback"

    with np.errstate(invalid="ignore"):
        rwa = RT[rt_mask] * np.power(phi_eff[rt_mask], m) / max(a, 1e-6)
    rwa = rwa[np.isfinite(rwa) & (rwa > 0)]
    if rwa.size < 20:
        if las_rw is not None and las_rw > 0:
            return max(0.01, min(5.0, float(las_rw))), "las_header"
        return 0.10, "default_fallback"

    val = float(np.percentile(rwa, 10))
    return max(0.01, min(5.0, val)), "rwa_computed_p10"


def _parse_las_rw(raw_params: Optional[dict]) -> Optional[float]:
    """Best-effort read of ``RW`` from LAS ~Parameter (ohm·m)."""
    if not raw_params:
        return None
    for key in ("RW", "RWF", "RW@FT"):
        raw = raw_params.get(key)
        if raw is None:
            continue
        try:
            val = float(str(raw).strip().split()[0])
        except (ValueError, TypeError, IndexError):
            continue
        if np.isfinite(val) and 0.001 < val < 20.0:
            return val
    return None


def _parse_bht_f(raw_params: Optional[dict]) -> float:
    """Formation / bottom-hole temperature (°F) from LAS header."""
    if raw_params:
        for key in ("BHT", "MRT", "FTMP"):
            raw = raw_params.get(key)
            if raw is None:
                continue
            try:
                val = float(str(raw).strip().split()[0])
            except (ValueError, TypeError, IndexError):
                continue
            if np.isfinite(val) and 40.0 < val < 500.0:
                return val
    return 150.0


def _parse_las_rmf_sample(raw_params: Optional[dict]) -> tuple[Optional[float], float]:
    """Mud-filtrate resistivity (ohm·m) and sample temperature (°F) from LAS header."""
    sample_temp = 75.0
    if raw_params:
        for key in ("MFST", "MCST", "MST"):
            raw = raw_params.get(key)
            if raw is None:
                continue
            try:
                val = float(str(raw).strip().split()[0])
            except (ValueError, TypeError, IndexError):
                continue
            if np.isfinite(val) and 40.0 < val < 250.0:
                sample_temp = val
                break
        for key in ("RMFS", "RMF", "RMS"):
            raw = raw_params.get(key)
            if raw is None:
                continue
            try:
                val = float(str(raw).strip().split()[0])
            except (ValueError, TypeError, IndexError):
                continue
            if np.isfinite(val) and 0.001 < val < 20.0:
                return val, sample_temp
    return None, sample_temp


def _temp_correct_resistivity_f(R_at_T1: float, T1_F: float, T2_F: float) -> float:
    """Arps temperature correction for NaCl brines (°F)."""
    return R_at_T1 * (T1_F + 6.0) / (T2_F + 6.0)


def _rmf_at_bht(raw_params: Optional[dict]) -> Optional[float]:
    """Mud-filtrate resistivity corrected to bottom-hole temperature."""
    rmf, t_sample = _parse_las_rmf_sample(raw_params)
    if rmf is None:
        return None
    bht = _parse_bht_f(raw_params)
    return _temp_correct_resistivity_f(rmf, t_sample, bht)


def _sp_k_coefficient(temp_F: float) -> float:
    """SP coefficient *K* (mV) at formation temperature."""
    return 61.0 + 0.077 * (temp_F - 75.0)


def _rw_from_sp_deflection(Rmf: float, deflection_mv: float, k: float) -> float:
    """Rw from SP deflection: ``|ΔSP| = K · log10(Rmf / Rw)``."""
    if deflection_mv <= 1.0 or Rmf <= 0 or k <= 0:
        return float("nan")
    return float(Rmf / np.power(10.0, deflection_mv / k))


def _rw_sp_per_sample(
    SP: np.ndarray,
    sp_shale: float,
    Rmf_bht: float,
    k: float,
    Vsh: np.ndarray,
    permeable_sp: np.ndarray,
    *,
    vsh_max: float = 0.35,
) -> np.ndarray:
    """Depth-varying Rw from SP in clean, permeable rock."""
    deflection = np.abs(SP - sp_shale)
    with np.errstate(invalid="ignore", divide="ignore"):
        rw = Rmf_bht / np.power(10.0, deflection / k)
    use = (
        permeable_sp
        & np.isfinite(Vsh)
        & (Vsh < vsh_max)
        & np.isfinite(SP)
        & np.isfinite(rw)
        & (rw > 0)
    )
    out = np.full(SP.size, np.nan, dtype=np.float64)
    out[use] = np.clip(rw[use], 0.001, 5.0)
    return out


def _compute_rwa(
    RT: np.ndarray,
    phi_eff: np.ndarray,
    a_arr: np.ndarray,
    m_arr: np.ndarray,
) -> np.ndarray:
    """Apparent water resistivity: ``Rwa = Rt · φ^m / a``."""
    with np.errstate(invalid="ignore", divide="ignore"):
        rwa = RT * np.power(phi_eff, m_arr) / np.maximum(a_arr, 1e-6)
    return np.where(np.isfinite(RT) & np.isfinite(phi_eff) & (rwa > 0), rwa, np.nan)


def _flushed_resistivity(*arrays: Optional[np.ndarray]) -> np.ndarray:
    """Maximum finite shallow / micro resistivity per sample."""
    valid = [a for a in arrays if a is not None and a.size]
    if not valid:
        return np.array([], dtype=np.float64)
    n = valid[0].size
    stacked = np.stack(valid, axis=0)
    with np.errstate(invalid="ignore"):
        return np.nanmax(stacked, axis=0)


def _build_pay_masks(
    *,
    valid_mask: np.ndarray,
    Vsh: np.ndarray,
    phi_eff: np.ndarray,
    Shc: np.ndarray,
    RT: np.ndarray,
    RT_rxo: np.ndarray,
    Rwa: np.ndarray,
    Rw_arr: np.ndarray,
    params: PetroParams,
    permeable_sp: np.ndarray,
    gas_crossover: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Oil and gas pay sample masks.

    Classic high-Rt pay uses ``Rt > Rt_cutoff``.  In low-resistivity /
    fresh-water reservoirs, pay is flagged when the log shows the
    **Rwa > Rw** hydrocarbon signature *and* a flushed-zone resistivity
    much higher than deep Rt (invasion profile).
    """
    finite_rt = np.isfinite(RT)
    rt_high = finite_rt & (RT > params.Rt_cutoff)

    with np.errstate(invalid="ignore", divide="ignore"):
        rwa_ratio = Rwa / Rw_arr
        invasion = RT_rxo / RT

    rwa_hc = np.isfinite(rwa_ratio) & (rwa_ratio > 1.25)
    invaded = np.isfinite(invasion) & (invasion > 1.35)
    low_rt_pay = invaded & rwa_hc & permeable_sp
    rt_pass = rt_high | low_rt_pay

    hc_mask = (
        valid_mask
        & (Vsh < params.Vsh_cutoff)
        & (phi_eff > params.phi_cutoff)
        & rt_pass
        & (Shc > params.Shc_cutoff)
        & permeable_sp
    )
    return hc_mask & ~gas_crossover, hc_mask & gas_crossover


def _phi_from_neutron_density(
    NPHI: np.ndarray,
    DPHI: np.ndarray,
    *,
    xover: float = 0.03,
) -> np.ndarray:
    """Combine neutron and density porosity with gas / shale-aware weighting.

    * Gas crossover (DPHI − NPHI > xover): arithmetic average — both logs
      are depressed / inflated in opposite directions and the mean is stable.
    * Neutron shale spike (NPHI − DPHI > xover): DPHI-weighted blend because
      clay-bound water inflates the neutron in shaly sands.
    * Otherwise: simple average.
    """
    has_n = np.isfinite(NPHI)
    has_d = np.isfinite(DPHI)
    both = has_n & has_d
    out = np.full(NPHI.size, np.nan, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        avg = (NPHI + DPHI) / 2.0
        d_weighted = (2.0 * DPHI + NPHI) / 3.0
        gas = both & ((DPHI - NPHI) > xover)
        shaly_n = both & ((NPHI - DPHI) > xover) & ~gas
        out = np.where(
            both,
            np.where(gas, avg, np.where(shaly_n, d_weighted, avg)),
            np.where(has_d, DPHI, np.where(has_n, NPHI, np.nan)),
        )
    return out


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

    # Shale = high SP (near baseline); sand = low SP (deflected). Enforce that
    # ordering even if local mask statistics invert.
    shale_baseline = float(np.median(SP[shale_mask]))
    sand_line = float(np.percentile(SP[sand_mask], 10))
    if shale_baseline < sand_line:
        shale_baseline, sand_line = sand_line, shale_baseline

    ssp = sand_line - shale_baseline  # negative when sand deflects lower
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
    df: pd.DataFrame,
    curve_map: dict,
    params: PetroParams,
    regimes: Optional[list[Regime]] = None,
    las_raw_params: Optional[dict] = None,
) -> PetroResult:
    """Run the full deterministic petrophysical pipeline.

    When ``regimes`` is provided, depth-bounded overrides are applied to
    Vsh-from-GR (model selection) and to Archie's equation (a/m/n/Rw).
    Outside any regime, globals from ``params`` apply. This is how the
    ``llm_params`` analysis mode injects per-interval choices without
    bypassing the deterministic numerics.
    """
    if "DEPT" not in df.columns:
        raise ValueError("DataFrame must contain a 'DEPT' column.")

    depth = df["DEPT"].to_numpy(dtype=np.float64, copy=True)
    n = len(depth)

    # ----- STEP 1: extract & clean
    GR = _extract(df, curve_map, "GR", n)
    NPHI = _extract(df, curve_map, "NPHI", n)
    RHOZ = _extract(df, curve_map, "RHOZ", n)
    RT = _extract(df, curve_map, "RT", n)
    RT_shallow = _extract(df, curve_map, "RT_SHALLOW", n)
    RT_micro = _extract(df, curve_map, "RT_MICRO", n)
    PEF = _extract(df, curve_map, "PEF", n)
    SP = _extract(df, curve_map, "SP", n)

    with np.errstate(invalid="ignore"):
        # Out-of-range values → NaN, not clipped to bounds (keeps interpretability)
        GR[(GR < 0) | (GR > 350)] = np.nan
        NPHI[(NPHI < -0.05) | (NPHI > 0.80)] = np.nan
        RHOZ[(RHOZ < 1.0) | (RHOZ > 3.5)] = np.nan
        RT[(RT < 0.01) | (RT > 10000)] = np.nan
        for _rt_arr in (RT_shallow, RT_micro):
            _rt_arr[(_rt_arr < 0.01) | (_rt_arr > 10000)] = np.nan
        PEF[(PEF < 0) | (PEF > 20)] = np.nan
        SP[(SP < -500) | (SP > 500)] = np.nan  # millivolts; absurd values → NaN

    rho_fl = params.rho_fl

    # ----- STEP 3 (pre-pass): Vsh — needed before rho_ma auto-estimation.
    # We use p10 / p90 endpoints (rather than p5 / p90) to follow the
    # reference engine: p5 is too sensitive to a few low GR outliers in
    # carbonate / coal sections and pushes the clean baseline unrealistically
    # low.
    GR_clean = (
        params.GR_clean
        if params.GR_clean is not None
        else _nanpercentile_safe(GR, 10, 30.0)
    )
    GR_shale = (
        params.GR_shale
        if params.GR_shale is not None
        else _nanpercentile_safe(GR, 90, 120.0)
    )
    if GR_shale - GR_clean < 1.0:
        GR_shale = GR_clean + 1.0
    igr = (GR - GR_clean) / (GR_shale - GR_clean)
    igr = np.where(np.isfinite(GR), igr, np.nan)
    # Default Vsh: linear model (the historical engine behavior).
    Vsh = _vsh_from_igr(igr, "linear")
    # Apply regime-specific Vsh model overrides where they are set.
    if regimes:
        for r in regimes:
            if not r.vsh_model or r.vsh_model == "linear":
                continue
            if r.vsh_model not in VSH_MODELS:
                continue
            mask = (depth >= r.top_ft) & (depth < r.bot_ft)
            if not np.any(mask):
                continue
            Vsh[mask] = _vsh_from_igr(igr[mask], r.vsh_model)

    # ----- STEP 2: density porosity (with auto-estimated rho_ma if needed)
    rho_ma_auto = params.rho_ma is None
    if rho_ma_auto:
        rho_ma = _auto_rho_ma(RHOZ, NPHI, Vsh, rho_fl)
    else:
        rho_ma = float(params.rho_ma)

    denom = rho_ma - rho_fl
    dphi_vendor = _extract(df, curve_map, "DPHI_INPUT", n)
    has_dphi_vendor = (
        np.isfinite(dphi_vendor)
        & (dphi_vendor >= -0.20)
        & (dphi_vendor <= 0.65)
    )
    if denom == 0:
        DPHI = np.full(n, np.nan, dtype=np.float64)
    else:
        with np.errstate(invalid="ignore"):
            DPHI = (rho_ma - RHOZ) / denom
        DPHI = np.where(np.isfinite(RHOZ), DPHI, np.nan)
        DPHI = np.clip(DPHI, -0.20, 0.65)
    if np.any(has_dphi_vendor):
        DPHI = np.where(has_dphi_vendor, dphi_vendor, DPHI)

    used_phi_input = False
    used_sw_input = False

    # ----- STEP 4: effective porosity using a multiplicative shale correction
    # PHIE = PHIT · (1 − Vsh).  This is the formulation used by the petroleum
    # engineer's reference engine and is materially more stable than the old
    # ``phi_nd − 0.35·Vsh`` model: it cannot drive φ negative in shaley sands
    # and it never bottoms out at a fake 0.001 floor that propagates absurd
    # Sw values through Archie.
    has_nphi = np.isfinite(NPHI)
    has_dphi = np.isfinite(DPHI)

    # Optional vendor / ELAN total porosity (PIGN, PHIT, TPHI, …) takes
    # precedence over the in-house calculation when available.
    phi_vendor = _extract(df, curve_map, "PHI_INPUT", n)
    has_vendor = (
        np.isfinite(phi_vendor)
        & (phi_vendor >= -0.05)
        & (phi_vendor <= 0.65)
    )
    if not np.any(has_vendor):
        phi_vendor = np.full(n, np.nan, dtype=np.float64)

    with np.errstate(invalid="ignore"):
        phi_nd = _phi_from_neutron_density(NPHI, DPHI)
        phi_total = np.where(
            has_vendor,
            phi_vendor,
            phi_nd,
        )
    phi_total = np.clip(phi_total, 0.0, 0.6)

    if np.any(has_vendor):
        used_phi_input = True

    vsh_for_phi = np.where(np.isfinite(Vsh), Vsh, 0.0)
    with np.errstate(invalid="ignore"):
        phi_eff = phi_total * (1.0 - vsh_for_phi)
    phi_eff = np.where(np.isfinite(phi_total), phi_eff, np.nan)
    phi_eff = np.clip(phi_eff, 0.0, 0.5)

    # ----- STEP 4b: SP-derived permeability (needed before Rw / Sw)
    permeable_sp, sp_baseline, sp_sand_line, sp_used = _sp_permeable_mask(SP, Vsh)
    Rmf_bht = _rmf_at_bht(las_raw_params)
    bht_f = _parse_bht_f(las_raw_params)
    k_sp = _sp_k_coefficient(bht_f)
    ssp_mv: Optional[float] = None
    rw_sp_global: Optional[float] = None
    if sp_used and Rmf_bht and sp_baseline is not None and sp_sand_line is not None:
        ssp_mv = float(sp_sand_line - sp_baseline)
        rw_sp_global = _rw_from_sp_deflection(Rmf_bht, abs(ssp_mv), k_sp)

    # ----- STEP 5: water saturation
    Rw_auto = params.Rw is None
    Rw_method = "manual"
    if Rw_auto:
        RWA = _extract(df, curve_map, "RWA", n)
        RWA[(RWA < 0.005) | (RWA > 50.0)] = np.nan
        las_rw = _parse_las_rw(las_raw_params)
        rwa_rw, rwa_method = _auto_rw(
            RT,
            phi_eff,
            Vsh,
            params.a,
            params.m,
            rwa_curve=RWA if np.any(np.isfinite(RWA)) else None,
            las_rw=las_rw,
        )
        if (
            rw_sp_global is not None
            and np.isfinite(rw_sp_global)
            and rw_sp_global > 0
        ):
            Rw = float(rw_sp_global)
            Rw_method = "sp_ssp"
        else:
            Rw = rwa_rw
            Rw_method = rwa_method
    else:
        Rw = float(params.Rw)

    # Build per-sample Archie parameter arrays (so regime overrides are
    # vectorised). Defaults are the globals; overrides come from regimes.
    a_arr = np.full(n, params.a, dtype=np.float64)
    m_arr = np.full(n, params.m, dtype=np.float64)
    n_arr = np.full(n, params.n, dtype=np.float64)
    Rw_arr = np.full(n, Rw, dtype=np.float64)
    if sp_used and Rmf_bht and sp_baseline is not None:
        rw_sp_pts = _rw_sp_per_sample(
            SP, sp_baseline, Rmf_bht, k_sp, Vsh, permeable_sp
        )
        Rw_arr = np.where(np.isfinite(rw_sp_pts), rw_sp_pts, Rw_arr)
    if regimes:
        for r in regimes:
            mask = (depth >= r.top_ft) & (depth < r.bot_ft)
            if not np.any(mask):
                continue
            if r.a is not None and r.a > 0:
                a_arr[mask] = float(r.a)
            if r.m is not None and r.m > 0:
                m_arr[mask] = float(r.m)
            if r.n is not None and r.n > 0:
                n_arr[mask] = float(r.n)
            if r.Rw is not None and r.Rw > 0:
                Rw_arr[mask] = float(r.Rw)

    # CRITICAL: do not feed Archie a hard-clamped tiny porosity. Below the
    # numerical-floor threshold the Sw equation explodes, then gets clipped
    # to 1.0, producing the "Sw and Shc go to extremes" effect the user saw
    # below 2500 ft in tight sediments. We instead leave Sw as NaN where φ
    # is too small to compute a meaningful saturation; the UI shows that as
    # a gap rather than as a nonsense flat-line.
    PHI_MIN_FOR_SW = 0.02
    phi_for_sw = np.where(
        np.isfinite(phi_eff) & (phi_eff >= PHI_MIN_FOR_SW), phi_eff, np.nan
    )
    with np.errstate(divide="ignore", invalid="ignore"):
        Sw_arch = np.power(
            (a_arr * Rw_arr) / (np.power(phi_for_sw, m_arr) * RT),
            1.0 / n_arr,
        )
    Sw_arch = np.where(np.isfinite(RT) & np.isfinite(phi_for_sw), Sw_arch, np.nan)
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
    Sw = np.where(np.isfinite(Sw), np.clip(Sw, 0.0, 1.0), np.nan)
    Shc = np.where(np.isfinite(Sw), 1.0 - Sw, np.nan)
    BVW = np.where(
        np.isfinite(phi_eff) & np.isfinite(Sw), phi_eff * Sw, np.nan
    )

    # ----- STEP 6: gas crossover (NPHI–DPHI) + optional RST / ELAN gas curves (VXGA, SXGA)
    gas_crossover = np.zeros(n, dtype=bool)
    both = np.isfinite(DPHI) & np.isfinite(NPHI)
    gas_crossover[both] = (DPHI[both] - NPHI[both]) > 0.03
    gflag = _extract(df, curve_map, "GAS_FLAG", n)
    if np.any(np.isfinite(gflag)):
        gas_crossover = gas_crossover | (np.isfinite(gflag) & (gflag > 0.02))

    RT_rxo = _flushed_resistivity(RT_shallow, RT_micro)
    Rwa = _compute_rwa(RT, phi_for_sw, a_arr, m_arr)

    # In low-resistivity pay, deep Rt underestimates HC saturation. Where
    # invasion is clear (Rxo >> Rt), also compute Archie Sw from the
    # flushed-zone resistivity and use the optimistic Shc for pay flagging.
    with np.errstate(invalid="ignore", divide="ignore"):
        invasion_ratio = RT_rxo / RT
        Sw_flush = np.power(
            (a_arr * Rw_arr) / (np.power(phi_for_sw, m_arr) * RT_rxo),
            1.0 / n_arr,
        )
    Sw_flush = np.clip(Sw_flush, 0.0, 1.0)
    invaded = (
        np.isfinite(invasion_ratio)
        & (invasion_ratio > 1.35)
        & permeable_sp
    )
    Shc_pay = np.where(
        invaded & np.isfinite(Sw_flush),
        np.fmax(Shc, 1.0 - Sw_flush),
        Shc,
    )

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
    oil_mask, gas_mask = _build_pay_masks(
        valid_mask=valid_mask,
        Vsh=Vsh,
        phi_eff=phi_eff,
        Shc=Shc_pay,
        RT=RT,
        RT_rxo=RT_rxo,
        Rwa=Rwa,
        Rw_arr=Rw_arr,
        params=params,
        permeable_sp=permeable_sp,
        gas_crossover=gas_crossover,
    )

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

    # ----- STEP 10: contiguous interval picks. Bridge tiny gaps (≤ ~1.5 ft)
    # inside otherwise pay-flagged runs so a single noisy sample doesn't
    # split one zone into many slivers, and require ≥ 3 ft of cumulative
    # thickness for a zone to count.
    depth_step = _estimate_step(depth)
    gap_samples = max(1, int(round(1.5 / max(depth_step, 0.05))))
    oil_mask_filled = _close_small_gaps(oil_mask, gap_samples)
    gas_mask_filled = _close_small_gaps(gas_mask, gap_samples)
    oil_zones = _find_intervals(
        oil_mask_filled,
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
        gas_mask_filled,
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
        RT_shallow=RT_shallow,
        RT_micro=RT_micro,
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
        Rw_method=Rw_method,
        rmf_bht=Rmf_bht,
        ssp_mv=ssp_mv,
        rw_sp=rw_sp_global if rw_sp_global is not None and np.isfinite(rw_sp_global) else None,
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


def _close_small_gaps(mask: np.ndarray, max_gap_samples: int) -> np.ndarray:
    """Bridge False runs of length ≤ ``max_gap_samples`` between True runs.

    A single noisy sample (e.g. one bad NPHI reading driving phi_eff briefly
    below cutoff) used to split one continuous pay zone into two abutting
    short zones; this fills those tiny holes so the picker sees one run.
    Leading and trailing False runs are left alone — only gaps *between* True
    runs are filled.
    """
    if max_gap_samples <= 0 or mask.size == 0:
        return mask
    out = mask.copy()
    n = out.size
    i = 0
    # Skip leading False — gap-filling only applies between True runs.
    while i < n and not out[i]:
        i += 1
    while i < n:
        # advance over the current True run
        while i < n and out[i]:
            i += 1
        # i now sits at the start of a False run (or at n)
        j = i
        while j < n and not out[j]:
            j += 1
        # j now sits at the start of the next True run (or at n)
        if j < n and (j - i) <= max_gap_samples:
            out[i:j] = True
        i = j
    return out


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
    min_thickness_ft: float = 3.0,
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

        zd = _summarize_index_slice(
            slice(s, e),
            top=top,
            bot=bot,
            zone_type=zone_type,
            Sw=Sw,
            Shc=Shc,
            phi_eff=phi_eff,
            RT=RT,
            GR=GR,
            Vsh=Vsh,
            PEF=PEF,
            BVW=BVW,
            lith_flag=lith_flag,
            Sw_producible=Sw_producible,
        )
        intervals.append(zd)
    return intervals


def _summarize_index_slice(
    sl: slice,
    *,
    top: float,
    bot: float,
    zone_type: str,
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
) -> dict:
    """Build the canonical zone dict from a slice of the per-depth arrays."""
    sw_seg = Sw[sl]
    shc_seg = Shc[sl]
    phi_seg = phi_eff[sl]
    rt_seg = RT[sl]
    gr_seg = GR[sl]
    vsh_seg = Vsh[sl]
    pef_seg = PEF[sl]
    bvw_seg = BVW[sl]
    lith_seg = lith_flag[sl]

    lith_label = _dominant_lith(lith_seg)
    producible_pct = (
        100.0
        * float(np.sum(np.isfinite(sw_seg) & (sw_seg < Sw_producible)))
        / max(1, sw_seg.size)
    )
    hc_pv = _nanmean_safe(phi_seg * shc_seg)

    return {
        "type": zone_type,
        "top_ft": round(top, 2),
        "bot_ft": round(bot, 2),
        "thick_ft": round(max(0.0, bot - top), 2),
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


def summarize_zone_from_result(
    result: "PetroResult",
    *,
    top_ft: float,
    bot_ft: float,
    zone_type: str,
    Sw_producible: float | None = None,
) -> dict | None:
    """Build a canonical zone dict for an externally-supplied (top, bot, type).

    Used by the optional LLM zone picker so its zones are statistically
    described with the **same** math as the deterministic engine — the LLM
    only contributes the where-and-what-fluid call, the curves do the rest.

    Returns ``None`` if the [top, bot) window contains no samples.
    """
    depth = result.depth
    mask = (depth >= top_ft) & (depth < bot_ft)
    if not np.any(mask):
        return None
    idx = np.where(mask)[0]
    s, e = int(idx[0]), int(idx[-1]) + 1
    sw_prod = (
        Sw_producible
        if Sw_producible is not None
        else result.params_used.Sw_producible
    )
    return _summarize_index_slice(
        slice(s, e),
        top=float(top_ft),
        bot=float(bot_ft),
        zone_type=zone_type,
        Sw=result.Sw,
        Shc=result.Shc,
        phi_eff=result.phi_eff,
        RT=result.RT,
        GR=result.GR,
        Vsh=result.Vsh,
        PEF=result.PEF,
        BVW=result.BVW,
        lith_flag=result.lith_flag,
        Sw_producible=sw_prod,
    )


_LITH_CODE_FROM_LABEL = {
    "sandstone": 0, "ss": 0, "sand": 0,
    "dolomite": 1, "dol": 1,
    "limestone": 2, "ls": 2, "carbonate": 2,
    "shale": 3, "uncertain": 3, "?": 3, "": 3,
}


def _interpolate_anchors(
    depth: np.ndarray,
    anchor_depths: np.ndarray,
    anchor_values: np.ndarray,
) -> np.ndarray:
    """Linearly interpolate ``anchor_values`` (sorted by ``anchor_depths``)
    onto the well's full ``depth`` grid. Anchor points containing NaN are
    dropped before interpolation. Outside the anchor range, edge-extend
    (np.interp's default). Returns NaN array if not enough anchors remain.
    """
    finite = np.isfinite(anchor_depths) & np.isfinite(anchor_values)
    if int(finite.sum()) < 2:
        return np.full(depth.size, np.nan, dtype=np.float64)
    ad = anchor_depths[finite]
    av = anchor_values[finite]
    order = np.argsort(ad)
    ad = ad[order]
    av = av[order]
    return np.interp(depth, ad, av)


def apply_llm_curves(
    result: PetroResult,
    anchors: list[dict],
    *,
    Sw_producible: float | None = None,
) -> dict:
    """Replace ``Vsh`` / ``phi_eff`` / ``Sw`` / ``lith_flag`` on ``result``
    with values interpolated from a sparse set of LLM-supplied anchor
    points. Used by the ``llm_full`` analysis mode where Claude is asked
    to read the raw curves and emit its own picture of the rock.

    Each anchor must contain ``depth_ft`` and may contain any of
    ``Vsh``, ``phi_eff``, ``Sw``, ``lith`` (string label or numeric code).
    Missing fields fall back to whatever the deterministic pre-pass put on
    ``result`` so we never end up with all-NaN curves.

    After replacement we recompute ``Shc = 1 - Sw``, ``BVW = phi_eff * Sw``,
    re-run zone detection, and rebuild ``hc_type``. The original
    deterministic ``GR / RT / NPHI / DPHI / RHOZ / PEF / SP`` arrays are
    left untouched — they are inputs the LLM did not redo.

    Returns a metadata dict describing how many anchors were used.
    """
    depth = result.depth
    n = depth.size
    if not anchors:
        return {"anchors_used": 0, "skipped": ["no anchors supplied"]}

    skipped: list[str] = []
    keep_d: list[float] = []
    keep_vsh: list[float] = []
    keep_phi: list[float] = []
    keep_sw: list[float] = []
    keep_lith: list[int] = []

    for raw in anchors:
        try:
            d = float(raw.get("depth_ft"))
        except (TypeError, ValueError):
            skipped.append(f"bad depth: {raw!r}")
            continue
        if not np.isfinite(d):
            skipped.append(f"non-finite depth: {raw!r}")
            continue
        keep_d.append(d)
        keep_vsh.append(_safe_float(raw.get("Vsh"), np.nan, lo=0.0, hi=1.0))
        keep_phi.append(_safe_float(raw.get("phi_eff"), np.nan, lo=0.0, hi=0.5))
        keep_sw.append(_safe_float(raw.get("Sw"), np.nan, lo=0.0, hi=1.0))
        lith_in = raw.get("lith")
        if isinstance(lith_in, str):
            keep_lith.append(_LITH_CODE_FROM_LABEL.get(lith_in.strip().lower(), 3))
        elif isinstance(lith_in, (int, float)) and np.isfinite(lith_in):
            keep_lith.append(int(np.clip(int(lith_in), 0, 3)))
        else:
            keep_lith.append(3)

    if not keep_d:
        return {"anchors_used": 0, "skipped": skipped}

    ad = np.asarray(keep_d, dtype=np.float64)
    Vsh_anchor = _interpolate_anchors(depth, ad, np.asarray(keep_vsh, dtype=np.float64))
    phi_anchor = _interpolate_anchors(depth, ad, np.asarray(keep_phi, dtype=np.float64))
    Sw_anchor = _interpolate_anchors(depth, ad, np.asarray(keep_sw, dtype=np.float64))

    # Where the LLM didn't supply a value, fall back to the deterministic curves.
    Vsh_new = np.where(np.isfinite(Vsh_anchor), Vsh_anchor, result.Vsh)
    phi_new = np.where(np.isfinite(phi_anchor), phi_anchor, result.phi_eff)
    Sw_new = np.where(np.isfinite(Sw_anchor), Sw_anchor, result.Sw)
    Vsh_new = np.clip(Vsh_new, 0.0, 1.0)
    phi_new = np.clip(phi_new, 0.0, 0.5)
    Sw_new = np.where(np.isfinite(Sw_new), np.clip(Sw_new, 0.0, 1.0), np.nan)

    # Lithology nearest-neighbor lookup (interp doesn't apply to discrete codes)
    if keep_lith:
        ad_sorted_idx = np.argsort(ad)
        ad_sorted = ad[ad_sorted_idx]
        lith_sorted = np.asarray(keep_lith, dtype=np.int8)[ad_sorted_idx]
        # Index of the nearest anchor for each depth sample
        idx = np.searchsorted(ad_sorted, depth)
        idx = np.clip(idx, 0, len(ad_sorted) - 1)
        idx_left = np.clip(idx - 1, 0, len(ad_sorted) - 1)
        # Choose closer of left/right neighbor
        d_right = np.abs(ad_sorted[idx] - depth)
        d_left = np.abs(ad_sorted[idx_left] - depth)
        nearest = np.where(d_left <= d_right, idx_left, idx)
        lith_flag_new = lith_sorted[nearest].astype(np.int8)
    else:
        lith_flag_new = result.lith_flag

    Shc_new = np.where(np.isfinite(Sw_new), 1.0 - Sw_new, np.nan)
    BVW_new = np.where(
        np.isfinite(phi_new) & np.isfinite(Sw_new), phi_new * Sw_new, np.nan
    )

    # Mutate the result so downstream code (zone detection, payload builder)
    # sees the LLM-derived curves.
    result.Vsh = Vsh_new
    result.phi_eff = phi_new
    result.Sw = Sw_new
    result.Shc = Shc_new
    result.BVW = BVW_new
    result.lith_flag = lith_flag_new
    result.mean_phi_eff = _nanmean_safe(phi_new)
    result.mean_Sw = _nanmean_safe(Sw_new)

    # ----- Re-run zone detection on the new curves
    p = result.params_used
    sw_prod = Sw_producible if Sw_producible is not None else p.Sw_producible
    phi_sw = np.where(
        np.isfinite(phi_new) & (phi_new >= 0.02), phi_new, np.nan
    )
    Rwa_new = _compute_rwa(
        result.RT,
        phi_sw,
        np.full(n, p.a, dtype=np.float64),
        np.full(n, p.m, dtype=np.float64),
    )
    RT_rxo = _flushed_resistivity(result.RT_shallow, result.RT_micro)
    if RT_rxo.size != n:
        RT_rxo = np.full(n, np.nan, dtype=np.float64)
    Rw_arr_new = np.full(n, p.Rw, dtype=np.float64)
    valid_mask = (
        np.isfinite(result.GR) & np.isfinite(phi_new) & np.isfinite(Sw_new)
    )
    both = np.isfinite(result.DPHI) & np.isfinite(result.NPHI)
    gas_crossover = np.zeros(n, dtype=bool)
    gas_crossover[both] = (result.DPHI[both] - result.NPHI[both]) > 0.03
    oil_mask, gas_mask = _build_pay_masks(
        valid_mask=valid_mask,
        Vsh=Vsh_new,
        phi_eff=phi_new,
        Shc=Shc_new,
        RT=result.RT,
        RT_rxo=RT_rxo,
        Rwa=Rwa_new,
        Rw_arr=Rw_arr_new,
        params=p,
        permeable_sp=result.permeable_sp,
        gas_crossover=gas_crossover,
    )

    depth_step = _estimate_step(depth)
    gap_samples = max(1, int(round(1.5 / max(depth_step, 0.05))))
    oil_zones = _find_intervals(
        _close_small_gaps(oil_mask, gap_samples),
        depth, depth_step, "OIL",
        Sw=Sw_new, Shc=Shc_new, phi_eff=phi_new,
        RT=result.RT, GR=result.GR, Vsh=Vsh_new,
        PEF=result.PEF, BVW=BVW_new, lith_flag=lith_flag_new,
        Sw_producible=sw_prod,
    )
    gas_zones = _find_intervals(
        _close_small_gaps(gas_mask, gap_samples),
        depth, depth_step, "GAS",
        Sw=Sw_new, Shc=Shc_new, phi_eff=phi_new,
        RT=result.RT, GR=result.GR, Vsh=Vsh_new,
        PEF=result.PEF, BVW=BVW_new, lith_flag=lith_flag_new,
        Sw_producible=sw_prod,
    )
    result.zones = sorted(oil_zones + gas_zones, key=lambda z: z["top_ft"])
    result.hc_type = hc_type_from_zones(depth, result.zones)

    return {
        "anchors_used": len(keep_d),
        "depth_range_ft": [float(np.min(ad)), float(np.max(ad))],
        "skipped": skipped[:20],
    }


def _safe_float(v, default: float, *, lo: float, hi: float) -> float:
    try:
        if v is None:
            return default
        f = float(v)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(f):
        return default
    return float(np.clip(f, lo, hi))


def hc_type_from_zones(depth: np.ndarray, zones: list[dict]) -> np.ndarray:
    """Build the per-depth ``hc_type`` int8 array (0=water, 1=oil, 2=gas)
    from a list of zone dicts. Used when zones are sourced from a non-
    deterministic picker (e.g. the LLM) and we still need the per-depth
    overlay flag for the LogViewer."""
    out = np.zeros(depth.size, dtype=np.int8)
    for z in zones:
        try:
            top = float(z["top_ft"])
            bot = float(z["bot_ft"])
            ztype = str(z.get("type", "")).upper()
        except (KeyError, TypeError, ValueError):
            continue
        code = 1 if ztype == "OIL" else 2 if ztype == "GAS" else 0
        if code == 0:
            continue
        m = (depth >= top) & (depth < bot)
        out[m] = code
    return out


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
