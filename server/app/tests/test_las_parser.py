"""Tests for the LAS parser."""

from __future__ import annotations

import numpy as np
import pytest

from app.core.las_parser import (
    CURVE_ALIASES,
    LASParseError,
    _find_all_mnemonics,
    auto_select_curves,
    find_resistivity_mnemonics,
    parse_las,
    validate_curves,
)


def test_parse_valid_las(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    assert data.meta.well_name == "SYNTHETIC-1"
    assert data.meta.field == "SYNTHETIC FIELD"
    assert data.meta.api_number == "42-123-45678"
    assert pytest.approx(data.meta.depth_start, rel=1e-3) == 8000.0
    assert pytest.approx(data.meta.depth_stop, rel=1e-3) == 8200.0
    assert data.meta.depth_step == pytest.approx(0.5, rel=1e-3)
    cols = set(data.df.columns)
    assert {"DEPT", "GR", "NPHI", "RHOZ", "RT", "PEF"}.issubset(cols)
    assert len(data.df) > 100


def test_null_cleaning(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    # We injected -999.25 at indices 10, 20, 30 in GR + NPHI
    gr = data.df["GR"].to_numpy()
    nphi = data.df["NPHI"].to_numpy()
    for i in (10, 20, 30):
        assert np.isnan(gr[i]), f"GR[{i}] should be NaN, got {gr[i]}"
        assert np.isnan(nphi[i]), f"NPHI[{i}] should be NaN, got {nphi[i]}"


def test_missing_critical_curves():
    bad = b"""~Version
VERS. 2.0 : 
WRAP. NO  :
~Well
STRT.FT 0.0 :
STOP.FT 10.0 :
STEP.FT 1.0 :
NULL.  -999.25 :
WELL.  BAD :
~Curve
DEPT.FT  :
~A
0.0
1.0
2.0
"""
    with pytest.raises(LASParseError):
        # Either fails outright (no data curves) or validation flags it.
        data = parse_las(bad)
        v = validate_curves(data)
        if v["missing_critical"]:
            raise LASParseError("missing critical curves")


def test_curve_validation_detects_aliases(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    v = validate_curves(data)
    assert v["has_gr"] is True
    assert v["has_resistivity"] is True
    assert v["has_neutron"] is True
    assert v["has_density"] is True
    assert v["has_pef"] is True
    assert v["gr_mnemonic"] == "GR"
    assert v["rhoz_mnemonic"] == "RHOZ"
    assert v["nphi_mnemonic"] == "NPHI"
    assert v["rt_mnemonic"] == "RT"
    assert v["missing_critical"] == []


def test_auto_select_curves(synthetic_las_bytes):
    data = parse_las(synthetic_las_bytes)
    v = validate_curves(data)
    mapping = auto_select_curves(data.df, v)
    for std in ("GR", "RT", "NPHI", "RHOZ", "PEF"):
        assert mapping[std] in data.df.columns


def test_empty_file_raises():
    with pytest.raises(LASParseError):
        parse_las(b"")


def test_find_all_resistivity_mnemonics():
    cols = ["DEPT", "GR", "AT90", "AT30", "ILD", "NPHI"]
    found = _find_all_mnemonics(cols, CURVE_ALIASES["RT"])
    assert found == ["AT90", "ILD", "AT30"]


def test_find_resistivity_includes_shallow_and_micro():
    cols = ["DEPT", "AT90", "AT10", "RXO8", "HMIN", "GR"]
    found = find_resistivity_mnemonics(cols)
    assert found == ["AT90", "AT10", "RXO8", "HMIN"]
