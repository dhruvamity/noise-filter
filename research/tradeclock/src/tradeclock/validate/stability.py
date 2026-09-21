"""Stability audits across half-lives, bin offsets, market regimes, and dual-gold cross-validation."""
from __future__ import annotations

import logging
from pathlib import Path
from scipy.stats import spearmanr

import numpy as np
import pandas as pd

from tradeclock.classify.classifier import build_schedule_for_instrument
from tradeclock.timemodel.bins import tag_ist_structure
from tradeclock.timemodel.recency import compute_recency_weights

LOGGER = logging.getLogger("tradeclock.validate.stability")


def run_half_life_sensitivity(
    df_clean_5m: pd.DataFrame,
    cost_bps_rt: float,
    half_lives: list[float | None] = [13.0, 26.0, 52.0, None],
) -> dict:
    """Evaluate stability of slot scores across different exponential decay half-lives."""
    results = {}
    base_scores = None

    for hl in half_lives:
        label = f"hl_{int(hl)}w" if hl is not None else "unweighted"
        sched = build_schedule_for_instrument("TEMP", df_clean_5m, cost_bps_rt=cost_bps_rt, half_life_weeks=hl or 9999.0)
        pooled_bins = sched.get("regimes", {}).get("POOLED", {}).get("bins", {})

        scores = []
        for wd in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
            for b in pooled_bins.get(wd, []):
                scores.append(b["score"])

        scores_arr = np.array(scores)
        results[label] = {
            "mean_score": round(float(np.mean(scores_arr)), 1),
            "std_score": round(float(np.std(scores_arr)), 1),
        }

        if label == "hl_26w":
            base_scores = scores_arr
        elif base_scores is not None and len(base_scores) == len(scores_arr):
            corr, _ = spearmanr(base_scores, scores_arr)
            results[label]["rank_corr_vs_26w"] = round(float(corr), 3)

    return results


def run_dual_gold_cross_validation(
    df_mt5_5m: pd.DataFrame,
    df_binance_5m: pd.DataFrame,
) -> dict:
    """Cross-validate MT5 spot gold feed against Binance XAUUSDT perp over the overlap window."""
    # Merge on open_time
    m_mt5 = df_mt5_5m[["open_time", "close", "volume"]].copy()
    m_bin = df_binance_5m[["open_time", "close", "volume"]].copy()

    merged = pd.merge(m_mt5, m_bin, on="open_time", suffixes=("_mt5", "_binance")).sort_values("open_time").reset_index(drop=True)
    if len(merged) < 100:
        return {"status": "INSUFFICIENT_OVERLAP", "overlap_bars": len(merged)}

    c_mt5 = merged["close_mt5"].values
    c_bin = merged["close_binance"].values

    # 5m log returns
    r_mt5 = np.diff(np.log(np.maximum(1e-6, c_mt5)))
    r_bin = np.diff(np.log(np.maximum(1e-6, c_bin)))

    # Exclude near-zero flat bars
    active = (np.abs(r_mt5) > 1e-7) & (np.abs(r_bin) > 1e-7)
    if np.sum(active) > 50:
        corr = float(np.corrcoef(r_mt5[active], r_bin[active])[0, 1])
    else:
        corr = float(np.corrcoef(r_mt5, r_bin)[0, 1])

    # Basis difference (bps): (Binance - MT5) / MT5 * 10,000
    basis_bps = ((c_bin - c_mt5) / np.maximum(1e-6, c_mt5)) * 10_000.0

    return {
        "status": "PASS",
        "overlap_bars": len(merged),
        "overlap_start_utc": str(pd.to_datetime(merged["open_time"].min(), unit="ms", utc=True)),
        "overlap_end_utc": str(pd.to_datetime(merged["open_time"].max(), unit="ms", utc=True)),
        "return_5m_correlation": round(float(corr), 4),
        "mean_basis_bps": round(float(np.mean(basis_bps)), 2),
        "std_basis_bps": round(float(np.std(basis_bps)), 2),
        "median_basis_bps": round(float(np.median(basis_bps)), 2),
        "basis_95th_bps": round(float(np.percentile(np.abs(basis_bps), 95)), 2),
        "tracking_quality": "HIGH_CONVERGENCE" if corr > 0.90 else "MODERATE_TRACKING",
    }
