"""Circular-shift null hypothesis permutation testing for time-of-day structures."""
from __future__ import annotations

import logging
import numpy as np
import pandas as pd

LOGGER = logging.getLogger("tradeclock.validate.null_test")


def run_circular_shift_null_test(
    df_cell_scores: pd.DataFrame,
    n_permutations: int = 1000,
    seed: int = 42,
) -> dict:
    """Perform circular block-shift permutation test on intraday bin scores.
    
    Tests whether the observed peak-to-trough Trend-Quality Score gap across the 48 IST bins
    is statistically significant compared to random chance (controlling for intraday autocorrelation).
    """
    rng = np.random.default_rng(seed)

    # Group scores by bin_id (0..47)
    observed_bin_means = df_cell_scores.groupby("bin_id")["score"].mean().values
    if len(observed_bin_means) < 48:
        return {
            "p_value": 1.0,
            "is_significant": False,
            "observed_gap": 0.0,
            "null_gap_95th": 0.0,
            "status": "INSUFFICIENT_BINS",
        }

    observed_gap = float(np.max(observed_bin_means) - np.min(observed_bin_means))

    # Null distribution: circularly shift each day's 48 bins by random offset [0..47]
    days = df_cell_scores["ist_date"].unique()
    null_gaps = np.zeros(n_permutations, dtype=np.float64)

    # Pivot scores: rows = dates, cols = bin_id
    pivot = df_cell_scores.pivot_table(index="ist_date", columns="bin_id", values="score").fillna(50.0)
    matrix = pivot.values # shape: (N_days, 48)
    n_days = matrix.shape[0]

    for p in range(n_permutations):
        # Random circular shift per day
        shifts = rng.integers(0, 48, size=n_days)
        shifted_matrix = np.zeros_like(matrix)
        for d in range(n_days):
            shifted_matrix[d] = np.roll(matrix[d], shifts[d])

        null_bin_means = np.mean(shifted_matrix, axis=0)
        null_gaps[p] = np.max(null_bin_means) - np.min(null_bin_means)

    p_value = float(np.mean(null_gaps >= observed_gap))
    null_95 = float(np.percentile(null_gaps, 95.0))

    return {
        "p_value": round(p_value, 4),
        "is_significant": bool(p_value < 0.05),
        "observed_gap": round(observed_gap, 2),
        "null_gap_95th": round(null_95, 2),
        "status": "PASS" if p_value < 0.05 else "FAIL_NULL_TEST",
    }
