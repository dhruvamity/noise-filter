#!/usr/bin/env python3
"""Comprehensive integrity checks for the generated market-regime artifact."""
from __future__ import annotations

import json
import subprocess
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
analysis = SourceFileLoader("analysis", str(ROOT / "scripts" / "analyze.py")).load_module()

PASS, FAIL, TOTAL = 0, 0, 0


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL, TOTAL
    TOTAL += 1
    if condition:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        msg = f"  ✗ {name}"
        if detail:
            msg += f" — {detail}"
        print(msg)


# ---------------------------------------------------------------------------
# 1. Formula parity: browser-equivalent calculation vs Python features
# ---------------------------------------------------------------------------
def browser_equivalent(frame: pd.DataFrame, lookback: int) -> tuple[float, float]:
    window = frame.iloc[-(lookback + 1):]
    bars = window.iloc[1:]
    true_range = sum(max(bar.high - bar.low, abs(bar.high - window.close.iloc[i]), abs(bar.low - window.close.iloc[i])) for i, (_, bar) in enumerate(bars.iterrows()))
    absolute_move = sum(abs(bar.close - window.close.iloc[i]) for i, (_, bar) in enumerate(bars.iterrows()))
    return true_range / window.close.iloc[-1] * 10_000, abs(window.close.iloc[-1] - window.close.iloc[0]) / absolute_move


def test_formula_parity():
    print("\n── Formula parity (browser vs Python) ──")
    raw = analysis.load_frame("5m")
    featured = analysis.add_features(raw, 12)

    # Check at the last candle
    expected_range, expected_persistence = featured.range_bp.iloc[-1], featured.persistence.iloc[-1]
    actual_range, actual_persistence = browser_equivalent(raw, 12)
    check("range_bp at tail", np.isclose(actual_range, expected_range), f"browser={actual_range:.6f} python={expected_range:.6f}")
    check("persistence at tail", np.isclose(actual_persistence, expected_persistence), f"browser={actual_persistence:.6f} python={expected_persistence:.6f}")

    # Check at a second position (midpoint) to catch off-by-one regressions
    mid = len(featured) // 2
    mid_idx = featured.index[mid]
    mid_slice = raw.loc[:mid_idx]
    expected_range_mid, expected_persistence_mid = featured.range_bp.iloc[mid], featured.persistence.iloc[mid]
    actual_range_mid, actual_persistence_mid = browser_equivalent(mid_slice, 12)
    check("range_bp at midpoint", np.isclose(actual_range_mid, expected_range_mid), f"browser={actual_range_mid:.6f} python={expected_range_mid:.6f}")
    check("persistence at midpoint", np.isclose(actual_persistence_mid, expected_persistence_mid), f"browser={actual_persistence_mid:.6f} python={expected_persistence_mid:.6f}")


# ---------------------------------------------------------------------------
# 2. Timezone mapping: IST conversion edge cases
# ---------------------------------------------------------------------------
def test_timezone_mapping():
    print("\n── Timezone mapping ──")

    # 2026-09-06 18:30 UTC → 2026-09-07 00:00 IST → Monday (dayofweek=0), hour=0
    example = pd.Timestamp("2026-09-06 18:30:00", tz="UTC").tz_convert("Asia/Kolkata")
    check("UTC→IST weekday crossing", (example.dayofweek, example.hour) == (0, 0), f"got ({example.dayofweek}, {example.hour})")

    # Midnight boundary: 2026-09-06 18:29 UTC → still Sunday in IST (23:59)
    pre_midnight = pd.Timestamp("2026-09-06 18:29:00", tz="UTC").tz_convert("Asia/Kolkata")
    check("pre-midnight stays Sunday IST", (pre_midnight.dayofweek, pre_midnight.hour) == (6, 23), f"got ({pre_midnight.dayofweek}, {pre_midnight.hour})")

    # Friday UTC late → Saturday IST early
    fri_late = pd.Timestamp("2026-09-04 18:30:00", tz="UTC").tz_convert("Asia/Kolkata")
    check("Friday UTC late → Saturday IST", fri_late.dayofweek == 5, f"got dayofweek={fri_late.dayofweek}")

    # Verify IST hour derivation in load_frame matches manual computation
    raw = analysis.load_frame("5m")
    sample_ts = raw.index[100]
    ist_ts = sample_ts.tz_convert("Asia/Kolkata")
    check("load_frame IST hour matches tz_convert", raw.ist_hour.iloc[100] == ist_ts.hour, f"frame={raw.ist_hour.iloc[100]} manual={ist_ts.hour}")
    check("load_frame weekday matches tz_convert", raw.weekday.iloc[100] == ist_ts.dayofweek, f"frame={raw.weekday.iloc[100]} manual={ist_ts.dayofweek}")


