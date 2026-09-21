"""MetaTrader 5 library interface and institutional spot gold loader."""
from __future__ import annotations

import logging
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

LOGGER = logging.getLogger("tradeclock.download.mt5")

FIELDS = ["open_time", "open", "high", "low", "close", "volume"]

INTERVAL_MS = {
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
}

MT5_TF_MAP = {
    "5m": "TIMEFRAME_M5",
    "15m": "TIMEFRAME_M15",
    "1h": "TIMEFRAME_H1",
    "4h": "TIMEFRAME_H4",
    "1d": "TIMEFRAME_D1",
    "1w": "TIMEFRAME_W1",
}


def try_export_from_mt5(
    symbol: str,
    timeframe: str,
    start_dt: datetime,
    end_dt: datetime,
) -> pd.DataFrame | None:
    """Attempt export via official MetaTrader5 Python package if available."""
    try:
        import MetaTrader5 as mt5 # type: ignore
    except ImportError:
        LOGGER.debug("MetaTrader5 package not available in this Python environment.")
        return None

    try:
        if not mt5.initialize():
            LOGGER.warning(f"mt5.initialize() failed: {mt5.last_error()}")
            return None

        tf_const = getattr(mt5, MT5_TF_MAP.get(timeframe, "TIMEFRAME_M5"), None)
        if tf_const is None:
            mt5.shutdown()
            return None

        # Resolve symbol variations
        candidates = [symbol, "XAUUSD", "GOLD", "XAUUSD.m", "XAUUSD.raw", "XAUUSD_i"]
        active_symbol = None
        for cand in candidates:
            if mt5.symbol_info(cand) is not None:
                active_symbol = cand
                break

        if not active_symbol or not mt5.symbol_select(active_symbol, True):
            LOGGER.warning(f"Could not select {symbol} in MT5 Market Watch.")
            mt5.shutdown()
            return None

        rates = mt5.copy_rates_range(active_symbol, tf_const, start_dt, end_dt)
        mt5.shutdown()

        if rates is None or len(rates) == 0:
            return None

        df = pd.DataFrame(rates)
        df["open_time"] = (df["time"] * 1000).astype("int64")
        df["volume"] = df["tick_volume"].astype("float64")
        df = df[FIELDS].drop_duplicates(subset=["open_time"]).sort_values("open_time").reset_index(drop=True)
        return df
    except Exception as exc:
        LOGGER.warning(f"Error during MT5 export: {exc}")
        return None


def load_institutional_spot_gold(
    timeframe: str,
    repo_root: Path,
    target_dir: Path,
) -> pd.DataFrame:
    """Load or copy existing verified institutional spot gold data (MT5-grade feed)."""
    target_dir.mkdir(parents=True, exist_ok=True)
    target_parquet = target_dir / "klines.parquet"

    if target_parquet.exists():
        LOGGER.info(f"Using existing MT5 spot gold parquet at {target_parquet}")
        return pd.read_parquet(target_parquet)

    # Check repository's existing data/xau/raw directory
    source_parquet = repo_root / "data" / "xau" / "raw" / timeframe / "klines.parquet"
    if source_parquet.exists():
        LOGGER.info(f"Copying verified MT5-grade gold data from {source_parquet} to {target_parquet}")
        df = pd.read_parquet(source_parquet)
        df = df[["open_time", "open", "high", "low", "close", "volume"]]
        df.to_parquet(target_parquet, index=False)
        return df

    # If neither exists, raise actionable error
    raise FileNotFoundError(
        f"No source data found for XAUUSD_MT5 {timeframe}. Please run the MT5 exporter on Windows "
        f"or ensure verified parquet exists at {source_parquet}"
    )
