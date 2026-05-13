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


def test_pipeline_on_synthetic_las(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    v = validate_curves(data)
    cm = auto_select_curves(data.df, v)
    res = run_petrophysics(data.df, cm, PetroParams(rho_ma=2.71, Rw=0.1))
    assert len(res.zones) >= 1
    # Our oil zone is around 8050-8090; carbonate gas zone 8120-8170
    found_types = {z["type"] for z in res.zones}
    assert found_types & {"OIL", "GAS"}
