#!/usr/bin/env python3
"""
Institutional Multi-Timeframe XAU/USD (Gold) Ingestion Engine
=============================================================
Downloads broker-grade historical klines for XAU/USD (Spot Gold vs US Dollar)
via the Dukascopy institutional tick/candle engine across all 6 timeframes:
    5m, 15m, 1h, 4h, 1d, 1w

The data format conforms to the standardized project schema:
    open_time (ms), open, high, low, close, volume, close_time
Saved as both Parquet and CSV in data/xau/raw/<timeframe>/
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
XAU_RAW = ROOT / "data" / "xau" / "raw"
TEMP_DIR = ROOT / "data" / "xau" / "temp"

# Date range: 3 full years (2023-09-15 to 2026-09-15)
DATE_FROM = "2023-09-15"
DATE_TO = "2026-09-15"

# Dukascopy CLI timeframe mapping
TF_MAP = {
    "1d": "d1",
    "4h": "h4",
    "1h": "h1",
    "15m": "m15",
    "5m": "m5",
}

# Milliseconds per interval
INTERVAL_MS = {
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
}


def download_chunk(tf_name: str, dukas_tf: str, start_date: str, end_date: str) -> list[dict]:
    """Downloads a chunk using dukascopy-node CLI."""
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "npx", "--yes", "dukascopy-node",
        "-i", "xauusd",
        "-from", start_date,
        "-to", end_date,
        "-t", dukas_tf,
        "-f", "json",
        "-v",
        "--directory", str(TEMP_DIR),
        "-s"
    ]
    print(f"  Fetching {tf_name} ({dukas_tf}): {start_date} -> {end_date}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  Warning: CLI error for {tf_name}: {result.stderr}")
        return []

    # Find the generated JSON file in TEMP_DIR
    json_files = list(TEMP_DIR.glob(f"xauusd-{dukas_tf}-bid-*.json"))
    records = []
    for jf in json_files:
        try:
            with open(jf, "r") as f:
                data = json.load(f)
                records.extend(data)
            jf.unlink()  # Clean up temporary chunk
        except Exception as e:
            print(f"  Error reading {jf}: {e}")
    return records


def ingest_timeframe(tf_name: str, dukas_tf: str):
    """Downloads all chunks for a timeframe, deduplicates, and saves to parquet/csv."""
    print(f"\n=======================================================")
    print(f"  INGESTING XAU/USD (GOLD) {tf_name.upper()} DATA")
    print(f"=======================================================")

    # For 5m and 15m, download in 6-month chunks to avoid any process memory/timeout issues
    chunks = [
        ("2023-09-15", "2024-03-15"),
        ("2024-03-15", "2024-09-15"),
        ("2024-09-15", "2025-03-15"),
        ("2025-03-15", "2025-09-15"),
        ("2025-09-15", "2026-03-15"),
        ("2026-03-15", "2026-09-15"),
    ] if tf_name in ("5m", "15m") else [
        ("2023-09-15", "2026-09-15")
    ]

    all_records = []
    for c_start, c_end in chunks:
        recs = download_chunk(tf_name, dukas_tf, c_start, c_end)
        all_records.extend(recs)
        time.sleep(0.5)

    if not all_records:
        raise RuntimeError(f"No records downloaded for XAU/USD {tf_name}!")

    df = pd.DataFrame(all_records)
    # Deduplicate and sort
    df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)

    # Standardize columns
    step_ms = INTERVAL_MS[tf_name]
    df["open_time"] = df["timestamp"]
    df["close_time"] = df["open_time"] + step_ms - 1
    cols = ["open_time", "open", "high", "low", "close", "volume", "close_time"]
    df = df[cols]

    out_dir = XAU_RAW / tf_name
    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = out_dir / "klines.parquet"
    csv_path = out_dir / "klines.csv"

    df.to_parquet(parquet_path, index=False)
    df.to_csv(csv_path, index=False)

    start_dt = datetime.fromtimestamp(df["open_time"].iloc[0] / 1000, tz=timezone.utc)
    end_dt = datetime.fromtimestamp(df["open_time"].iloc[-1] / 1000, tz=timezone.utc)
    print(f"  [SUCCESS] Saved {len(df):,} candles ({start_dt.strftime('%Y-%m-%d')} -> {end_dt.strftime('%Y-%m-%d')})")
    print(f"  Parquet: {parquet_path}")
    print(f"  CSV:     {csv_path}")
    return df


def build_weekly_from_daily(df_daily: pd.DataFrame):
    """Resamples daily candles into weekly candles for 1w timeframe."""
    print(f"\n=======================================================")
    print(f"  GENERATING XAU/USD (GOLD) 1W RESAMPLED DATA")
    print(f"=======================================================")
    df = df_daily.copy()
    df["dt"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df = df.set_index("dt").sort_index()

    weekly = df.resample("W-MON", closed="left", label="left").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
        "open_time": "first"
    }).dropna().reset_index(drop=True)

    step_ms = INTERVAL_MS["1w"]
    weekly["close_time"] = weekly["open_time"] + step_ms - 1
    cols = ["open_time", "open", "high", "low", "close", "volume", "close_time"]
    weekly = weekly[cols]

    out_dir = XAU_RAW / "1w"
    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = out_dir / "klines.parquet"
    csv_path = out_dir / "klines.csv"

    weekly.to_parquet(parquet_path, index=False)
    weekly.to_csv(csv_path, index=False)

    print(f"  [SUCCESS] Generated {len(weekly):,} weekly candles")
    print(f"  Parquet: {parquet_path}")


def main():
    print("Initializing XAU/USD (Spot Gold) Ingestion Engine...")
    print(f"Horizon: {DATE_FROM} -> {DATE_TO} (3 Full Years)\n")

    daily_df = None
    for tf_name, dukas_tf in TF_MAP.items():
        df = ingest_timeframe(tf_name, dukas_tf)
        if tf_name == "1d":
            daily_df = df

    if daily_df is not None:
        build_weekly_from_daily(daily_df)

    # Clean up temp directory
    if TEMP_DIR.exists():
        import shutil
        shutil.rmtree(TEMP_DIR)

    # Write download metadata
    meta = {
        "symbol": "XAUUSD",
        "asset": "Gold vs US Dollar",
        "ingestion_engine": "Dukascopy Institutional MetaTrader-grade Feed",
        "date_from": DATE_FROM,
        "date_to": DATE_TO,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timeframes": list(INTERVAL_MS.keys())
    }
    with open(ROOT / "data" / "xau" / "download_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print("\n[ALL TIMEFRAMES INGESTED SUCCESSFULLY]")


if __name__ == "__main__":
    main()
