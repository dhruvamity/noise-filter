#!/usr/bin/env python3
"""Download USDⓈ-M BTCUSDT perpetual klines with exchange-aware pagination."""
from __future__ import annotations

import csv
import json
import os
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

try:
    import certifi
    TLS_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    TLS_CONTEXT = ssl.create_default_context()

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
BASE = "https://fapi.binance.com"
SYMBOL = "BTCUSDT"
INTERVALS = [("5m", 5 * 60_000), ("15m", 15 * 60_000), ("1h", 60 * 60_000)]
FIELDS = ["open_time", "open", "high", "low", "close", "volume", "close_time", "quote_volume", "trade_count", "taker_buy_volume", "taker_buy_quote_volume", "ignore"]


def get_json(path: str, params: dict | None = None, attempts: int = 7):
    url = f"{BASE}{path}"
    if params:
        url += "?" + urlencode(params)
    last = None
    for attempt in range(attempts):
        try:
            req = Request(url, headers={"User-Agent": "btc-market-regime-research/1.0"})
            with urlopen(req, timeout=30, context=TLS_CONTEXT) as response:
                return json.load(response)
        except HTTPError as exc:
            last = exc
            if exc.code not in (418, 429, 500, 502, 503, 504):
                raise
            retry_after = float(exc.headers.get("Retry-After", "0") or 0)
            wait = max(retry_after, min(60, 2 ** attempt))
            print(f"HTTP {exc.code}; backing off {wait:.1f}s", file=sys.stderr)
            time.sleep(wait)
        except (URLError, TimeoutError) as exc:
            last = exc
            wait = min(30, 2 ** attempt)
            print(f"Network error; backing off {wait:.1f}s", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Binance request failed after retries: {last}")


def write_partition(interval: str, rows: list[list]):
    path = RAW / interval
    path.mkdir(parents=True, exist_ok=True)
    csv_path = path / "klines.csv"
    with csv_path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(FIELDS)
        writer.writerows(rows)
    # Prefer Parquet when the optional Arrow engine is present. CSV remains a
    # portable fallback so the analysis can run in a clean Python install.
    try:
        import pandas as pd
        frame = pd.DataFrame(rows, columns=FIELDS)
        frame.to_parquet(path / "klines.parquet", index=False)
        print(f"  wrote {path / 'klines.parquet'}")
    except Exception as exc:
        print(f"  parquet unavailable ({exc}); retained {csv_path}")
    return csv_path


def main():
    months = int(os.environ.get("LOOKBACK_DAYS", "180"))
    info = get_json("/fapi/v1/exchangeInfo")
    server_ms = int(info["serverTime"])
    symbol = next((s for s in info["symbols"] if s["symbol"] == SYMBOL), None)
    if not symbol or symbol.get("contractType") != "PERPETUAL":
        raise RuntimeError("BTCUSDT perpetual is not available in exchangeInfo")
    rate_limits = info.get("rateLimits", [])
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "exchange_info.json").write_text(json.dumps(info, indent=2))
    end_ms = server_ms
    start_ms = int((datetime.fromtimestamp(server_ms / 1000, tz=timezone.utc) - timedelta(days=months)).timestamp() * 1000)
    print(f"BTCUSDT perpetual · {datetime.fromtimestamp(start_ms/1000, tz=timezone.utc).isoformat()} → {datetime.fromtimestamp(end_ms/1000, tz=timezone.utc).isoformat()}")
    print(f"Rate limits: {rate_limits}")
    for interval, step in INTERVALS:
        rows: list[list] = []
        cursor = start_ms
        while cursor < end_ms:
            batch = get_json("/fapi/v1/klines", {"symbol": SYMBOL, "interval": interval, "startTime": cursor, "endTime": end_ms, "limit": 1500})
            if not batch:
                break
            rows.extend(batch)
            next_cursor = int(batch[-1][0]) + step
            if next_cursor <= cursor:
                raise RuntimeError(f"Pagination did not advance for {interval} at {cursor}")
            cursor = next_cursor
            print(f"  {interval}: {len(rows):,} candles", end="\r", flush=True)
            time.sleep(0.08)
        deduped = {int(row[0]): row for row in rows}
        ordered = [deduped[key] for key in sorted(deduped)]
        path = write_partition(interval, ordered)
        expected = max(0, (end_ms - start_ms) // step)
        print(f"\n{interval}: {len(ordered):,} rows (expected approximately {expected:,}), duplicate opens removed: {len(rows)-len(ordered):,}")
    (ROOT / "data" / "download_meta.json").write_text(json.dumps({"symbol": SYMBOL, "source": BASE, "serverTime": server_ms, "startTime": start_ms, "endTime": end_ms, "intervals": [x[0] for x in INTERVALS], "fields": FIELDS}, indent=2))


if __name__ == "__main__":
    main()
