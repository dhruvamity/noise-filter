"""Exponential recency weighting, Kish effective sample size, and decay sensitivity."""
from __future__ import annotations

import math
import numpy as np
import pandas as pd

MS_PER_WEEK = 7 * 24 * 3600 * 1000.0


def compute_recency_weights(
    timestamps_ms: np.ndarray | pd.Series,
    half_life_weeks: float | None = 26.0,
    reference_ms: int | None = None,
) -> np.ndarray:
    """Calculate exponential recency weights based on age in weeks.
    
    w_i = exp( -ln(2) * age_weeks / H )
    If half_life_weeks is None, returns uniform weights (1.0).
    """
    ts = np.asarray(timestamps_ms, dtype=np.int64)
    if len(ts) == 0:
        return np.array([], dtype=np.float64)

    if half_life_weeks is None or half_life_weeks <= 0:
        return np.ones(len(ts), dtype=np.float64)

    ref_ms = int(ts.max()) if reference_ms is None else int(reference_ms)
    age_weeks = np.maximum(0.0, (ref_ms - ts) / MS_PER_WEEK)
    decay_rate = math.log(2.0) / half_life_weeks
    weights = np.exp(-decay_rate * age_weeks)
    return weights.astype(np.float64)


def compute_kish_eff_n(weights: np.ndarray) -> float:
    """Compute Kish's Effective Sample Size:
    
    N_eff = (sum(w_i))^2 / sum(w_i^2)
    """
    w = np.asarray(weights, dtype=np.float64)
    if len(w) == 0:
        return 0.0
    sum_w = np.sum(w)
    sum_w_sq = np.sum(w * w)
    if sum_w_sq == 0:
        return 0.0
    return float((sum_w * sum_w) / sum_w_sq)


def weighted_mean(values: np.ndarray, weights: np.ndarray) -> float:
    """Compute weighted mean of values."""
    v = np.asarray(values, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    valid = (~np.isnan(v)) & (~np.isnan(w)) & (w > 0)
    if not np.any(valid):
        return float("nan")
    return float(np.sum(v[valid] * w[valid]) / np.sum(w[valid]))


def weighted_std(values: np.ndarray, weights: np.ndarray) -> float:
    """Compute weighted sample standard deviation."""
    v = np.asarray(values, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    valid = (~np.isnan(v)) & (~np.isnan(w)) & (w > 0)
    if not np.any(valid):
        return float("nan")
    v = v[valid]
    w = w[valid]
    w_sum = np.sum(w)
    if w_sum == 0:
        return float("nan")
    w_mean = np.sum(v * w) / w_sum
    variance = np.sum(w * (v - w_mean) ** 2) / w_sum
    return float(np.sqrt(max(0.0, variance)))


def weighted_quantile(values: np.ndarray, weights: np.ndarray, quantile: float) -> float:
    """Compute weighted percentile/quantile (0.0 to 1.0)."""
    v = np.asarray(values, dtype=np.float64)
    w = np.asarray(weights, dtype=np.float64)
    valid = (~np.isnan(v)) & (~np.isnan(w)) & (w > 0)
    if not np.any(valid):
        return float("nan")
    v = v[valid]
    w = w[valid]

    sort_idx = np.argsort(v)
    v_sorted = v[sort_idx]
    w_sorted = w[sort_idx]

    cum_w = np.cumsum(w_sorted)
    total_w = cum_w[-1]
    if total_w == 0:
        return float("nan")

    target = quantile * total_w
    idx = np.searchsorted(cum_w, target)
    idx = min(len(v_sorted) - 1, idx)
    return float(v_sorted[idx])
