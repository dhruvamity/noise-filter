"""Trend-Quality Score computation, hard gating, conservative slot merging, and schedule export."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from tradeclock.timemodel.bins import BIN_LABELS, format_bin_str, tag_ist_structure
from tradeclock.timemodel.recency import (
    compute_kish_eff_n,
    compute_recency_weights,
    weighted_mean,
    weighted_quantile,
    weighted_std,
)
from tradeclock.metrics.engine import (
    block_bootstrap_ci,
    compute_bar_level_features,
    compute_variance_ratio,
)

LOGGER = logging.getLogger("tradeclock.classify.classifier")
ROOT = Path(__file__).resolve().parents[3]


def load_config() -> dict:
    with open(ROOT / "config.yaml", "r") as f:
        return yaml.safe_load(f)


def compute_cell_metrics(
    df_cell_5m: pd.DataFrame,
    weights: np.ndarray,
    cost_bps_rt: float,
) -> dict:
    """Compute weighted metrics and 90% block-bootstrap CIs for a single grid cell."""
    n_bars = len(df_cell_5m)
    if n_bars < 6:
        return {
            "n_bars": n_bars,
            "eff_n": 0.0,
            "er_mean": 0.0,
            "er_ci": [0.0, 0.0],
            "vr": 1.0,
            "range_bps": 0.0,
            "range_cost_ratio": 0.0,
            "false_breakout_rate": 0.5,
            "follow_through_prob": 0.5,
            "volume_mean": 0.0,
            "rel_volume": 1.0,
            "cs_spread_bps": 0.0,
            "drift_bps": 0.0,
            "market_closed": True,
        }

    eff_n = compute_kish_eff_n(weights)

    # 1. Efficiency Ratio
    er_vals = df_cell_5m["er_60m"].values
    er_mean = weighted_mean(er_vals, weights)
    dates = df_cell_5m["ist_date"].values
    er_ci_low, er_ci_high = block_bootstrap_ci(
        er_vals, dates, weights, weighted_mean, n_iterations=100, block_length_days=5
    )

    # 2. Variance Ratio
    vr = compute_variance_ratio(df_cell_5m)

    # 3. Range in bps and Range / Cost
    range_bps = weighted_mean(df_cell_5m["range_bps_60m"].values, weights)
    range_cost_ratio = range_bps / max(1.0, cost_bps_rt)

    # 4. Whipsaw: false breakout rate & wick/body
    is_bo = df_cell_5m["is_breakout"].values
    if np.sum(is_bo) > 0:
        fb_vals = df_cell_5m.loc[is_bo, "false_breakout"].values
        fb_w = weights[is_bo]
        false_breakout_rate = weighted_mean(fb_vals, fb_w)
    else:
        false_breakout_rate = 0.5

    # 5. Follow-through probability
    is_ft_valid = df_cell_5m["follow_through_valid"].values
    if np.sum(is_ft_valid) > 0:
        ft_vals = df_cell_5m.loc[is_ft_valid, "follow_through_success"].values
        ft_w = weights[is_ft_valid]
        follow_through_prob = weighted_mean(ft_vals, ft_w)
    else:
        follow_through_prob = 0.5

    # 6. Relative volume & spread
    vol_mean = weighted_mean(df_cell_5m["volume"].values, weights)
    cs_spread = weighted_mean(df_cell_5m["cs_spread_bps"].values, weights)

    # 7. Directional drift
    drift = weighted_mean(df_cell_5m["drift_bps"].values, weights)

    # Check if closed
    closed_ratio = np.mean(df_cell_5m["market_status"] == "CLOSED")

    return {
        "n_bars": n_bars,
        "eff_n": round(eff_n, 1),
        "er_mean": round(float(er_mean) if not np.isnan(er_mean) else 0.0, 4),
        "er_ci": [
            round(float(er_ci_low) if not np.isnan(er_ci_low) else 0.0, 4),
            round(float(er_ci_high) if not np.isnan(er_ci_high) else 0.0, 4),
        ],
        "vr": round(float(vr) if not np.isnan(vr) else 1.0, 3),
        "range_bps": round(float(range_bps) if not np.isnan(range_bps) else 0.0, 1),
        "range_cost_ratio": round(float(range_cost_ratio) if not np.isnan(range_cost_ratio) else 0.0, 2),
        "false_breakout_rate": round(float(false_breakout_rate) if not np.isnan(false_breakout_rate) else 0.5, 3),
        "follow_through_prob": round(float(follow_through_prob) if not np.isnan(follow_through_prob) else 0.5, 3),
        "volume_mean": round(float(vol_mean) if not np.isnan(vol_mean) else 0.0, 2),
        "cs_spread_bps": round(float(cs_spread) if not np.isnan(cs_spread) else 0.0, 2),
        "drift_bps": round(float(drift) if not np.isnan(drift) else 0.0, 2),
        "market_closed": bool(closed_ratio > 0.5),
    }


def compute_trend_quality_scores(cells: list[dict], config: dict) -> list[dict]:
    """Compute 0-100 Trend-Quality Score using percentile ranking across cells within instrument."""
    weights = config.get("classification", {}).get("weights", {
        "efficiency_ratio": 0.30,
        "variance_ratio": 0.15,
        "range_cost_ratio": 0.20,
        "whipsaw_penalty": 0.15,
        "follow_through_prob": 0.20,
    })

    gates = config.get("classification", {}).get("gates", {
        "min_range_cost_multiple": 2.0,
        "min_rel_volume": 0.50,
        "min_follow_through_prob": 0.45,
    })

    open_cells = [c for c in cells if not c.get("market_closed", False)]
    if not open_cells:
        return cells

    # Extract arrays for ranking
    er_arr = np.array([c["er_mean"] for c in open_cells])
    vr_arr = np.array([c["vr"] for c in open_cells])
    rc_arr = np.array([c["range_cost_ratio"] for c in open_cells])
    whip_arr = np.array([1.0 - c["false_breakout_rate"] for c in open_cells]) # higher is better
    ft_arr = np.array([c["follow_through_prob"] for c in open_cells])

    from scipy.stats import rankdata

    def to_pct(arr):
        if len(arr) <= 1 or np.all(arr == arr[0]):
            return np.full(len(arr), 50.0)
        return (rankdata(arr, method="average") - 1.0) / (len(arr) - 1.0) * 100.0

    er_pct = to_pct(er_arr)
    vr_pct = to_pct(vr_arr)
    rc_pct = to_pct(rc_arr)
    whip_pct = to_pct(whip_arr)
    ft_pct = to_pct(ft_arr)

    composite_scores = (
        weights["efficiency_ratio"] * er_pct +
        weights["variance_ratio"] * vr_pct +
        weights["range_cost_ratio"] * rc_pct +
        weights["whipsaw_penalty"] * whip_pct +
        weights["follow_through_prob"] * ft_pct
    )

    thresholds = config.get("classification", {}).get("score_thresholds", {
        "prime": 70.0,
        "swing_entry": 78.0,
        "small_trades": 45.0,
    })

    for idx, c in enumerate(open_cells):
        score = float(composite_scores[idx])
        c["score"] = round(score, 1)

        # Apply Hard Gates
        gated = False
        gate_reasons = []
        if c["range_cost_ratio"] < gates["min_range_cost_multiple"]:
            gated = True
            gate_reasons.append(f"Range/Cost {c['range_cost_ratio']} < {gates['min_range_cost_multiple']}")
        if c.get("rel_volume", 1.0) < gates["min_rel_volume"]:
            gated = True
            gate_reasons.append(f"RelVol {c.get('rel_volume', 1.0)} < {gates['min_rel_volume']}")

        c["gated"] = gated
        c["gate_reasons"] = gate_reasons

        # Determine label
        if gated or score < thresholds["small_trades"]:
            c["raw_label"] = "NO_TRADE"
        elif score >= thresholds["swing_entry"] and c["follow_through_prob"] >= 0.52:
            c["raw_label"] = "SWING_ENTRY"
        elif score >= thresholds["prime"]:
            c["raw_label"] = "PRIME"
        else:
            c["raw_label"] = "SMALL_TRADES"

        # Determine Confidence
        ci_span = c["er_ci"][1] - c["er_ci"][0]
        eff_n = c["eff_n"]
        if eff_n >= 150 and ci_span <= 0.08:
            c["confidence"] = "HIGH"
        elif eff_n >= 80 and ci_span <= 0.14:
            c["confidence"] = "MED"
        else:
            c["confidence"] = "LOW"

    # Closed cells
    for c in cells:
        if c.get("market_closed", False):
            c["score"] = 0.0
            c["raw_label"] = "CLOSED"
            c["confidence"] = "HIGH"
            c["gated"] = False

    return cells


def merge_bins_into_slots(day_cells: list[dict], min_slot_minutes: int = 60) -> list[dict]:
    """Merge contiguous same-label bins and enforce minimum slot length (60 min).
    
    Sub-60m slots are absorbed into conservative neighbors (NO_TRADE or SMALL_TRADES).
    """
    if not day_cells:
        return []

    min_bins = max(1, min_slot_minutes // 30)
    cells = [dict(c) for c in sorted(day_cells, key=lambda c: c["bin_id"])]

    # Conservative hierarchy: lower value is more conservative
    conservative_hierarchy = {"CLOSED": 0, "NO_TRADE": 1, "SMALL_TRADES": 2, "PRIME": 3, "SWING_ENTRY": 4}

    changed = True
    while changed:
        changed = False
        runs = []
        cur_label = cells[0]["raw_label"]
        cur_run = [cells[0]]
        for c in cells[1:]:
            if c["raw_label"] == cur_label:
                cur_run.append(c)
            else:
                runs.append(cur_run)
                cur_label = c["raw_label"]
                cur_run = [c]
        runs.append(cur_run)

        # Look for short run
        for idx, run in enumerate(runs):
            if len(run) < min_bins and len(runs) > 1:
                left_label = runs[idx - 1][0]["raw_label"] if idx > 0 else None
                right_label = runs[idx + 1][0]["raw_label"] if idx < len(runs) - 1 else None

                if left_label and right_label:
                    target_label = (
                        left_label
                        if conservative_hierarchy.get(left_label, 1) <= conservative_hierarchy.get(right_label, 1)
                        else right_label
                    )
                elif left_label:
                    target_label = left_label
                else:
                    target_label = right_label

                for item in run:
                    item["raw_label"] = target_label
                changed = True
                break # Re-group from beginning

    # Final grouping
    final_runs = []
    cur_label = cells[0]["raw_label"]
    cur_run = [cells[0]]
    for c in cells[1:]:
        if c["raw_label"] == cur_label:
            cur_run.append(c)
        else:
            final_runs.append(cur_run)
            cur_label = c["raw_label"]
            cur_run = [c]
    final_runs.append(cur_run)

    slots = []
    for b_list in final_runs:
        b_list = sorted(b_list, key=lambda b: b["bin_id"])
        start_bin = b_list[0]
        end_bin = b_list[-1]

        start_time = start_bin["bin_str"].split("-")[0]
        end_time = end_bin["bin_str"].split("-")[1]

        scores = [b["score"] for b in b_list]
        confidences = [b["confidence"] for b in b_list]
        er_means = [b["er_mean"] for b in b_list]
        rc_ratios = [b["range_cost_ratio"] for b in b_list]
        fb_rates = [b["false_breakout_rate"] for b in b_list]
        ft_probs = [b["follow_through_prob"] for b in b_list]

        conf_priority = {"LOW": 1, "MED": 2, "HIGH": 3}
        lowest_conf = min(confidences, key=lambda c: conf_priority.get(c, 1))

        slots.append({
            "start_time": start_time,
            "end_time": end_time,
            "duration_minutes": len(b_list) * 30,
            "label": b_list[0]["raw_label"],
            "score": round(float(np.mean(scores)), 1),
            "confidence": lowest_conf,
            "bin_count": len(b_list),
            "stats": {
                "er_mean": round(float(np.mean(er_means)), 3),
                "range_cost_ratio": round(float(np.mean(rc_ratios)), 1),
                "false_breakout_rate": round(float(np.mean(fb_rates)), 2),
                "follow_through_prob": round(float(np.mean(ft_probs)), 2),
            },
            "bins": [b["bin_str"] for b in b_list],
        })

    return slots


def build_schedule_for_instrument(
    symbol: str,
    df_clean_5m: pd.DataFrame,
    cost_bps_rt: float,
    half_life_weeks: float = 26.0,
) -> dict:
    """Build full weekday x DST regime schedule for an instrument."""
    config = load_config()
    is_gold = "XAU" in symbol

    # Tag time structure and DST
    df_tagged = tag_ist_structure(df_clean_5m, is_gold=is_gold)

    # Compute bar level features
    df_featured = compute_bar_level_features(df_tagged, cost_bps_rt=cost_bps_rt)

    # Overall weekday volume baseline for relative volume calculation
    weekday_vols = df_featured.groupby("analysis_weekday")["volume"].mean().to_dict()

    schedule_data = {
        "symbol": symbol,
        "half_life_weeks": half_life_weeks,
        "regimes": {},
    }

    # Analyze by DST Regime: US_SUMMER, US_WINTER (and overall pooled)
    for regime in ["US_SUMMER", "US_WINTER", "POOLED"]:
        if regime == "POOLED":
            sub_df = df_featured
        else:
            sub_df = df_featured[df_featured["dst_regime"] == regime]

        if len(sub_df) < 500:
            LOGGER.warning(f"{symbol} {regime} has insufficient data ({len(sub_df)} bars); skipping separate regime.")
            continue

        weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Fri-late"]
        regime_cells = []

        for wd in weekdays:
            wd_df = sub_df[sub_df["analysis_weekday"] == wd]
            if wd_df.empty:
                continue

            # Compute recency weights for this weekday
            ref_ms = df_featured["open_time"].max()
            weights = compute_recency_weights(wd_df["open_time"].values, half_life_weeks=half_life_weeks, reference_ms=ref_ms)

            # Max bins for weekday
            max_bin = 8 if wd == "Fri-late" else 48

            for b_id in range(max_bin):
                bin_mask = wd_df["bin_id"].values == b_id
                bin_df = wd_df[bin_mask]
                bin_w = weights[bin_mask]

                metrics = compute_cell_metrics(bin_df, bin_w, cost_bps_rt)
                # Compute relative volume
                base_vol = weekday_vols.get(wd, 1.0)
                metrics["rel_volume"] = round(float(metrics["volume_mean"] / max(1e-6, base_vol)), 2)
                metrics["weekday"] = wd
                metrics["bin_id"] = b_id
                metrics["bin_str"] = format_bin_str(b_id)
                metrics["regime"] = regime
                regime_cells.append(metrics)

        # Compute composite scores
        ranked_cells = compute_trend_quality_scores(regime_cells, config)

        # Merge bins into slots per weekday
        weekday_slots = {}
        weekday_bins_map = {}
        for wd in weekdays:
            wd_cells = [c for c in ranked_cells if c["weekday"] == wd]
            wd_cells.sort(key=lambda c: c["bin_id"])
            weekday_bins_map[wd] = wd_cells
            weekday_slots[wd] = merge_bins_into_slots(wd_cells, min_slot_minutes=60)

        schedule_data["regimes"][regime] = {
            "slots": weekday_slots,
            "bins": weekday_bins_map,
        }

    return schedule_data


def run_full_schedule_generation():
    config = load_config()
    clean_dir = ROOT / "data" / "clean"
    schedule_dir = ROOT / "schedule"
    schedule_dir.mkdir(parents=True, exist_ok=True)

    master_schedule = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "project": config.get("project", {}),
        "instruments": {},
    }

    for sym_key, sym_info in config.get("instruments", {}).items():
        pq_path = clean_dir / sym_key / "5m" / "klines.parquet"
        if not pq_path.exists():
            LOGGER.warning(f"No clean 5m parquet found for {sym_key} at {pq_path}")
            continue

        LOGGER.info(f"Generating schedule for {sym_key}...")
        df_5m = pd.read_parquet(pq_path)
        cost_bps_rt = sym_info.get("cost_bps_per_side", 5.0) * 2.0
        hl = config.get("recency", {}).get("default_half_life_weeks", 26.0)

        sym_sched = build_schedule_for_instrument(sym_key, df_5m, cost_bps_rt=cost_bps_rt, half_life_weeks=hl)
        sym_sched["display_name"] = sym_info.get("display_name", sym_key)
        sym_sched["data_start_utc"] = str(datetime.fromtimestamp(df_5m["open_time"].min() / 1000, tz=timezone.utc))
        sym_sched["data_end_utc"] = str(datetime.fromtimestamp(df_5m["open_time"].max() / 1000, tz=timezone.utc))
        sym_sched["bar_count_5m"] = len(df_5m)

        master_schedule["instruments"][sym_key] = sym_sched

    # Save schedule.json
    out_file = schedule_dir / "schedule.json"
    with open(out_file, "w") as f:
        json.dump(master_schedule, f, indent=2)
    LOGGER.info(f"[SUCCESS] Exported production schedule to {out_file}")

    # Also generate a bundled demo schedule
    demo_file = schedule_dir / "demo_schedule.json"
    with open(demo_file, "w") as f:
        json.dump(master_schedule, f, indent=2)
    LOGGER.info(f"[SUCCESS] Exported demo schedule to {demo_file}")


if __name__ == "__main__":
    run_full_schedule_generation()
