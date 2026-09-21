#!/usr/bin/env python3
"""
MetaTrader 5 Python Exporter for XAU/USD (Gold)
================================================
This script is designed for Windows / VPS environments where MetaTrader 5 terminal
is installed and the official MetaTrader5 Python package is available:
    pip install MetaTrader5 pandas pyarrow

It connects to the local MT5 terminal, resolves broker symbol variations (e.g. XAUUSD,
GOLD, XAUUSD.m, XAUUSD.raw), fetches historical klines for multiple timeframes,
and exports them directly into the standardized project parquet/csv structure:
    data/xau/raw/<timeframe>/klines.parquet
    data/xau/raw/<timeframe>/klines.csv

Usage:
    python scripts/mt5_xau_exporter.py --days 1095 --symbol XAUUSD
"""

import argparse
import datetime
import os
import sys
from pathlib import Path

# Target project directory
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "xau" / "raw"

# Timeframe mapping dictionary: project standard -> MT5 constant
TIMEFRAMES = {
    "5m": "TIMEFRAME_M5",
    "15m": "TIMEFRAME_M15",
    "1h": "TIMEFRAME_H1",
    "4h": "TIMEFRAME_H4",
    "1d": "TIMEFRAME_D1",
    "1w": "TIMEFRAME_W1",
}

FIELDS = ["open_time", "open", "high", "low", "close", "volume", "spread"]


def export_from_mt5(symbol_name: str, days: int, login: int = None, password: str = None, server: str = None):
    try:
        import MetaTrader5 as mt5
        import pandas as pd
    except ImportError as e:
        print(f"Error: Missing required packages: {e}")
        print("Please ensure you are running on a Windows machine with:")
        print("    pip install MetaTrader5 pandas pyarrow")
        sys.exit(1)

    # Initialize connection to MT5
    init_params = {}
    if login and password and server:
        init_params = {"login": login, "password": password, "server": server}

    if not mt5.initialize(**init_params):
        print(f"mt5.initialize() failed, error code = {mt5.last_error()}")
        sys.exit(1)

    print(f"Connected to MetaTrader 5 Terminal Build {mt5.version()}")
    terminal_info = mt5.terminal_info()
    account_info = mt5.account_info()
    if terminal_info:
        print(f"Terminal: {terminal_info.name}, Connected: {terminal_info.connected}")
    if account_info:
        print(f"Account: #{account_info.login} ({account_info.company}) - Balance: ${account_info.balance:,.2f}")

    # Resolve symbol name across brokers
    candidates = [symbol_name, "XAUUSD", "GOLD", "XAUUSD.m", "XAUUSD.a", "XAUUSD.raw", "XAUUSD_i", "XAUUSDpro"]
    active_symbol = None
    for cand in candidates:
        info = mt5.symbol_info(cand)
        if info is not None:
            active_symbol = cand
            break

    if active_symbol is None:
        print(f"Error: Could not find Gold symbol matching {candidates} in Market Watch.")
        mt5.shutdown()
        sys.exit(1)

    # Ensure symbol is selected in Market Watch
    if not mt5.symbol_select(active_symbol, True):
        print(f"Failed to select symbol {active_symbol}")
        mt5.shutdown()
        sys.exit(1)

    print(f"Successfully selected symbol: {active_symbol}")

    now = datetime.datetime.now(datetime.timezone.utc)
    start_date = now - datetime.timedelta(days=days)
    print(f"Historical window: {start_date.strftime('%Y-%m-%d %H:%M:%S UTC')} -> {now.strftime('%Y-%m-%d %H:%M:%S UTC')} ({days} days)")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    for tf_name, mt5_tf_const in TIMEFRAMES.items():
        timeframe_enum = getattr(mt5, mt5_tf_const)
        print(f"\nFetching {active_symbol} {tf_name} ({mt5_tf_const})...")

        rates = mt5.copy_rates_range(active_symbol, timeframe_enum, start_date, now)
        if rates is None or len(rates) == 0:
            print(f"  Warning: No data returned for {tf_name} (Error: {mt5.last_error()})")
            continue

        # Convert to DataFrame
        df = pd.DataFrame(rates)
        # MT5 columns: ['time', 'open', 'high', 'low', 'close', 'tick_volume', 'spread', 'real_volume']
        df['open_time'] = df['time'] * 1000 # Convert to millisecond epoch
        df['volume'] = df['tick_volume']
        df = df[['open_time', 'open', 'high', 'low', 'close', 'volume', 'spread']]

        out_dir = DATA_DIR / tf_name
        out_dir.mkdir(parents=True, exist_ok=True)

        parquet_path = out_dir / "klines.parquet"
        csv_path = out_dir / "klines.csv"

        df.to_parquet(parquet_path, index=False)
        df.to_csv(csv_path, index=False)

        print(f"  Saved {len(df):,} candles -> {parquet_path}")

    mt5.shutdown()
    print("\n[SUCCESS] MetaTrader 5 XAU/USD data export completed successfully.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MetaTrader 5 XAU/USD Historical Data Exporter")
    parser.add_argument("--symbol", default="XAUUSD", help="Symbol name in MT5 (e.g. XAUUSD, GOLD)")
    parser.add_argument("--days", type=int, default=1095, help="Number of historical days to fetch (default: 1095 = 3 years)")
    parser.add_argument("--login", type=int, default=None, help="MT5 account login number (optional)")
    parser.add_argument("--password", type=str, default=None, help="MT5 account password (optional)")
    parser.add_argument("--server", type=str, default=None, help="MT5 broker server name (optional)")

    args = parser.parse_args()
    export_from_mt5(args.symbol, args.days, args.login, args.password, args.server)
