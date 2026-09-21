#!/usr/bin/env python3
"""
Scientific Threshold Calibration for XAU/USD (Spot Gold)
=========================================================
Calculates empirical 20-bar return volatility, quantiles, and calibrated
regime thresholds across 5m, 15m, 1h, 4h, 1d, 1w for XAU/USD.
Demonstrates the breakdown of fixed +/-5% stock thresholds on Gold.
"""

from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "xau" / "raw"
DATA_DIR = ROOT / "data" / "xau"

TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d", "1w"]
WINDOW = 20


def calibrate():
    results = {}
    print("==================================================================")
    print("SCIENTIFIC THRESHOLD CALIBRATION — XAU/USD (SPOT GOLD)")
    print("==================================================================")

    for tf in TIMEFRAMES:
        pq = RAW_DIR / tf / "klines.parquet"
        csv = RAW_DIR / tf / "klines.csv"
        if pq.exists():
            df = pd.read_parquet(pq)
        elif csv.exists():
            df = pd.read_csv(csv)
        else:
            continue

        close = df['close'].astype(float)
        ret20 = close.pct_change(WINDOW).dropna()

        std = float(ret20.std())
        mean = float(ret20.mean())
        q10 = float(ret20.quantile(0.10))
        q25 = float(ret20.quantile(0.25))
        q50 = float(ret20.quantile(0.50))
        q75 = float(ret20.quantile(0.75))
        q90 = float(ret20.quantile(0.90))

        # Volatility-scaled threshold: 1.05 * std
        calibrated_thresh = round(float(std * 1.05), 5)

        # Empirical state proportions under calibrated threshold
        pct_bull = float((ret20 >= calibrated_thresh).mean())
        pct_bear = float((ret20 <= -calibrated_thresh).mean())
        pct_chop = float(((ret20 > -calibrated_thresh) & (ret20 < calibrated_thresh)).mean())

        # Failure of fixed stock market 5% threshold on Gold
        pct_bull_fixed5 = float((ret20 >= 0.05).mean())
        pct_bear_fixed5 = float((ret20 <= -0.05).mean())
        pct_chop_fixed5 = float(((ret20 > -0.05) & (ret20 < 0.05)).mean())

        results[tf] = {
            "symbol": "XAUUSD",
            "timeframe": tf,
            "candles": len(df),
            "window": WINDOW,
            "std_dev_pct": round(std * 100, 3),
            "mean_pct": round(mean * 100, 3),
            "q10_pct": round(q10 * 100, 3),
            "q25_pct": round(q25 * 100, 3),
            "q50_pct": round(q50 * 100, 3),
            "q75_pct": round(q75 * 100, 3),
            "q90_pct": round(q90 * 100, 3),
            "calibrated_threshold_pct": round(calibrated_thresh * 100, 3),
            "calibrated_proportions": {
                "bull_pct": round(pct_bull * 100, 1),
                "chop_pct": round(pct_chop * 100, 1),
                "bear_pct": round(pct_bear * 100, 1)
            },
            "fixed_5pct_flaw": {
                "bull_pct": round(pct_bull_fixed5 * 100, 1),
                "chop_pct": round(pct_chop_fixed5 * 100, 1),
                "bear_pct": round(pct_bear_fixed5 * 100, 1),
                "is_degenerated": pct_chop_fixed5 > 0.95
            }
        }

        print(f"\nTimeframe: {tf.upper()} ({len(df):,} candles)")
        print(f"  20-bar Return Std Dev: {std*100:.3f}% | 10th-90th Range: [{q10*100:.3f}%, {q90*100:.3f}%]")
        print(f"  --> Calibrated Threshold: +/-{calibrated_thresh*100:.3f}% (BULL: {pct_bull*100:.1f}%, CHOP: {pct_chop*100:.1f}%, BEAR: {pct_bear*100:.1f}%)")
        if pct_chop_fixed5 > 0.95:
            print(f"  [CRITICAL FINDING] Fixed +/-5% threshold collapses {tf} into {pct_chop_fixed5*100:.1f}% chop (flawed/unusable)")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_file = DATA_DIR / "threshold_calibration.json"
    out_file.write_text(json.dumps(results, indent=2))
    print(f"\nSaved XAU/USD calibration results to {out_file}")


if __name__ == "__main__":
    calibrate()
