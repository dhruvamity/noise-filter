"""Walk-forward out-of-sample testing and rank correlation analysis."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from scipy.stats import spearmanr

import numpy as np
import pandas as pd

from tradeclock.classify.classifier import compute_cell_metrics, compute_trend_quality_scores
from tradeclock.timemodel.bins import tag_ist_structure
from tradeclock.metrics.engine import compute_bar_level_features

LOGGER = logging.getLogger("tradeclock.validate.walkforward")


def run_walk_forward_audit(
    df_clean_5m: pd.DataFrame,
    cost_bps_rt: float,
    train_months: int = 18,
    test_months: int = 6,
    step_months: int = 6,
) -> dict:
    """Evaluate out-of-sample performance of slot classifications across rolling windows."""
    df_tagged = tag_ist_structure(df_clean_5m)
    df_featured = compute_bar_level_features(df_tagged, cost_bps_rt=cost_bps_rt)

    dts = pd.to_datetime(df_featured["open_time"], unit="ms", utc=True)
    min_date = dts.min()
    max_date = dts.max()

    total_span_days = (max_date - min_date).days
    required_days = (train_months + test_months) * 30

    if total_span_days < required_days:
        # If dataset is shorter (e.g. Binance XAUUSDT ~9 months), adapt windows
        train_months = max(4, total_span_days // 60)
        test_months = max(2, (total_span_days - train_months * 30) // 30)
        LOGGER.info(f"Adapted walkforward window: train={train_months}m, test={test_months}m")

    folds = []
    cur_start = min_date

    while True:
        train_end = cur_start + pd.DateOffset(months=train_months)
        test_end = train_end + pd.DateOffset(months=test_months)
        if test_end > max_date + pd.Timedelta(days=5):
            break

        # Filter slices
        train_mask = (dts >= cur_start) & (dts < train_end)
        test_mask = (dts >= train_end) & (dts <= test_end)

        df_train = df_featured[train_mask]
        df_test = df_featured[test_mask]

        if len(df_train) < 500 or len(df_test) < 200:
            cur_start += pd.DateOffset(months=step_months)
            continue

        # In-sample cell metrics
        train_cells = []
        for b_id in range(48):
            cell_train = df_train[df_train["bin_id"] == b_id]
            w_train = np.ones(len(cell_train), dtype=np.float64)
            m = compute_cell_metrics(cell_train, w_train, cost_bps_rt)
            m["bin_id"] = b_id
            train_cells.append(m)

        # Rank in-sample cells
        dummy_config = {"classification": {"weights": {"efficiency_ratio": 0.3, "variance_ratio": 0.15, "range_cost_ratio": 0.2, "whipsaw_penalty": 0.15, "follow_through_prob": 0.2}, "gates": {"min_range_cost_multiple": 1.5, "min_rel_volume": 0.3, "min_follow_through_prob": 0.4}, "score_thresholds": {"prime": 65.0, "swing_entry": 75.0, "small_trades": 45.0}}}
        ranked_train = compute_trend_quality_scores(train_cells, dummy_config)
        bin_to_label = {c["bin_id"]: c["raw_label"] for c in ranked_train}
        bin_to_train_score = {c["bin_id"]: c["score"] for c in ranked_train}

        # Out-of-sample cell metrics
        test_cells = []
        for b_id in range(48):
            cell_test = df_test[df_test["bin_id"] == b_id]
            w_test = np.ones(len(cell_test), dtype=np.float64)
            m = compute_cell_metrics(cell_test, w_test, cost_bps_rt)
            m["bin_id"] = b_id
            test_cells.append(m)

        ranked_test = compute_trend_quality_scores(test_cells, dummy_config)
        bin_to_test_score = {c["bin_id"]: c["score"] for c in ranked_test}

        # Compare Out-of-Sample metrics for PRIME/SWING vs NO_TRADE
        oos_prime_bins = [b_id for b_id, lbl in bin_to_label.items() if lbl in ("PRIME", "SWING_ENTRY")]
        oos_notrade_bins = [b_id for b_id, lbl in bin_to_label.items() if lbl == "NO_TRADE"]

        oos_prime_er = [c["er_mean"] for c in test_cells if c["bin_id"] in oos_prime_bins]
        oos_notrade_er = [c["er_mean"] for c in test_cells if c["bin_id"] in oos_notrade_bins]

        oos_prime_ft = [c["follow_through_prob"] for c in test_cells if c["bin_id"] in oos_prime_bins]
        oos_notrade_ft = [c["follow_through_prob"] for c in test_cells if c["bin_id"] in oos_notrade_bins]

        # Rank correlation of cell scores
        common_bins = sorted(list(bin_to_train_score.keys()))
        s_train = [bin_to_train_score[b] for b in common_bins]
        s_test = [bin_to_test_score[b] for b in common_bins]
        corr, pval = spearmanr(s_train, s_test)

        folds.append({
            "train_start": str(cur_start.date()),
            "train_end": str(train_end.date()),
            "test_end": str(test_end.date()),
            "train_bars": len(df_train),
            "test_bars": len(df_test),
            "oos_prime_er_mean": round(float(np.mean(oos_prime_er)) if oos_prime_er else 0.0, 4),
            "oos_notrade_er_mean": round(float(np.mean(oos_notrade_er)) if oos_notrade_er else 0.0, 4),
            "oos_er_delta": round(float(np.mean(oos_prime_er) - np.mean(oos_notrade_er)) if oos_prime_er and oos_notrade_er else 0.0, 4),
            "oos_prime_ft_prob": round(float(np.mean(oos_prime_ft)) if oos_prime_ft else 0.0, 3),
            "oos_notrade_ft_prob": round(float(np.mean(oos_notrade_ft)) if oos_notrade_ft else 0.0, 3),
            "rank_correlation": round(float(corr) if not np.isnan(corr) else 0.0, 3),
            "corr_p_value": round(float(pval) if not np.isnan(pval) else 1.0, 4),
        })

        cur_start += pd.DateOffset(months=step_months)

    avg_er_delta = float(np.mean([f["oos_er_delta"] for f in folds])) if folds else 0.0
    avg_rank_corr = float(np.mean([f["rank_correlation"] for f in folds])) if folds else 0.0

    return {
        "n_folds": len(folds),
        "folds": folds,
        "avg_oos_er_delta": round(avg_er_delta, 4),
        "avg_rank_correlation": round(avg_rank_corr, 3),
        "verdict": "ROBUST_OUT_OF_SAMPLE" if avg_er_delta > 0 and avg_rank_corr > 0.15 else "WEAK_OR_NOISY",
    }
