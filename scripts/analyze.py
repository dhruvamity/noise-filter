#!/usr/bin/env python3
"""Fit timezone-correct regime baselines and a discrete swing-entry study."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "baseline.json"
IST = "Asia/Kolkata"
PROBS = np.array([10, 25, 50, 75, 90], dtype=float)
TIMEFRAMES = {"5m": {"lookback": 12, "label": "60m primary"}, "15m": {"lookback": 8, "label": "2h confirmation"}, "1h": {"lookback": 6, "label": "6h context"}}
REGIME_SPEC = {"version": 3, "activityHigh": 50, "persistenceHigh": 50, "labels": {"trend": "activity >= 50 & persistence >= 50, or persistence >= 65 & activity >= 30", "chop": "activity >= 50 & persistence < 50", "grind": "persistence >= 50 & activity < 50", "dead": "activity < 50 & persistence < 50"}}


def load_frame(interval: str) -> pd.DataFrame:
    parquet, csv = RAW / interval / "klines.parquet", RAW / interval / "klines.csv"
    frame = pd.read_parquet(parquet) if parquet.exists() else pd.read_csv(csv)
    frame["open_time"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    for col in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume", "taker_buy_quote_volume"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame.drop_duplicates("open_time").sort_values("open_time").set_index("open_time")
    ist = frame.index.tz_convert(IST)
    frame["ist_hour"], frame["weekday"], frame["ist_date"] = ist.hour, ist.dayofweek, ist.date
    previous = frame.close.shift(1)
    frame["tr"] = np.maximum(frame.high - frame.low, np.maximum((frame.high - previous).abs(), (frame.low - previous).abs()))
    return frame.dropna(subset=["close", "tr"])


def add_features(frame: pd.DataFrame, lookback: int) -> pd.DataFrame:
    frame = frame.copy()
    frame["range_bp"] = frame.tr.rolling(lookback).sum() / frame.close * 10_000
    frame["abs_move"] = frame.close.diff().abs().rolling(lookback).sum()
    frame["persistence"] = (frame.close - frame.close.shift(lookback)).abs() / frame.abs_move.replace(0, np.nan)
    frame["direction"] = np.sign(frame.close - frame.close.shift(lookback))

    frame["atr14"] = frame.tr.rolling(14).mean()
    return frame.dropna(subset=["range_bp", "persistence", "direction", "atr14"])


def robust_stats(values: pd.Series) -> list[float]:
    values = values.replace([np.inf, -np.inf], np.nan).dropna()
    return [float(np.percentile(values, p)) for p in PROBS] if len(values) else [0, 0, 0, 0, 0]


def local_percentile(value: float, quantiles: np.ndarray) -> float:
    """Interpolation without artificial clamping to 5% or 95%."""
    points: list[tuple[float, float]] = []
    for x, p in zip(np.asarray(quantiles, dtype=float), PROBS):
        if not np.isfinite(x):
            continue
        if points and x == points[-1][0]:
            points[-1] = (float(x), float(p))
        else:
            points.append((float(x), float(p)))
    if not points:
        return 50.0
    if value <= points[0][0]:
        return max(0.0, (value / max(points[0][0], 1e-6)) * points[0][1])
    if value >= points[-1][0]:
        overshoot = (value - points[-1][0]) / max(points[-1][0], 1e-6)
        return min(100.0, points[-1][1] + overshoot * (100.0 - points[-1][1]))
    for i, (x, p) in enumerate(points):
        if value == x:
            return p
        if i and value < x:
            left_x, left_p = points[i - 1]
            return left_p + (value - left_x) / (x - left_x) * (p - left_p)
    return points[-1][1]


def baseline(frame: pd.DataFrame, fit_end: pd.Timestamp) -> dict:
    fit, out = frame[frame.index < fit_end], {}
    for weekday in range(7):
        for hour in range(24):
            sample = fit[(fit.weekday == weekday) & (fit.ist_hour == hour)]
            if len(sample) < 20:
                sample = fit[fit.ist_hour == hour]
            out[f"{weekday}-{hour}"] = {"range": robust_stats(sample.range_bp), "persistence": robust_stats(sample.persistence), "samples": int(len(sample))}
    return out


def score_frame(frame: pd.DataFrame, hist: dict) -> pd.DataFrame:
    frame = frame.copy()
    activity, persistence = [], []
    for _, row in frame.iterrows():
        b = hist[f"{int(row.weekday)}-{int(row.ist_hour)}"]
        activity.append(local_percentile(float(row.range_bp), np.array(b["range"])))
        persistence.append(local_percentile(float(row.persistence), np.array(b["persistence"])))
    frame["activity_percentile"], frame["persistence_percentile"] = activity, persistence
    act, pers = frame["activity_percentile"], frame["persistence_percentile"]
    is_trend = ((act >= 50) & (pers >= 50)) | ((pers >= 65) & (act >= 30))
    is_chop = (act >= 50) & (pers < 50)
    is_grind = (pers >= 50) & (act < 50)
    frame["regime"] = np.select([is_trend, is_chop, is_grind], ["trend", "chop", "grind"], default="dead")
    return frame


def session_for(index: pd.DatetimeIndex) -> pd.Series:
    """Non-overlapping sessions expressed in their native market time zones."""
    ny, london, tokyo = index.tz_convert("America/New_York"), index.tz_convert("Europe/London"), index.tz_convert("Asia/Tokyo")
    labels = []
    for n, l, t in zip(ny, london, tokyo):
        nm, lm, tm = n.hour * 60 + n.minute, l.hour * 60 + l.minute, t.hour * 60 + t.minute
        if 570 <= nm < 720:
            labels.append("NY open")
        elif 720 <= nm < 960:
            labels.append("NY afternoon")
        elif 480 <= lm < 990:
            labels.append("London")
        elif 540 <= tm < 900:
            labels.append("Tokyo")
        else:
            labels.append("Overnight")
    return pd.Series(labels, index=index)


def build_entries(frame: pd.DataFrame, fit_end: pd.Timestamp) -> pd.DataFrame:
    """Discrete non-overlapping 15m TREND continuation entries with 1.2 ATR risk."""
    oos = frame[frame.index >= fit_end].copy()
    # Entry when regime is trend (either impulse or steady trend)
    trend = ((oos.activity_percentile >= 50) & (oos.persistence_percentile >= 50)) | ((oos.persistence_percentile >= 65) & (oos.activity_percentile >= 30))
    long = trend & (oos.direction > 0)
    short = trend & (oos.direction < 0)
    horizon, next_allowed, entries = 48, 0, []
    for position, (_, row) in enumerate(oos.iterrows()):
        if position < next_allowed or not (long.iloc[position] or short.iloc[position]) or position + horizon >= len(oos):
            continue
        side = 1 if long.iloc[position] else -1
        entry, risk = float(row.close), float(row.atr14) * 1.2
        future = oos.iloc[position + 1:position + horizon + 1]
        target, stop, outcome, hit_target = entry + side * 2 * risk, entry - side * risk, None, False
        for _, bar in future.iterrows():
            stop_hit = bar.low <= stop if side == 1 else bar.high >= stop
            target_hit = bar.high >= target if side == 1 else bar.low <= target
            if stop_hit:  # conservative when a single bar reaches both levels
                outcome = -1.0
                break
            if target_hit:
                outcome, hit_target = 2.0, True
                break
        if outcome is None:
            outcome = side * (float(future.close.iloc[-1]) - entry) / risk
        mfe = ((future.high.max() - entry) if side == 1 else (entry - future.low.min())) / risk
        mae = ((entry - future.low.min()) if side == 1 else (future.high.max() - entry)) / risk
        entries.append({"timestamp": row.name, "side": "long" if side == 1 else "short", "mfe_r": max(0.0, float(mfe)), "mae_r": max(0.0, float(mae)), "outcome_r": float(outcome), "hit_2r": hit_target, "session": session_for(pd.DatetimeIndex([row.name])).iloc[0], "weekday_name": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][int(row.weekday)]})
        next_allowed = position + horizon
    return pd.DataFrame(entries)


def study_bucket(entries: pd.DataFrame, col: str, order: list[str]) -> list[dict]:
    rows = []
    for label in order:
        group = entries[entries[col] == label]
        if len(group) < 3:
            continue
        rows.append({"name": label, "samples": int(len(group)), "mfeR": float(group.mfe_r.median()), "maeR": float(group.mae_r.median()), "ratio": float(group.mfe_r.median() / max(group.mae_r.median(), 0.05)), "hit2R": float(group.hit_2r.mean()), "medianOutcomeR": float(group.outcome_r.median())})
    return sorted(rows, key=lambda x: (-x["medianOutcomeR"], -x["ratio"]))


def main():
    raw = {name: add_features(load_frame(name), spec["lookback"]) for name, spec in TIMEFRAMES.items()}
    fit_end = raw["5m"].index.min() + (raw["5m"].index.max() - raw["5m"].index.min()) * 4 / 6
    timeframes, scored = {}, {}
    for name, frame in raw.items():
        hist = baseline(frame, fit_end)
        scored[name] = score_frame(frame, hist)
        timeframes[name] = {**TIMEFRAMES[name], "hourBaselines": hist}
    entries = build_entries(scored["15m"], fit_end)
    sessions = study_bucket(entries, "session", ["Tokyo", "London", "NY open", "NY afternoon", "Overnight"])
    weekdays = study_bucket(entries, "weekday_name", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    sanity = {}
    for day in ["2026-09-09", "2026-09-10"]:
        sample = scored["5m"][scored["5m"].ist_date.astype(str) == day]
        if len(sample):
            tail = sample.iloc[-1]
            sanity[day] = {"label": str(tail.regime), "activity": float(tail.activity_percentile), "persistence": float(tail.persistence_percentile), "note": "IST day slice; sanity check only, never used to tune thresholds"}
    oos = scored["5m"][scored["5m"].index >= fit_end]
    labels = {label: int((oos.regime == label).sum()) for label in REGIME_SPEC["labels"]}
    out = {"generatedAt": pd.Timestamp.now(tz="UTC").isoformat(), "dataStart": raw["5m"].index.min().isoformat(), "dataEnd": raw["5m"].index.max().isoformat(), "symbol": "BTCUSDT", "regimeSpec": REGIME_SPEC, "timeframes": timeframes, "labels": labels, "sessions": sessions, "weekdays": weekdays, "sanity": sanity, "fitEnd": fit_end.isoformat(), "swingStudy": "Discrete non-overlapping 15m TREND continuation entries: both activity and persistence axes must be high, direction determines side. Risk is 1.2x ATR(14), target is 2R, maximum hold is 12h. Ambiguous candles touching stop and target are counted as stopped."}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, allow_nan=False))
    print(json.dumps({"output": str(OUT), "rows": {k: len(v) for k, v in scored.items()}, "fitEnd": str(fit_end), "oosLabels": labels, "entries": len(entries), "sessions": sessions, "weekdays": weekdays, "sanity": sanity}, indent=2))


if __name__ == "__main__":
    main()