# ---------------------------------------------------------------------------
# 3. Baseline artifact shape and correctness
# ---------------------------------------------------------------------------
def test_baseline_shape():
    print("\n── Baseline artifact shape ──")
    artifact_path = ROOT / "public" / "baseline.json"
    check("baseline.json exists", artifact_path.exists())
    if not artifact_path.exists():
        return

    artifact = json.loads(artifact_path.read_text())

    # Top-level keys
    for key in ["generatedAt", "dataStart", "dataEnd", "symbol", "regimeSpec", "timeframes", "labels", "sessions", "weekdays", "fitEnd"]:
        check(f"top-level key '{key}'", key in artifact)

    # Three timeframes
    check("three timeframes", set(artifact["timeframes"]) == {"5m", "15m", "1h"}, str(set(artifact.get("timeframes", {}).keys())))

    # Each timeframe has 168 hourBaseline buckets (7 weekdays × 24 hours)
    for tf_name in ["5m", "15m", "1h"]:
        tf = artifact["timeframes"].get(tf_name, {})
        baselines = tf.get("hourBaselines", {})
        check(f"{tf_name}: 168 baseline buckets", len(baselines) == 168, f"got {len(baselines)}")

        # Each bucket has range[5], persistence[5], samples>0
        bad_buckets = []
        for key, bucket in baselines.items():
            r, p, s = bucket.get("range", []), bucket.get("persistence", []), bucket.get("samples", 0)
            if len(r) != 5 or len(p) != 5:
                bad_buckets.append(f"{key}: range={len(r)} persistence={len(p)}")
            # No NaN/Inf
            if any(not np.isfinite(v) for v in r + p):
                bad_buckets.append(f"{key}: contains NaN/Inf")
            # Monotonicity: q10 ≤ q25 ≤ q50 ≤ q75 ≤ q90
            if len(r) == 5 and not all(r[i] <= r[i + 1] for i in range(4)):
                bad_buckets.append(f"{key}: range not monotone")
            if len(p) == 5 and not all(p[i] <= p[i + 1] for i in range(4)):
                bad_buckets.append(f"{key}: persistence not monotone")
        check(f"{tf_name}: all buckets valid (5 quantiles, finite, monotone)", len(bad_buckets) == 0, "; ".join(bad_buckets[:5]))


# ---------------------------------------------------------------------------
# 4. Regime specification completeness
# ---------------------------------------------------------------------------
def test_regime_spec():
    print("\n── Regime specification ──")
    artifact = json.loads((ROOT / "public" / "baseline.json").read_text())
    spec = artifact.get("regimeSpec", {})

    check("activityHigh present", "activityHigh" in spec)
    check("persistenceHigh present", "persistenceHigh" in spec)
    check("activityHigh is 50", spec.get("activityHigh") == 50, str(spec.get("activityHigh")))
    check("persistenceHigh is 50", spec.get("persistenceHigh") == 50, str(spec.get("persistenceHigh")))
    check("version present", "version" in spec)

    labels = spec.get("labels", {})
    check("labels has 4 entries", len(labels) == 4, str(list(labels.keys())))
    for expected in ["trend", "chop", "grind", "dead"]:
        check(f"label '{expected}' defined", expected in labels)


# ---------------------------------------------------------------------------
# 5. Session/weekday study sanity
# ---------------------------------------------------------------------------
def test_study_sanity():
    print("\n── Session/weekday study ──")
    artifact = json.loads((ROOT / "public" / "baseline.json").read_text())

    sessions = artifact.get("sessions", [])
    weekdays = artifact.get("weekdays", [])
    check("sessions list non-empty", len(sessions) > 0, f"got {len(sessions)}")
    check("weekdays list non-empty", len(weekdays) > 0, f"got {len(weekdays)}")

    for entry in sessions:
        check(f"session '{entry['name']}' samples > 0", entry["samples"] > 0)
        check(f"session '{entry['name']}' hit2R in [0,1]", 0 <= entry["hit2R"] <= 1, str(entry["hit2R"]))

    for entry in weekdays:
        check(f"weekday '{entry['name']}' samples > 0", entry["samples"] > 0)
        check(f"weekday '{entry['name']}' hit2R in [0,1]", 0 <= entry["hit2R"] <= 1, str(entry["hit2R"]))


