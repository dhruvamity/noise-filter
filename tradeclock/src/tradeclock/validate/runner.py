"""Unified validation suite orchestrator."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from tradeclock.validate.walkforward import run_walk_forward_audit
from tradeclock.validate.null_test import run_circular_shift_null_test
from tradeclock.validate.stability import run_half_life_sensitivity, run_dual_gold_cross_validation
from tradeclock.timemodel.bins import tag_ist_structure
from tradeclock.classify.classifier import compute_cell_metrics, compute_trend_quality_scores
from tradeclock.metrics.engine import compute_bar_level_features

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
LOGGER = logging.getLogger("tradeclock.validate.runner")
ROOT = Path(__file__).resolve().parents[3]


def load_config() -> dict:
    with open(ROOT / "config.yaml", "r") as f:
        return yaml.safe_load(f)


def run_all_validations():
    config = load_config()
    clean_dir = ROOT / "data" / "clean"
    report_dir = ROOT / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "instruments": {},
    }

    # Load 5m clean frames
    frames = {}
    for sym_key in config.get("instruments", {}):
        pq = clean_dir / sym_key / "5m" / "klines.parquet"
        if pq.exists():
            frames[sym_key] = pd.read_parquet(pq)

    # 1. Individual instrument validations
    for sym_key, df_5m in frames.items():
        LOGGER.info(f"\n=======================================================")
        LOGGER.info(f"  VALIDATING {sym_key}")
        LOGGER.info(f"=======================================================")
        sym_info = config["instruments"][sym_key]
        cost_bps_rt = sym_info.get("cost_bps_per_side", 5.0) * 2.0

        # Walk-Forward Audit
        LOGGER.info(f"Running walk-forward out-of-sample audit for {sym_key}...")
        wf_res = run_walk_forward_audit(df_5m, cost_bps_rt=cost_bps_rt)
        LOGGER.info(f"  Walk-forward verdict: {wf_res['verdict']} (Avg OOS ER delta: {wf_res['avg_oos_er_delta']})")

        # Null Test
        LOGGER.info(f"Running circular-shift null test for {sym_key}...")
        df_tagged = tag_ist_structure(df_5m, is_gold="XAU" in sym_key)
        df_feat = compute_bar_level_features(df_tagged, cost_bps_rt=cost_bps_rt)

        # Compute daily bin scores
        daily_cells = []
        for (d, b_id), grp in df_feat.groupby(["ist_date", "bin_id"]):
            w = np.ones(len(grp), dtype=np.float64)
            m = compute_cell_metrics(grp, w, cost_bps_rt)
            m["ist_date"] = d
            m["bin_id"] = b_id
            daily_cells.append(m)

        daily_df = pd.DataFrame(daily_cells)
        if not daily_df.empty:
            ranked_daily = compute_trend_quality_scores(daily_cells, config)
            scored_df = pd.DataFrame(ranked_daily)
            null_res = run_circular_shift_null_test(scored_df, n_permutations=500)
        else:
            null_res = {"status": "EMPTY", "p_value": 1.0}
        LOGGER.info(f"  Null test verdict: {null_res.get('status')} (p-value: {null_res.get('p_value')})")

        # Half-life sensitivity
        LOGGER.info(f"Running half-life sensitivity audit for {sym_key}...")
        hl_res = run_half_life_sensitivity(df_5m, cost_bps_rt=cost_bps_rt)

        summary["instruments"][sym_key] = {
            "walk_forward": wf_res,
            "null_test": null_res,
            "half_life_sensitivity": hl_res,
        }

    # 2. Dual-Gold Cross-Validation
    if "XAUUSD_MT5" in frames and "XAUUSDT_BINANCE" in frames:
        LOGGER.info("\n=== Cross-Validating XAUUSD_MT5 vs XAUUSDT_BINANCE ===")
        dual_res = run_dual_gold_cross_validation(frames["XAUUSD_MT5"], frames["XAUUSDT_BINANCE"])
        summary["dual_gold_cross_validation"] = dual_res
        LOGGER.info(f"  Dual Gold 5m Return Correlation: {dual_res.get('return_5m_correlation')}")
        LOGGER.info(f"  Dual Gold Median Basis: {dual_res.get('median_basis_bps')} bps")

    out_file = report_dir / "validation_summary.json"
    with open(out_file, "w") as f:
        json.dump(summary, f, indent=2)
    LOGGER.info(f"\n[SUCCESS] Exported validation summary to {out_file}")


if __name__ == "__main__":
    run_all_validations()
