"""Unified download orchestrator for BTCUSDT, XAUUSD_MT5, and XAUUSDT_BINANCE."""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yaml

from tradeclock.download.binance import download_binance_klines, get_symbol_onboard_ms
from tradeclock.download.mt5 import load_institutional_spot_gold, try_export_from_mt5

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
LOGGER = logging.getLogger("tradeclock.download.runner")

ROOT = Path(__file__).resolve().parents[3] # tradeclock root
REPO_ROOT = ROOT.parent # repo root


def load_config() -> dict:
    config_path = ROOT / "config.yaml"
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def run_download(lookback_days: int = 1460): # 4 years default
    config = load_config()
    raw_dir = ROOT / "data" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # Current time and target yesterday
    now = datetime.now(timezone.utc)
    yesterday_end = datetime(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc)
    end_ms = int(yesterday_end.timestamp() * 1000)
    start_ms = int((yesterday_end - timedelta(days=lookback_days)).timestamp() * 1000)

    LOGGER.info(f"Targeting window: {datetime.fromtimestamp(start_ms/1000, tz=timezone.utc)} -> {datetime.fromtimestamp(end_ms/1000, tz=timezone.utc)}")

    timeframes = config.get("timeframes", {}).get("native", ["5m", "15m", "1h", "4h", "1d", "1w"])

    # 1. Download BTCUSDT from Binance Futures
    LOGGER.info("\n=== 1. Ingesting BTCUSDT Perpetual from Binance USD-M Futures ===")
    btc_dir = raw_dir / "BTCUSDT"
    for tf in timeframes:
        tf_dir = btc_dir / tf
        # Check if existing repo raw data exists to accelerate initial seed
        existing_df = None
        repo_btc_parquet = REPO_ROOT / "data" / "raw" / tf / "klines.parquet"
        if repo_btc_parquet.exists() and not (tf_dir / "klines.parquet").exists():
            LOGGER.info(f"Seeding BTCUSDT {tf} from existing repo parquet: {repo_btc_parquet}")
            existing_df = pd.read_parquet(repo_btc_parquet)

        download_binance_klines(
            symbol="BTCUSDT",
            interval=tf,
            start_ms=start_ms,
            end_ms=end_ms,
            output_dir=tf_dir,
            existing_df=existing_df,
        )

    # 2. Ingest XAUUSD_MT5 (MetaTrader-grade Institutional Spot Gold)
    LOGGER.info("\n=== 2. Ingesting XAUUSD Gold from MT5 Library / Institutional Feed ===")
    mt5_dir = raw_dir / "XAUUSD_MT5"
    for tf in timeframes:
        tf_dir = mt5_dir / tf
        tf_dir.mkdir(parents=True, exist_ok=True)
        # Attempt MT5 library first
        start_dt = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
        end_dt = yesterday_end
        df_mt5 = try_export_from_mt5("XAUUSD", tf, start_dt, end_dt)
        if df_mt5 is not None and len(df_mt5) > 0:
            LOGGER.info(f"Exported {len(df_mt5):,} bars directly from MetaTrader 5 terminal for {tf}")
            df_mt5.to_parquet(tf_dir / "klines.parquet", index=False)
        else:
            LOGGER.info(f"Using institutional MT5-grade spot gold feed for {tf}")
            load_institutional_spot_gold(tf, REPO_ROOT, tf_dir)

    # 3. Ingest XAUUSDT_BINANCE (Binance USD-M Gold Perpetual)
    LOGGER.info("\n=== 3. Ingesting XAUUSDT Gold Perpetual from Binance Futures ===")
    xau_perp_dir = raw_dir / "XAUUSDT_BINANCE"
    xau_onboard_ms = get_symbol_onboard_ms("XAUUSDT")
    if xau_onboard_ms == 0:
        # Fallback to Dec 11, 2025
        xau_onboard_ms = 1765440300000
    LOGGER.info(f"XAUUSDT onboard timestamp: {datetime.fromtimestamp(xau_onboard_ms/1000, tz=timezone.utc)}")

    for tf in timeframes:
        tf_dir = xau_perp_dir / tf
        download_binance_klines(
            symbol="XAUUSDT",
            interval=tf,
            start_ms=xau_onboard_ms,
            end_ms=end_ms,
            output_dir=tf_dir,
        )

    LOGGER.info("\n[SUCCESS] All data ingestion completed successfully.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TradeClock Data Ingestion Runner")
    parser.add_argument("--days", type=int, default=1460, help="Lookback days for BTC (default: 1460 = 4y)")
    args = parser.parse_args()
    run_download(lookback_days=args.days)