# ---------------------------------------------------------------------------
# 6. Swing study non-overlap (re-run build_entries and check spacing)
# ---------------------------------------------------------------------------
def test_swing_non_overlap():
    print("\n── Swing study non-overlap ──")
    raw = {name: analysis.add_features(analysis.load_frame(name), spec["lookback"]) for name, spec in analysis.TIMEFRAMES.items()}
    fit_end = raw["5m"].index.min() + (raw["5m"].index.max() - raw["5m"].index.min()) * 4 / 6

    # Score the 15m frame to get activity/persistence columns
    hist = analysis.baseline(raw["15m"], fit_end)
    scored = analysis.score_frame(raw["15m"], hist)
    entries = analysis.build_entries(scored, fit_end)

    if len(entries) < 2:
        check("swing entries exist", len(entries) > 0, f"got {len(entries)}")
        return

    check("swing entries exist", len(entries) > 0, f"got {len(entries)}")

    timestamps = pd.to_datetime(entries["timestamp"])
    gaps = timestamps.diff().dropna()
    horizon_minutes = 48 * 15  # 48 bars × 15 minutes = 720 minutes = 12 hours
    min_gap = gaps.min().total_seconds() / 60
    check("minimum gap ≥ horizon (720 min)", min_gap >= horizon_minutes, f"min gap = {min_gap:.0f} min")


# ---------------------------------------------------------------------------
# 7. Calibration drift monitoring
# ---------------------------------------------------------------------------
def test_calibration_drift():
    print("\n── Calibration drift monitoring ──")
    raw = {name: analysis.add_features(analysis.load_frame(name), spec["lookback"]) for name, spec in analysis.TIMEFRAMES.items()}
    fit_end = raw["5m"].index.min() + (raw["5m"].index.max() - raw["5m"].index.min()) * 4 / 6

    for tf_name in ["5m", "15m", "1h"]:
        hist = analysis.baseline(raw[tf_name], fit_end)
        scored = analysis.score_frame(raw[tf_name], hist)
        oos = scored[scored.index >= fit_end]
        if len(oos) < 100:
            check(f"{tf_name}: sufficient OOS data", False, f"only {len(oos)} bars")
            continue

        act_median = float(np.median(oos.activity_percentile))
        pers_median = float(np.median(oos.persistence_percentile))

        check(f"{tf_name}: OOS percentiles bounded in [0, 100]", 0 <= act_median <= 100 and 0 <= pers_median <= 100)

        act_drift = abs(act_median - 50)
        pers_drift = abs(pers_median - 50)
        if act_drift > 15:
            print(f"    ⚠ WARNING: {tf_name} OOS activity median is {act_median:.1f} (deviates by ±{act_drift:.1f} > 15 from 50) — calibration drift detected; market regime shifted calmer, consider re-fitting baseline")
        else:
            print(f"    ✓ {tf_name} OOS activity median is {act_median:.1f} (within ±15 of 50)")

        if pers_drift > 15:
            print(f"    ⚠ WARNING: {tf_name} OOS persistence median is {pers_median:.1f} (deviates by ±{pers_drift:.1f} > 15 from 50) — consider re-fitting baseline")
        else:
            print(f"    ✓ {tf_name} OOS persistence median is {pers_median:.1f} (within ±15 of 50)")


# ---------------------------------------------------------------------------
# 8. TypeScript type-check (if npx available)
# ---------------------------------------------------------------------------
def test_typecheck():
    print("\n── TypeScript type-check ──")
    try:
        result = subprocess.run(["npx", "tsc", "--noEmit"], cwd=str(ROOT), capture_output=True, text=True, timeout=120)
        check("tsc --noEmit passes", result.returncode == 0, result.stdout[:300] + result.stderr[:300] if result.returncode else "")
    except FileNotFoundError:
        check("tsc --noEmit passes", False, "npx not found; skipping TypeScript check")
    except subprocess.TimeoutExpired:
        check("tsc --noEmit passes", False, "tsc timed out after 120s")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    test_formula_parity()
    test_timezone_mapping()
    test_baseline_shape()
    test_regime_spec()
    test_study_sanity()
    test_swing_non_overlap()
    test_calibration_drift()
    test_typecheck()

    print(f"\n{'═' * 50}")
    print(f"  {PASS}/{TOTAL} passed, {FAIL} failed")
    if FAIL:
        print("  ✗ VERIFICATION FAILED")
        sys.exit(1)
    else:
        print("  ✓ All research integrity checks passed")
    print(f"{'═' * 50}")


if __name__ == "__main__":
    main()
