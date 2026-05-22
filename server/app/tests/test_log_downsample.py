"""Overview downsampling helpers — RT peak preservation."""

import numpy as np

from app.routers.wells import (
    _downsample_indices,
    _downsample_indices_preserve_peaks,
    _overview_indices,
)


def test_preserve_peaks_keeps_spike_in_bucket():
    n = 1000
    rt = np.full(n, 10.0)
    # Single spike in the middle bucket when max_points=10
    rt[505] = 80.0
    idx = _downsample_indices_preserve_peaks(rt, n, max_points=10)
    assert 505 in idx
    assert float(rt[idx].max()) >= 80.0


def test_overview_indices_union_includes_spike_and_base_coverage():
    n = 2000
    rt = np.full(n, 10.0)
    rt[1500] = 120.0
    merged = _overview_indices(n, rt, max_points=50)
    assert 1500 in merged
    assert merged.size >= 50
    assert merged.size <= 100  # base 50 + peak 50, unique


def test_uniform_downsample_can_drop_spike():
    n = 1000
    rt = np.full(n, 10.0)
    rt[505] = 80.0
    idx = _downsample_indices(n, max_points=10)
    # linspace may skip index 505 — peak helper exists because of this
    if 505 not in idx:
        peaks = _downsample_indices_preserve_peaks(rt, n, max_points=10)
        assert 505 in peaks
