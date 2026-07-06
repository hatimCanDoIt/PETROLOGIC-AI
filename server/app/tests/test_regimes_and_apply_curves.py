"""Regime-driven petrophysics + apply_llm_curves tests.

We synthesise a small two-section well: a clean Tertiary-style sand
top half (high GR contrast, low Vsh) and a shaly bottom half. Then we
check that:

  * Without regimes, Vsh is computed with the global linear model and
    matches the existing engine output exactly.
  * With a Tertiary-Larionov regime over the bottom half, Vsh in that
    section is strictly lower than the linear-model output (because
    Larionov is the whole point — softer, more aggressive shale
    correction).
  * Per-regime Archie ``m`` overrides change Sw in the regime window
    only, leaving the other section's Sw untouched.
  * apply_llm_curves replaces the curves AND re-runs zone detection.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.core.petrophysics import (
    PetroParams,
    Regime,
    apply_llm_curves,
    run_petrophysics,
)


def _two_section_df(step: float = 0.5):
    """Top: clean sand 8000-8050; bottom: shalier carbonate 8050-8100."""
    depth = np.arange(8000.0, 8100.0, step)
    n = depth.size
    top = depth < 8050.0
    GR = np.where(top, 25.0, 80.0)
    NPHI = np.where(top, 0.18, 0.22)
    RHOZ = np.where(top, 2.40, 2.55)
    RT = np.where(top, 40.0, 8.0)
    PEF = np.where(top, 1.9, 4.5)
    df = pd.DataFrame(
        {"DEPT": depth, "GR": GR, "NPHI": NPHI, "RHOZ": RHOZ, "RT": RT, "PEF": PEF}
    )
    cm = {"GR": "GR", "NPHI": "NPHI", "RHOZ": "RHOZ", "RT": "RT", "PEF": "PEF"}
    return df, cm


def test_no_regimes_matches_legacy_behaviour():
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    a = run_petrophysics(df, cm, p)
    b = run_petrophysics(df, cm, p, regimes=None)
    np.testing.assert_allclose(a.Vsh, b.Vsh, equal_nan=True)
    np.testing.assert_allclose(a.Sw, b.Sw, equal_nan=True)


def test_larionov_regime_gives_lower_vsh_in_window():
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    base = run_petrophysics(df, cm, p)
    rgs = [
        Regime(top_ft=8050.0, bot_ft=8100.0, vsh_model="larionov_tertiary"),
    ]
    out = run_petrophysics(df, cm, p, regimes=rgs)

    bot = out.depth >= 8050.0
    top = out.depth < 8050.0

    # In the regime window Vsh must be strictly lower (Larionov < linear)
    diff_bot = base.Vsh[bot] - out.Vsh[bot]
    assert np.nanmean(diff_bot) > 0.05, diff_bot

    # Outside the window Vsh is untouched
    np.testing.assert_allclose(base.Vsh[top], out.Vsh[top], equal_nan=True)


def test_per_regime_archie_m_changes_sw_only_in_window():
    """A higher cementation exponent ``m`` increases Sw at fixed phi/Rt.

    The bottom section in ``_two_section_df`` clips to Sw=1 because RT is
    too low there (Archie blows past 1 and gets clipped), so the test
    has to put the regime on the *top* section where Sw is well inside
    the (0, 1) range and the override is observable.
    """
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    base = run_petrophysics(df, cm, p)

    rgs = [Regime(top_ft=8000.0, bot_ft=8050.0, m=2.4)]  # tighter cementation in top sand
    out = run_petrophysics(df, cm, p, regimes=rgs)

    top = (out.depth < 8050.0) & np.isfinite(base.Sw) & np.isfinite(out.Sw)
    bot = (out.depth >= 8050.0) & np.isfinite(base.Sw) & np.isfinite(out.Sw)

    assert int(top.sum()) > 0
    # Higher m → higher Sw at the same Rt/phi/Rw (inside the regime).
    assert np.nanmean(out.Sw[top]) > np.nanmean(base.Sw[top]) + 0.01
    # Outside the regime, Sw is untouched.
    np.testing.assert_allclose(base.Sw[bot], out.Sw[bot], equal_nan=True)


def test_sw_models_shaly_sand_and_regime_scoping():
    """Simandoux / Indonesia must lower Sw vs Archie in shaly rock (that is
    their purpose: Archie over-reads Sw when shale conducts), stay in [0, 1],
    and honor per-regime scoping."""
    df, cm = _two_section_df()
    kw = dict(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    arch = run_petrophysics(df, cm, PetroParams(**kw))
    sim = run_petrophysics(df, cm, PetroParams(sw_model="simandoux", **kw))
    ind = run_petrophysics(df, cm, PetroParams(sw_model="indonesia", **kw))

    bot = arch.depth >= 8050.0  # shaly section, Vsh ≈ 0.6
    assert np.nanmean(arch.Sw[bot] - sim.Sw[bot]) > 0.05
    assert np.nanmean(arch.Sw[bot] - ind.Sw[bot]) > 0.05
    for r in (sim, ind):
        ok = np.isfinite(r.Sw)
        assert np.all((r.Sw[ok] >= 0.0) & (r.Sw[ok] <= 1.0))

    # Regime-scoped Simandoux: bottom window changes, top stays pure Archie.
    rgs = [Regime(top_ft=8050.0, bot_ft=8100.0, sw_model="simandoux")]
    out = run_petrophysics(df, cm, PetroParams(**kw), regimes=rgs)
    top = out.depth < 8050.0
    np.testing.assert_allclose(arch.Sw[top], out.Sw[top], equal_nan=True)
    np.testing.assert_allclose(sim.Sw[bot], out.Sw[bot], equal_nan=True)


def test_apply_llm_curves_replaces_and_repicks_zones():
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    result = run_petrophysics(df, cm, p)

    # Provide LLM anchors that paint the whole well as wet shale
    # (Vsh=0.9, phi=0.05, Sw=1.0). After applying these we should have
    # zero zones and a Vsh array hovering around 0.9.
    anchors = [
        {"depth_ft": 8000.0, "Vsh": 0.9, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
        {"depth_ft": 8050.0, "Vsh": 0.9, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
        {"depth_ft": 8099.5, "Vsh": 0.9, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
    ]
    meta = apply_llm_curves(result, anchors)
    assert meta["anchors_used"] == 3
    assert np.allclose(result.Vsh, 0.9, atol=1e-6)
    assert np.allclose(result.phi_eff, 0.05, atol=1e-6)
    assert np.allclose(result.Sw, 1.0, atol=1e-6)
    assert int((result.lith_flag == 3).sum()) == result.depth.size
    assert result.zones == []
    assert int(result.hc_type.sum()) == 0


def test_apply_llm_curves_finds_pay_when_anchors_say_so():
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    result = run_petrophysics(df, cm, p)

    # Anchors carve out a clear pay window 8010-8040 ft (low Vsh, high
    # phi, low Sw) inside an otherwise-wet well.
    anchors = [
        {"depth_ft": 8000.0, "Vsh": 0.8, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
        {"depth_ft": 8010.0, "Vsh": 0.10, "phi_eff": 0.20, "Sw": 0.20, "lith": "sandstone"},
        {"depth_ft": 8040.0, "Vsh": 0.10, "phi_eff": 0.20, "Sw": 0.20, "lith": "sandstone"},
        {"depth_ft": 8050.0, "Vsh": 0.8, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
        {"depth_ft": 8099.5, "Vsh": 0.8, "phi_eff": 0.05, "Sw": 1.0, "lith": "shale"},
    ]
    apply_llm_curves(result, anchors)
    # Note: after apply_llm_curves we still depend on RT exceeding the
    # cutoff; the synthetic top-section RT=40 is above default 10. Should
    # produce one oil zone.
    assert len(result.zones) == 1
    z = result.zones[0]
    assert z["type"] == "OIL"
    assert 8005.0 <= z["top_ft"] <= 8015.0
    assert 8035.0 <= z["bot_ft"] <= 8045.0


def test_apply_llm_curves_with_no_anchors_is_a_noop():
    df, cm = _two_section_df()
    p = PetroParams(rho_ma=2.71, Rw=0.1, GR_clean=20.0, GR_shale=120.0)
    result = run_petrophysics(df, cm, p)
    pre_vsh = result.Vsh.copy()
    pre_zone_count = len(result.zones)
    meta = apply_llm_curves(result, [])
    assert meta["anchors_used"] == 0
    np.testing.assert_allclose(result.Vsh, pre_vsh, equal_nan=True)
    assert len(result.zones) == pre_zone_count
