"""Tests for the deterministic petrophysics engine."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.core.las_parser import auto_select_curves, parse_las, validate_curves
from app.core.petrophysics import PetroParams, run_petrophysics


# ---------------------------------------------------------------------------
# Unit-style tests on small numpy arrays
# ---------------------------------------------------------------------------


def _df(**cols):
    return pd.DataFrame(cols)


def test_dphi_calculation():
    df = _df(DEPT=[100.0, 101.0], RHOZ=[2.71, 2.40], GR=[40, 40], NPHI=[0.10, 0.18], RT=[20, 20])
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT"}
    res = run_petrophysics(df, cm, PetroParams(rho_ma=2.71, rho_fl=1.0))
    # (2.71-2.71)/(2.71-1.0) = 0
    # (2.71-2.40)/(2.71-1.0) ≈ 0.18128
    assert res.DPHI[0] == pytest.approx(0.0, abs=1e-6)
    assert res.DPHI[1] == pytest.approx((2.71 - 2.40) / 1.71, rel=1e-4)


def test_vsh_calculation_clipped_and_in_range():
    GR = np.array([20.0, 60.0, 110.0])  # clean / mid / shale
    df = _df(
        DEPT=[100, 101, 102],
        GR=GR,
        NPHI=[0.10, 0.20, 0.40],
        RHOZ=[2.45, 2.50, 2.55],
        RT=[10.0, 10.0, 10.0],
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT"}
    res = run_petrophysics(df, cm, PetroParams(GR_clean=20.0, GR_shale=110.0))
    assert res.Vsh[0] == pytest.approx(0.0)
    assert 0.0 < res.Vsh[1] < 1.0
    assert res.Vsh[2] == pytest.approx(1.0)
    assert np.all((res.Vsh >= 0.0) & (res.Vsh <= 1.0))


def test_archie_sw():
    # phi=0.20, RT=10, Rw=0.1, a=1, m=2, n=2 → Sw = sqrt((1*0.1)/(0.04*10)) = 0.5
    df = _df(
        DEPT=[100.0],
        GR=[20.0],
        NPHI=[0.20],
        RHOZ=[2.31],  # DPHI ~ 0.234
        RT=[10.0],
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT"}
    p = PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.1, a=1.0, m=2.0, n=2.0,
                    GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)
    # phi_eff = (0.20 + 0.234)/2 ≈ 0.217, Vsh ≈ 0 → no shale correction
    expected_phi = (0.20 + (2.71 - 2.31) / 1.71) / 2.0
    expected_sw = ((1.0 * 0.1) / (expected_phi**2 * 10.0)) ** 0.5
    assert res.phi_eff[0] == pytest.approx(expected_phi, rel=1e-3)
    assert res.Sw[0] == pytest.approx(expected_sw, rel=1e-2)


def test_gas_crossover_flagged():
    # DPHI - NPHI > 0.03 → gas
    NPHI = np.array([0.10, 0.10])
    RHOZ = np.array([2.30, 2.50])  # DPHI ≈ 0.240 and 0.123
    df = _df(DEPT=[100, 101], GR=[20, 20], NPHI=NPHI, RHOZ=RHOZ,
             RT=[100.0, 100.0], PEF=[1.8, 1.8])
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    p = PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.05, GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)
    # Sample 0 should be flagged as gas (hc_type==2), sample 1 should not
    assert int(res.hc_type[0]) == 2
    assert int(res.hc_type[1]) != 2


def test_lith_from_pef():
    PEF = np.array([1.8, 3.1, 5.0, 6.5])
    df = _df(
        DEPT=[100, 101, 102, 103],
        GR=[20, 20, 20, 20],
        NPHI=[0.10, 0.10, 0.10, 0.10],
        RHOZ=[2.40, 2.40, 2.40, 2.40],
        RT=[20, 20, 20, 20],
        PEF=PEF,
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    res = run_petrophysics(df, cm, PetroParams(GR_clean=20.0, GR_shale=110.0))
    assert int(res.lith_flag[0]) == 0  # sandstone
    assert int(res.lith_flag[1]) == 1  # dolomite
    assert int(res.lith_flag[2]) == 2  # limestone
    assert int(res.lith_flag[3]) == 3  # uncertain/heavy


def test_hc_detection_finds_zone():
    # Construct 20ft of pay between depths
    depth = np.arange(8000.0, 8050.0, 0.5)
    n = len(depth)
    GR = np.full(n, 110.0)
    NPHI = np.full(n, 0.35)
    RHOZ = np.full(n, 2.55)
    RT = np.full(n, 2.0)
    # Make 8020–8040 an oil pay (clean GR, low NPHI, low RHOZ, high RT)
    pay = (depth >= 8020.0) & (depth < 8040.0)
    GR[pay] = 20.0
    NPHI[pay] = 0.20
    RHOZ[pay] = 2.40
    RT[pay] = 60.0

    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT, PEF=np.full(n, 2.0))
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    p = PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.1, GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)

    assert len(res.zones) >= 1
    z = res.zones[0]
    assert z["type"] in ("OIL", "GAS")
    assert z["top_ft"] >= 8019.0 and z["top_ft"] <= 8021.0
    assert z["bot_ft"] >= 8039.0 and z["bot_ft"] <= 8041.5
    assert z["thick_ft"] >= 15.0


def test_zone_survives_isolated_nphi_null():
    """A single -999 (→NaN) NPHI sample inside a contiguous oil interval must
    not punch a hole into the HC zone — phi_eff falls back to DPHI and the
    petrophysics is still well-defined at that depth.
    Regression for the "2-ft anomaly" bug reported on real wells.
    """
    depth = np.arange(8000.0, 8050.0, 0.5)
    n = len(depth)
    GR = np.full(n, 110.0)
    NPHI = np.full(n, 0.35)
    RHOZ = np.full(n, 2.55)
    RT = np.full(n, 2.0)
    pay = (depth >= 8020.0) & (depth < 8040.0)
    GR[pay] = 20.0
    NPHI[pay] = 0.20
    RHOZ[pay] = 2.40
    RT[pay] = 60.0

    # Simulate a -999 NPHI null in the middle of the pay (parser would map -999 → NaN)
    null_idx = np.argmin(np.abs(depth - 8030.0))
    NPHI[null_idx] = np.nan
    NPHI[null_idx + 1] = np.nan  # 2-sample (1-ft) gap

    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT, PEF=np.full(n, 2.0))
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    p = PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.1, GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)

    # The pay should be detected as a SINGLE contiguous zone, not split in two.
    assert len(res.zones) == 1, (
        f"Expected one contiguous HC zone, got {len(res.zones)}: {res.zones}"
    )
    z = res.zones[0]
    assert z["top_ft"] <= 8021.0
    assert z["bot_ft"] >= 8039.0


def test_interval_finding_contiguous_mask():
    """Synthetic mask runs are converted to correct top/bot/thickness."""
    # We test indirectly by running the engine with crafted data
    depth = np.arange(0, 10, 1.0, dtype=float)
    GR = np.array([20, 110, 110, 20, 20, 20, 110, 20, 20, 110], dtype=float)
    NPHI = np.full(10, 0.10)
    RHOZ = np.full(10, 2.40)
    RT = np.full(10, 50.0)
    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT, PEF=np.full(10, 1.8))
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    p = PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.05, GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)
    # There should be at least one HC zone; tops/bottoms should be monotonic
    tops = [z["top_ft"] for z in res.zones]
    bots = [z["bot_ft"] for z in res.zones]
    assert all(b > t for t, b in zip(tops, bots))


# ---------------------------------------------------------------------------
# Integration with the synthetic LAS fixture
# ---------------------------------------------------------------------------


def test_auto_estimates_rho_ma_in_limestone_section():
    """When rho_ma is left as None the engine should recover a sensible matrix
    density from clean low-Vsh samples (limestone ≈ 2.71 g/cc here)."""
    depth = np.arange(0, 500, 0.5)
    n = len(depth)
    # Synthetic limestone, ~15% neutron porosity, density ≈ 2.71 - 0.15*1.71
    NPHI = np.full(n, 0.15) + np.random.default_rng(0).normal(0, 0.005, n)
    RHOZ = np.full(n, 2.71 - 0.15 * 1.71) + np.random.default_rng(1).normal(0, 0.01, n)
    GR = np.full(n, 25.0)  # very clean
    RT = np.full(n, 5.0)
    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT)
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT"}
    res = run_petrophysics(df, cm, PetroParams(GR_clean=20.0, GR_shale=110.0))
    assert res.rho_ma_auto is True
    assert res.params_used.rho_ma == pytest.approx(2.71, abs=0.05)


def test_auto_estimates_rw_in_wet_zone():
    """In a clean porous water-bearing section, Rw_auto should be close to the
    real Rw used to generate the resistivity."""
    rng = np.random.default_rng(42)
    depth = np.arange(0, 500, 0.5)
    n = len(depth)
    phi_true = 0.20
    Rw_true = 0.05
    # Archie with Sw=1: RT = Rw / phi^m
    RT = np.full(n, Rw_true / phi_true**2) * np.exp(rng.normal(0, 0.05, n))
    NPHI = np.full(n, phi_true) + rng.normal(0, 0.005, n)
    RHOZ = np.full(n, 2.71 - phi_true * 1.71) + rng.normal(0, 0.005, n)
    GR = np.full(n, 25.0)
    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT)
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT"}
    res = run_petrophysics(
        df,
        cm,
        PetroParams(rho_ma=2.71, GR_clean=20.0, GR_shale=110.0),
    )
    assert res.Rw_auto is True
    # Should be within a factor of 2 of the true Rw
    assert 0.5 * Rw_true <= res.params_used.Rw <= 2.0 * Rw_true


def test_sp_shale_baseline_higher_than_sand_line():
    """Shale reference must sit above sand line (high SP = shale, low = sand)."""
    depth = np.arange(8000.0, 8100.0, 0.5)
    n = len(depth)
    GR = np.where(depth < 8050, 110.0, 20.0)  # shale then clean sand
    SP = np.where(GR > 80, -8.0, -95.0)  # shale high, sand low
    df = _df(
        DEPT=depth,
        GR=GR,
        NPHI=np.full(n, 0.25),
        RHOZ=np.full(n, 2.50),
        RT=np.full(n, 10.0),
        SP=SP,
        PEF=np.full(n, 2.0),
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "SP": "SP", "PEF": "PEF"}
    res = run_petrophysics(df, cm, PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=110.0))
    assert res.sp_used is True
    assert res.sp_shale_baseline is not None
    assert res.sp_sand_line is not None
    assert res.sp_shale_baseline > res.sp_sand_line


def test_sp_filter_excludes_impermeable_zone():
    """SP that stays at the shale baseline should disqualify an HC zone even
    when GR/RT/phi alone would have flagged it."""
    rng = np.random.default_rng(7)
    depth = np.arange(8000.0, 8050.0, 0.5)
    n = len(depth)
    GR = np.full(n, 110.0)
    NPHI = np.full(n, 0.35)
    RHOZ = np.full(n, 2.55)
    RT = np.full(n, 2.0)
    # Looks like reservoir on resistivity/porosity/Vsh
    pay = (depth >= 8020.0) & (depth < 8040.0)
    GR[pay] = 20.0
    NPHI[pay] = 0.20
    RHOZ[pay] = 2.40
    RT[pay] = 60.0
    # ...but SP stays flat at the shale baseline (no deflection over the "pay")
    SP_shale = -10.0
    SP_sand = -90.0
    SP = np.where(GR > 80, SP_shale, SP_shale)  # always at baseline
    SP += rng.normal(0, 0.5, n)
    # Add a few clean sand reference samples elsewhere so the sand line is detected
    sand_ref = (depth >= 8000.0) & (depth < 8005.0)
    GR[sand_ref] = 20.0
    NPHI[sand_ref] = 0.20
    RHOZ[sand_ref] = 2.40
    RT[sand_ref] = 60.0
    SP[sand_ref] = SP_sand

    df = _df(DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT, SP=SP, PEF=np.full(n, 2.0))
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "SP": "SP", "PEF": "PEF"}
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=110.0)
    res = run_petrophysics(df, cm, p)

    assert res.sp_used is True
    # Pay interval (8020-8040) was kept impermeable by SP → should not be detected
    pay_zones = [z for z in res.zones if z["top_ft"] >= 8015 and z["bot_ft"] <= 8045]
    assert pay_zones == [], (
        f"SP-impermeable interval should not be flagged as HC: {pay_zones}"
    )


def test_pipeline_on_synthetic_las(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    v = validate_curves(data)
    cm = auto_select_curves(data.df, v)
    res = run_petrophysics(data.df, cm, PetroParams(rho_ma=2.71, Rw=0.1))
    assert len(res.zones) >= 1
    # Our oil zone is around 8050-8090; carbonate gas zone 8120-8170
    found_types = {z["type"] for z in res.zones}
    assert found_types & {"OIL", "GAS"}


def test_rst_style_processed_sw_without_rt():
    """Sigma / RST exports may have TPHI + SW but no resistivity — still run HC detection."""
    depth = np.arange(5000.0, 5020.0, 0.5)
    n = len(depth)
    GR = np.full(n, 35.0)
    pay = (depth >= 5010.0) & (depth < 5018.0)
    GR[pay] = 30.0
    TPHI = np.full(n, 0.12)
    TPHI[pay] = 0.22
    SW = np.full(n, 0.85)
    SW[pay] = 0.25

    df = pd.DataFrame(
        {"DEPT": depth, "GR": GR, "TPHI": TPHI, "SW": SW},
    )
    cm = {"GR": "GR", "PHI_INPUT": "TPHI", "SW_INPUT": "SW"}
    res = run_petrophysics(
        df,
        cm,
        PetroParams(GR_clean=15.0, GR_shale=120.0, Rw=0.1),
    )
    assert res.used_sw_input is True
    assert res.used_phi_input is True
    assert len(res.zones) >= 1


def test_auto_rw_prefers_rwa_curve():
    rng = np.random.default_rng(0)
    depth = np.arange(0, 400, 0.5)
    n = len(depth)
    phi = np.full(n, 0.22)
    RT = np.full(n, 8.0)
    RWA = np.full(n, 0.08) + rng.normal(0, 0.002, n)
    GR = np.full(n, 25.0)
    df = _df(DEPT=depth, GR=GR, NPHI=phi, RHOZ=np.full(n, 2.35), RT=RT, RWA=RWA)
    cm = {
        "GR": "GR",
        "NPHI": "NPHI",
        "RHOZ": "RHOZ",
        "RT": "RT",
        "RWA": "RWA",
    }
    res = run_petrophysics(df, cm, PetroParams(rho_ma=2.71, GR_clean=20.0, GR_shale=110.0))
    assert res.Rw_method == "rwa_curve_p10"
    assert res.params_used.Rw == pytest.approx(0.08, rel=0.15)


def test_shaly_neutron_phi_weights_dphi():
    """When NPHI >> DPHI, total porosity should be DPHI-biased."""
    from app.core.petrophysics import _phi_from_neutron_density

    nphi = np.array([0.35])
    dphi = np.array([0.20])
    phi = _phi_from_neutron_density(nphi, dphi)
    avg = (0.35 + 0.20) / 2
    weighted = (2 * 0.20 + 0.35) / 3
    assert phi[0] == pytest.approx(weighted, rel=1e-6)
    assert phi[0] < avg


def test_vendor_dphz_used_when_present():
    depth = np.array([100.0, 101.0])
    df = _df(
        DEPT=depth,
        GR=[40, 40],
        NPHI=[0.20, 0.20],
        RHOZ=[2.71, 2.40],
        RT=[10, 10],
        DPHZ=[0.05, 0.30],
    )
    cm = {
        "GR": "GR",
        "NPHI": "NPHI",
        "RHOZ": "RHOZ",
        "RT": "RT",
        "DPHI_INPUT": "DPHZ",
    }
    res = run_petrophysics(df, cm, PetroParams(rho_ma=2.71, rho_fl=1.0, Rw=0.1))
    assert res.DPHI[0] == pytest.approx(0.05, abs=1e-6)
    assert res.DPHI[1] == pytest.approx(0.30, abs=1e-6)


def test_rw_from_sp_ssp():
    from app.core.petrophysics import _rw_from_sp_deflection, _rmf_at_bht

    raw = {"RMFS": "1.217", "MFST": "74.9", "BHT": "220.0"}
    rmf = _rmf_at_bht(raw)
    assert rmf is not None
    # SSP ~ 94 mV, K ~ 72 at 220 F → Rw in few hundredths ohm·m
    rw = _rw_from_sp_deflection(rmf, 94.0, 72.0)
    assert 0.005 < rw < 0.08


def test_low_rt_invasion_pay():
    """Low deep Rt with high Rxo/Rt and Rwa > Rw should flag pay."""
    n = 120
    depth = np.arange(8000.0, 8060.0, 0.5)
    GR = np.where(depth < 8030, 110.0, 28.0)
    NPHI = np.where(depth < 8030, 0.35, 0.34)
    RHOZ = np.where(depth < 8030, 2.55, 2.05)
    RT = np.where(depth < 8030, 2.0, 0.60)
    RT_sh = np.where(depth < 8030, 2.0, 1.60)
    RT_mi = np.where(depth < 8030, 2.0, 6.20)
    SP = np.where(depth < 8030, -8.0, -150.0)
    df = _df(
        DEPT=depth, GR=GR, NPHI=NPHI, RHOZ=RHOZ, RT=RT,
        AT10=RT_sh, RXO8=RT_mi, SP=SP, PEF=np.full(n, 1.8),
    )
    cm = {
        "GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT",
        "RT_SHALLOW": "AT10", "RT_MICRO": "RXO8", "SP": "SP", "PEF": "PEF",
    }
    raw = {"RMFS": "1.217", "MFST": "74.9", "BHT": "220.0"}
    res = run_petrophysics(
        df, cm, PetroParams(rho_ma=2.71, GR_clean=20.0, GR_shale=110.0),
        las_raw_params=raw,
    )
    assert res.sp_used is True
    assert res.Rw_method == "sp_ssp"
    assert len(res.zones) >= 1
    pay = res.zones[0]
    assert pay["type"] in ("OIL", "GAS")
    assert pay["top_ft"] >= 8030.0
    assert pay["producible_pct"] > 0.0
    assert pay["sw_pct"] < 50.0
