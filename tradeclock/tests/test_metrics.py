"""Unit tests for quantitative metrics (ER, VR, point-in-time ATR, zero lookahead)."""
import numpy as np
import pandas as pd
import pytest

from tradeclock.metrics.engine import (
    compute_bar_level_features,
    compute_point_in_time_atr,
    compute_variance_ratio,
)


def test_efficiency_ratio_straight_line_vs_oscillating():
    # 1. Straight-line trend series: ER should be exactly 1.0
    n = 60
    straight_prices = np.linspace(100.0, 160.0, n)
    times = [i * 5 * 60_000 for i in range(n)]

    df_straight = pd.DataFrame({
        "open_time": times,
        "open": straight_prices - 0.5,
        "high": straight_prices + 0.5,
        "low": straight_prices - 0.5,
        "close": straight_prices,
        "volume": np.full(n, 100.0),
    })

    feat_straight = compute_bar_level_features(df_straight)
    # Valid ER starts from window 12
    er_straight = feat_straight["er_60m"].dropna().values
    assert len(er_straight) > 0
    assert np.all(er_straight >= 0.999) # Near 1.0

    # 2. Oscillating chop series: ER should be near 0.0
    # Alternating prices: 100, 101, 100, 101...
    osc_prices = np.array([100.0 if i % 2 == 0 else 101.0 for i in range(n)])
    df_osc = pd.DataFrame({
        "open_time": times,
        "open": osc_prices,
        "high": osc_prices + 0.1,
        "low": osc_prices - 0.1,
        "close": osc_prices,
        "volume": np.full(n, 100.0),
    })

    feat_osc = compute_bar_level_features(df_osc)
    er_osc = feat_osc["er_60m"].dropna().values
    # In window of 12 (even), net move = 0.0, path length = 12.0 -> ER = 0.0
    assert len(er_osc) > 0
    assert np.all(er_osc <= 0.10) # Near 0.0


def test_point_in_time_atr_zero_lookahead():
    # Verify that changing future bar does not alter ATR of previous bars
    n = 100
    times = [i * 5 * 60_000 for i in range(n)]
    prices = np.linspace(100.0, 120.0, n)

    df_base = pd.DataFrame({
        "open_time": times,
        "open": prices,
        "high": prices + 1.0,
        "low": prices - 1.0,
        "close": prices,
    })

    atr_base = compute_point_in_time_atr(df_base, atr_period=14)

    # Now create an extreme spike at the last bar (index 99)
    df_spike = df_base.copy()
    df_spike.loc[99, "high"] = 5000.0
    df_spike.loc[99, "close"] = 4900.0

    atr_spike = compute_point_in_time_atr(df_spike, atr_period=14)

    # Bars up to index 98 must be completely identical (strictly zero lookahead!)
    assert np.allclose(atr_base.values[:98], atr_spike.values[:98])


def test_variance_ratio():
    # Random walk: VR should be approximately 1.0
    rng = np.random.default_rng(42)
    n = 1000
    steps = rng.normal(0, 0.002, n)
    prices = 100.0 * np.exp(np.cumsum(steps))

    df_rw = pd.DataFrame({"close": prices})
    vr = compute_variance_ratio(df_rw)
    assert 0.7 < vr < 1.3
