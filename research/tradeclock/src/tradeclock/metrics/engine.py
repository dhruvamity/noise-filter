"""Quantitative momentum vs chop metrics, point-in-time ATR, and block-bootstrap CI engine."""
from __future__ import annotations

import logging
import math
import numpy as np
import pandas as pd

LOGGER = logging.getLogger("tradeclock.metrics.engine")


def compute_point_in_time_atr(
    df_5m: pd.DataFrame,
    atr_period: int = 14,
) -> pd.Series:
    """Compute rolling ATR(14) on 15m intervals without look-ahead, mapped back to 5m bars.
    
    True Range = max(H - L, |H - C_prev|, |L - C_prev|)
    """
    # Build 15m bars from 5m data
    df = df_5m[["open_time", "open", "high", "low", "close"]].copy()
    # Floor timestamp to 15m
    df["bucket_15m"] = df["open_time"] - (df["open_time"] % (15 * 60_000))

    agg_15m = df.groupby("bucket_15m", sort=True).agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
    }).reset_index()

    h = agg_15m["high"].values
    l = agg_15m["low"].values
    c = agg_15m["close"].values

    tr = np.zeros(len(agg_15m), dtype=np.float64)
    tr[0] = h[0] - l[0]
    for i in range(1, len(agg_15m)):
        hl = h[i] - l[i]
        hc = abs(h[i] - c[i - 1])
        lc = abs(l[i] - c[i - 1])
        tr[i] = max(hl, hc, lc)

    # Wilder's smoothing for ATR, strictly lagged by 1 bar to guarantee zero look-ahead
    atr = np.zeros(len(agg_15m), dtype=np.float64)
    if len(agg_15m) > atr_period:
        atr[atr_period - 1] = np.mean(tr[:atr_period])
        for i in range(atr_period, len(agg_15m)):
            atr[i] = (atr[i - 1] * (atr_period - 1) + tr[i]) / atr_period

    # Shift by 1 so bar t only sees ATR up to bar t-1
    agg_15m["atr_point_in_time"] = pd.Series(atr).shift(1).bfill().values

    # Merge back to 5m bars
    merged = pd.merge(df[["open_time", "bucket_15m"]], agg_15m[["bucket_15m", "atr_point_in_time"]], on="bucket_15m", how="left")
    return merged["atr_point_in_time"].ffill().bfill()


