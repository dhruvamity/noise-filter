"""Binance USD-M Futures kline downloader with rate-limit respect and pagination."""
from __future__ import annotations

import json
import logging
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd

try:
    import certifi
    TLS_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except Exception:
    TLS_CONTEXT = ssl._create_unverified_context()

LOGGER = logging.getLogger("tradeclock.download.binance")

BASE_URL = "https://fapi.binance.com"
FIELDS = [
    "open_time",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "close_time",
    "quote_volume",
    "trade_count",
    "taker_buy_volume",
    "taker_buy_quote_volume",
    "ignore",
]

INTERVAL_MS = {
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
    "1w": 7 * 24 * 60 * 60_000,
}


def fetch_json(path: str, params: dict | None = None, max_retries: int = 7) -> dict | list:
    """Execute GET request with exponential backoff and rate-limit handling."""
    url = f"{BASE_URL}{path}"
    if params:
        url += "?" + urlencode(params)

    last_error = None
    for attempt in range(max_retries):
        try:
            req = Request(url, headers={"User-Agent": "TradeClock-Research/1.0"})
            with urlopen(req, timeout=30, context=TLS_CONTEXT) as response:
                return json.load(response)
        except HTTPError as exc:
            last_error = exc
            if exc.code in (418, 429):
                retry_after = float(exc.headers.get("Retry-After", "5") or 5)
                wait_time = max(retry_after, 2 ** attempt)
                LOGGER.warning(f"Binance rate limit hit ({exc.code}). Backing off for {wait_time:.1f}s")
                time.sleep(wait_time)
            elif exc.code in (500, 502, 503, 504):
                wait_time = min(60, 2 ** attempt)
                LOGGER.warning(f"Binance server error ({exc.code}). Backing off for {wait_time:.1f}s")
                time.sleep(wait_time)
            else:
                raise
        except (URLError, TimeoutError) as exc:
            last_error = exc
            wait_time = min(30, 2 ** attempt)
            LOGGER.warning(f"Network error: {exc}. Retrying in {wait_time:.1f}s")
            time.sleep(wait_time)

    raise RuntimeError(f"Failed after {max_retries} attempts: {url} -> {last_error}")


def get_symbol_onboard_ms(symbol: str) -> int:
    """Fetch onboardDate for symbol from exchangeInfo."""
    info = fetch_json("/fapi/v1/exchangeInfo")
    for s in info.get("symbols", []):
        if s.get("symbol") == symbol:
            return int(s.get("onboardDate", 0))
    return 0


def download_binance_klines(
    symbol: str,
    interval: str,
    start_ms: int,
    end_ms: int,
    output_dir: Path,
    existing_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Download historical klines for a symbol and interval, supporting incremental resume."""
    output_dir.mkdir(parents=True, exist_ok=True)
    parquet_file = output_dir / "klines.parquet"

    rows: list[list] = []
    step_ms = INTERVAL_MS[interval]
    limit = 1500

    cursor = start_ms

    # If existing data is provided or on disk, start from last timestamp + step_ms
    if existing_df is not None and not existing_df.empty:
        df = existing_df.copy()
        last_ms = int(df["open_time"].max())
        if last_ms >= start_ms:
            cursor = last_ms + step_ms
            rows = df.values.tolist()
            LOGGER.info(f"Resuming {symbol} {interval} from {datetime.fromtimestamp(cursor/1000, tz=timezone.utc)}")
    elif parquet_file.exists():
        try:
            df = pd.read_parquet(parquet_file)
            last_ms = int(df["open_time"].max())
            if last_ms >= start_ms:
                cursor = last_ms + step_ms
                rows = df.values.tolist()
                LOGGER.info(f"Found existing {symbol} {interval} on disk; resuming from {datetime.fromtimestamp(cursor/1000, tz=timezone.utc)}")
        except Exception as e:
            LOGGER.warning(f"Could not read existing parquet {parquet_file}: {e}")

    total_expected = max(0, (end_ms - cursor) // step_ms)
    LOGGER.info(f"Downloading {symbol} {interval}: {datetime.fromtimestamp(cursor/1000, tz=timezone.utc)} -> {datetime.fromtimestamp(end_ms/1000, tz=timezone.utc)} (~{total_expected} bars)")

    while cursor < end_ms:
        params = {
            "symbol": symbol,
            "interval": interval,
            "startTime": cursor,
            "endTime": end_ms,
            "limit": limit,
        }
        batch = fetch_json("/fapi/v1/klines", params=params)
        if not batch:
            break

        rows.extend(batch)
        new_last_ms = int(batch[-1][0])
        if new_last_ms <= cursor:
            break
        cursor = new_last_ms + step_ms
        time.sleep(0.05) # Polite query rate

    if not rows:
        LOGGER.warning(f"No rows retrieved for {symbol} {interval}")
        return pd.DataFrame(columns=FIELDS)

    # Convert to DataFrame
    df = pd.DataFrame(rows, columns=FIELDS)
    for col in ["open", "high", "low", "close", "volume", "quote_volume", "taker_buy_volume", "taker_buy_quote_volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ["open_time", "close_time", "trade_count"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("int64")

    # Deduplicate and sort
    df = df.drop_duplicates(subset=["open_time"]).sort_values("open_time").reset_index(drop=True)
    df.to_parquet(parquet_file, index=False)
    LOGGER.info(f"Saved {symbol} {interval} -> {parquet_file} ({len(df):,} total bars)")
    return df
