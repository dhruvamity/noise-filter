"""Unit tests for slot classification, hard gating, and conservative slot merging."""
import numpy as np
import pytest

from tradeclock.classify.classifier import merge_bins_into_slots, compute_trend_quality_scores
from tradeclock.timemodel.bins import BIN_LABELS


def test_slot_merging_absorbs_sub_60m_spikes():
    # Construct synthetic 6 bins:
    # Bins 0, 1: NO_TRADE
    # Bin 2: PRIME (isolated single bin 30m spike!)
    # Bins 3, 4, 5: NO_TRADE
    bins = [
        {"bin_id": 0, "bin_str": "00:00-00:30", "raw_label": "NO_TRADE", "score": 30.0, "confidence": "HIGH", "er_mean": 0.2, "range_cost_ratio": 3.0, "false_breakout_rate": 0.8, "follow_through_prob": 0.4},
        {"bin_id": 1, "bin_str": "00:30-01:00", "raw_label": "NO_TRADE", "score": 32.0, "confidence": "HIGH", "er_mean": 0.21, "range_cost_ratio": 3.1, "false_breakout_rate": 0.8, "follow_through_prob": 0.4},
        {"bin_id": 2, "bin_str": "01:00-01:30", "raw_label": "PRIME", "score": 75.0, "confidence": "LOW", "er_mean": 0.35, "range_cost_ratio": 4.0, "false_breakout_rate": 0.5, "follow_through_prob": 0.6},
        {"bin_id": 3, "bin_str": "01:30-02:00", "raw_label": "NO_TRADE", "score": 31.0, "confidence": "HIGH", "er_mean": 0.2, "range_cost_ratio": 3.0, "false_breakout_rate": 0.8, "follow_through_prob": 0.4},
        {"bin_id": 4, "bin_str": "02:00-02:30", "raw_label": "NO_TRADE", "score": 29.0, "confidence": "HIGH", "er_mean": 0.19, "range_cost_ratio": 2.8, "false_breakout_rate": 0.82, "follow_through_prob": 0.38},
        {"bin_id": 5, "bin_str": "02:30-03:00", "raw_label": "NO_TRADE", "score": 28.0, "confidence": "HIGH", "er_mean": 0.18, "range_cost_ratio": 2.7, "false_breakout_rate": 0.85, "follow_through_prob": 0.35},
    ]

    slots = merge_bins_into_slots(bins, min_slot_minutes=60)

    # The isolated PRIME bin MUST be absorbed into NO_TRADE
    # Resulting in exactly one continuous NO_TRADE slot from 00:00 to 03:00 (180m)
    assert len(slots) == 1
    assert slots[0]["label"] == "NO_TRADE"
    assert slots[0]["start_time"] == "00:00"
    assert slots[0]["end_time"] == "03:00"
    assert slots[0]["duration_minutes"] == 180


def test_valid_prime_slot_preserved_if_60m():
    # If PRIME lasts at least 60m (2 bins), it must NOT be absorbed
    bins = [
        {"bin_id": 0, "bin_str": "00:00-00:30", "raw_label": "NO_TRADE", "score": 30.0, "confidence": "HIGH", "er_mean": 0.2, "range_cost_ratio": 3.0, "false_breakout_rate": 0.8, "follow_through_prob": 0.4},
        {"bin_id": 1, "bin_str": "00:30-01:00", "raw_label": "NO_TRADE", "score": 32.0, "confidence": "HIGH", "er_mean": 0.21, "range_cost_ratio": 3.1, "false_breakout_rate": 0.8, "follow_through_prob": 0.4},
        {"bin_id": 2, "bin_str": "01:00-01:30", "raw_label": "PRIME", "score": 75.0, "confidence": "HIGH", "er_mean": 0.35, "range_cost_ratio": 4.0, "false_breakout_rate": 0.5, "follow_through_prob": 0.6},
        {"bin_id": 3, "bin_str": "01:30-02:00", "raw_label": "PRIME", "score": 78.0, "confidence": "HIGH", "er_mean": 0.36, "range_cost_ratio": 4.2, "false_breakout_rate": 0.48, "follow_through_prob": 0.62},
        {"bin_id": 4, "bin_str": "02:00-02:30", "raw_label": "NO_TRADE", "score": 29.0, "confidence": "HIGH", "er_mean": 0.19, "range_cost_ratio": 2.8, "false_breakout_rate": 0.82, "follow_through_prob": 0.38},
        {"bin_id": 5, "bin_str": "02:30-03:00", "raw_label": "NO_TRADE", "score": 28.0, "confidence": "HIGH", "er_mean": 0.18, "range_cost_ratio": 2.7, "false_breakout_rate": 0.85, "follow_through_prob": 0.35},
    ]

    slots = merge_bins_into_slots(bins, min_slot_minutes=60)
    assert len(slots) == 3
    assert slots[0]["label"] == "NO_TRADE"
    assert slots[1]["label"] == "PRIME"
    assert slots[1]["start_time"] == "01:00"
    assert slots[1]["end_time"] == "02:00"
    assert slots[1]["duration_minutes"] == 60
    assert slots[2]["label"] == "NO_TRADE"


def test_hard_gating_forces_no_trade():
    dummy_config = {
        "classification": {
            "weights": {"efficiency_ratio": 0.3, "variance_ratio": 0.15, "range_cost_ratio": 0.2, "whipsaw_penalty": 0.15, "follow_through_prob": 0.2},
            "gates": {"min_range_cost_multiple": 2.0, "min_rel_volume": 0.5},
            "score_thresholds": {"prime": 70.0, "swing_entry": 78.0, "small_trades": 45.0},
        }
    }

    # Cell with high score metrics but tiny range (Range/Cost = 1.0 < 2.0)
    cells = [
        {"bin_id": 0, "er_mean": 0.4, "er_ci": [0.35, 0.45], "eff_n": 200, "vr": 1.2, "range_cost_ratio": 1.0, "false_breakout_rate": 0.3, "follow_through_prob": 0.65, "rel_volume": 1.0},
        {"bin_id": 1, "er_mean": 0.2, "er_ci": [0.15, 0.25], "eff_n": 200, "vr": 0.9, "range_cost_ratio": 3.0, "false_breakout_rate": 0.8, "follow_through_prob": 0.4, "rel_volume": 1.0},
    ]

    ranked = compute_trend_quality_scores(cells, dummy_config)
    # Cell 0 must be gated to NO_TRADE because range_cost_ratio < 2.0
    assert ranked[0]["gated"] is True
    assert ranked[0]["raw_label"] == "NO_TRADE"