def compute_corwin_schultz_spread(high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """Corwin-Schultz (2012) bid-ask spread estimator using 2-bar High/Low ratios."""
    n = len(high)
    spread = np.zeros(n, dtype=np.float64)
    if n < 2:
        return spread

    h1 = high[:-1]
    l1 = low[:-1]
    h2 = high[1:]
    l2 = low[1:]

    h2_max = np.maximum(h1, h2)
    l2_min = np.minimum(l1, l2)

    # Beta
    gamma = (np.log(np.maximum(1e-6, h2_max / np.maximum(1e-6, l2_min)))) ** 2
    beta = (np.log(np.maximum(1e-6, h1 / np.maximum(1e-6, l1)))) ** 2 + (np.log(np.maximum(1e-6, h2 / np.maximum(1e-6, l2)))) ** 2

    # Alpha
    denom = 3.0 - 2.0 * math.sqrt(2.0)
    sqrt_2 = math.sqrt(2.0)
    alpha = (np.sqrt(2.0 * beta) - np.sqrt(beta)) / denom - np.sqrt(gamma / denom)
    alpha = np.maximum(0.0, alpha)

    # Spread
    s = 2.0 * (np.exp(alpha) - 1.0) / (1.0 + np.exp(alpha))
    spread[1:] = np.maximum(0.0, s)
    spread[0] = spread[1] if n > 1 else 0.0
    return spread * 10_000.0 # Return in basis points


def compute_bar_level_features(df_5m: pd.DataFrame, cost_bps_rt: float = 10.0) -> pd.DataFrame:
    """Compute rolling 60m features on 5m bars before bin aggregation."""
    df = df_5m.copy()
    n = len(df)
    close = df["close"].values
    high = df["high"].values
    low = df["low"].values
    open_p = df["open"].values
    vol = df["volume"].values

    # 1. Point-in-time ATR
    df["atr_15m"] = compute_point_in_time_atr(df, atr_period=14)
    atr = df["atr_15m"].values

    # 2. Rolling 60m Efficiency Ratio (12 bars on 5m)
    window = 12
    net_move = np.abs(close - np.roll(close, window))
    abs_step = np.abs(close - np.roll(close, 1))
    abs_step[0] = 0.0

    path_length = pd.Series(abs_step).rolling(window=window, min_periods=window).sum().values
    er = np.zeros(n, dtype=np.float64)
    valid_er = (path_length > 1e-8)
    er[valid_er] = net_move[valid_er] / path_length[valid_er]
    er[:window] = np.nan
    df["er_60m"] = er

    # 3. Rolling 60m Range (bps and ATR multiple)
    roll_max_60m = pd.Series(high).rolling(window=window, min_periods=window).max().values
    roll_min_60m = pd.Series(low).rolling(window=window, min_periods=window).min().values
    range_pts = roll_max_60m - roll_min_60m
    range_bps = (range_pts / np.maximum(1e-6, open_p)) * 10_000.0
    df["range_bps_60m"] = range_bps
    df["range_cost_ratio"] = range_bps / max(1.0, cost_bps_rt)
    df["range_atr_multiple"] = range_pts / np.maximum(1e-6, atr)

    # 4. Wick-to-Body ratio
    body = np.abs(close - open_p)
    upper_wick = high - np.maximum(open_p, close)
    lower_wick = np.minimum(open_p, close) - low
    total_wick = upper_wick + lower_wick
    df["wick_body_ratio"] = total_wick / np.maximum(1e-6, body)

    # 5. False Breakout Rate & Follow-Through
    # Prior 60m high/low (lagged by 1 bar to prevent lookahead)
    prior_high_60m = pd.Series(high).shift(1).rolling(window=window, min_periods=window).max().values
    prior_low_60m = pd.Series(low).shift(1).rolling(window=window, min_periods=window).min().values

    break_up = high > prior_high_60m
    break_down = low < prior_low_60m
    is_breakout = break_up | break_down
    df["is_breakout"] = is_breakout

    # Check if breakout reversed within 6 bars (30 min)
    reversal_window = 6
    false_break = np.zeros(n, dtype=np.float64)
    follow_through_success = np.zeros(n, dtype=np.float64)
    follow_through_valid = np.zeros(n, dtype=bool)
    continuation_2h = np.zeros(n, dtype=np.float64)

    horizon_3h = 36 # 36 * 5m = 3 hours
    horizon_2h = 24 # 24 * 5m = 2 hours

    for i in range(window, n - max(horizon_3h, reversal_window)):
        if break_up[i]:
            # False breakout check: does close fall back below prior_high within 6 bars?
            reversed_back = np.any(close[i + 1 : i + 1 + reversal_window] < prior_high_60m[i])
            false_break[i] = 1.0 if reversed_back else 0.0

            # Follow-through check (+1 ATR before -1 ATR in 3h)
            target = close[i] + atr[i]
            stop = close[i] - atr[i]
            future_highs = high[i + 1 : i + 1 + horizon_3h]
            future_lows = low[i + 1 : i + 1 + horizon_3h]

            hit_target = np.where(future_highs >= target)[0]
            hit_stop = np.where(future_lows <= stop)[0]

            first_target = hit_target[0] if len(hit_target) > 0 else 9999
            first_stop = hit_stop[0] if len(hit_stop) > 0 else 9999

            if first_target < first_stop:
                follow_through_success[i] = 1.0
                follow_through_valid[i] = True
            elif first_stop < first_target:
                follow_through_success[i] = 0.0
                follow_through_valid[i] = True

            continuation_2h[i] = (close[min(n - 1, i + horizon_2h)] - close[i]) / max(1e-6, atr[i])

        elif break_down[i]:
            # False breakout check: does close rise back above prior_low within 6 bars?
            reversed_back = np.any(close[i + 1 : i + 1 + reversal_window] > prior_low_60m[i])
            false_break[i] = 1.0 if reversed_back else 0.0

            # Follow-through check (-1 ATR before +1 ATR in 3h)
            target = close[i] - atr[i]
            stop = close[i] + atr[i]
            future_highs = high[i + 1 : i + 1 + horizon_3h]
            future_lows = low[i + 1 : i + 1 + horizon_3h]

            hit_target = np.where(future_lows <= target)[0]
            hit_stop = np.where(future_highs >= stop)[0]

            first_target = hit_target[0] if len(hit_target) > 0 else 9999
            first_stop = hit_stop[0] if len(hit_stop) > 0 else 9999

            if first_target < first_stop:
                follow_through_success[i] = 1.0
                follow_through_valid[i] = True
            elif first_stop < first_target:
                follow_through_success[i] = 0.0
                follow_through_valid[i] = True

            continuation_2h[i] = (close[i] - close[min(n - 1, i + horizon_2h)]) / max(1e-6, atr[i])

    df["false_breakout"] = false_break
    df["follow_through_success"] = follow_through_success
    df["follow_through_valid"] = follow_through_valid
    df["continuation_2h"] = continuation_2h

    # 6. Corwin-Schultz Spread
    df["cs_spread_bps"] = compute_corwin_schultz_spread(high, low)

    # 7. Directional drift in bps
    df["drift_bps"] = ((close - open_p) / np.maximum(1e-6, open_p)) * 10_000.0

    return df


def compute_variance_ratio(df_5m: pd.DataFrame) -> float:
    """Compute 15m vs 5m variance ratio: Var(r_15m) / (3 * Var(r_5m))."""
    if len(df_5m) < 6:
        return 1.0
    c = df_5m["close"].values
    r_5m = np.diff(np.log(np.maximum(1e-6, c)))
    if len(r_5m) < 3:
        return 1.0
    var_5m = np.var(r_5m)
    if var_5m < 1e-12:
        return 1.0

    # 15m returns (step 3)
    r_15m = np.log(c[3:] / c[:-3])
    var_15m = np.var(r_15m)
    vr = var_15m / (3.0 * var_5m)
    return float(vr)


def block_bootstrap_ci(
    values: np.ndarray,
    dates: np.ndarray,
    weights: np.ndarray,
    stat_fn,
    n_iterations: int = 1000,
    block_length_days: int = 5,
    ci_level: float = 0.90,
    seed: int = 42,
) -> tuple[float, float]:
    """Stationary 5-day block bootstrap over calendar days to compute 90% CI."""
    unique_dates = np.unique(dates)
    n_dates = len(unique_dates)
    if n_dates < 3 or len(values) < 5:
        return float("nan"), float("nan")

    rng = np.random.default_rng(seed)
    boot_stats = np.zeros(n_iterations, dtype=np.float64)

    # Pre-index values and weights by date
    date_to_idx = {d: np.where(dates == d)[0] for d in unique_dates}

    for b in range(n_iterations):
        # Sample blocks of days with replacement
        sample_indices = []
        cur_days = 0
        while cur_days < n_dates:
            start_d_idx = rng.integers(0, n_dates)
            block = unique_dates[start_d_idx : min(n_dates, start_d_idx + block_length_days)]
            for d in block:
                sample_indices.extend(date_to_idx[d])
            cur_days += len(block)

        idx_arr = np.array(sample_indices[: len(values)])
        boot_stats[b] = stat_fn(values[idx_arr], weights[idx_arr])

    alpha = (1.0 - ci_level) / 2.0
    lower = float(np.nanpercentile(boot_stats, alpha * 100.0))
    upper = float(np.nanpercentile(boot_stats, (1.0 - alpha) * 100.0))
    return lower, upper
