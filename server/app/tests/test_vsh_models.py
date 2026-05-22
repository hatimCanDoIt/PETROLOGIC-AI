"""Vsh-from-IGR model library tests.

We don't pin exact constants (the formulae are well-known textbook
identities and have already been spelled out in petrophysics.py); we
verify the qualitative invariants every Vsh model must satisfy:

  * IGR = 0  → Vsh = 0  (clean rock is clean)
  * IGR = 1  → Vsh = 1  (pure shale is shale)
  * Output is monotonically non-decreasing in IGR
  * Output is clipped to [0, 1]
  * Non-linear models are STRICTLY below linear in (0, 1) — this is the
    whole point of preferring them in soft-rock environments.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.core.petrophysics import VSH_MODELS, _vsh_from_igr


def _grid():
    return np.linspace(0.0, 1.0, 101)


@pytest.mark.parametrize("model", VSH_MODELS)
def test_endpoints(model):
    igr = _grid()
    v = _vsh_from_igr(igr, model)
    assert v.shape == igr.shape
    assert v[0] == pytest.approx(0.0, abs=1e-9)
    # Larionov pre-tertiary asymptotes to ~0.99 at IGR=1 by construction
    # (0.33*(2^2 - 1) = 0.99). All models must reach at least ~0.95.
    assert v[-1] >= 0.95, (model, v[-1])


@pytest.mark.parametrize("model", VSH_MODELS)
def test_monotonic_and_bounded(model):
    v = _vsh_from_igr(_grid(), model)
    assert np.all(v >= 0.0 - 1e-9)
    assert np.all(v <= 1.0 + 1e-9)
    diffs = np.diff(v)
    assert np.all(diffs >= -1e-9), f"{model} not monotonic"


@pytest.mark.parametrize(
    "model", [m for m in VSH_MODELS if m != "linear"]
)
def test_nonlinear_models_below_linear_in_open_interval(model):
    igr = np.linspace(0.05, 0.95, 19)
    v_lin = _vsh_from_igr(igr, "linear")
    v_other = _vsh_from_igr(igr, model)
    # Non-linear soft-rock models give LOWER Vsh than linear at the same IGR
    # except possibly at the very endpoints where they all converge.
    assert np.all(v_other <= v_lin + 1e-9), (model, v_other, v_lin)
    # And at least one interior point should be strictly less by a meaningful
    # amount, so we know we didn't accidentally implement the identity.
    assert np.min(v_lin - v_other) > 0.01


def test_unknown_model_falls_back_to_linear():
    igr = _grid()
    v = _vsh_from_igr(igr, "totally-not-a-real-model")
    np.testing.assert_allclose(v, _vsh_from_igr(igr, "linear"), atol=1e-12)


def test_nan_propagation():
    igr = np.array([0.0, np.nan, 0.5, 1.0])
    for model in VSH_MODELS:
        v = _vsh_from_igr(igr, model)
        assert not np.isfinite(v[1])
        assert np.isfinite(v[0]) and np.isfinite(v[2]) and np.isfinite(v[3])
