# BTCUSDT market-regime terminal

This is a research-first Vercel terminal for BTCUSDT USDⓈ-M perpetuals. It downloads Binance Futures klines, fits a robust two-axis regime filter, ranks broad intraday windows, and uses Binance's public combined market stream in the browser.

## Run the research pipeline

```bash
python3 -m pip install pandas numpy pyarrow certifi
python3 scripts/download_klines.py
python3 scripts/analyze.py
```

The downloader uses `fapi.binance.com/fapi/v1/klines`, paginates at 1,500 candles, reads the exchange's request-weight limits, retries 418/429/5xx responses with backoff, deduplicates on `open_time`, and writes each interval to `data/raw/<interval>/klines.parquet`. UTC is retained as the source timestamp; the analysis derives IST hour and weekday columns. Raw market files are intentionally gitignored. `public/baseline.json` is the deployable research artifact.

## Filter definition

The browser seeds closed Binance candles over REST, then adds only closed WebSocket candles. The primary decision is based on 5m candles; 15m and 1h reads are used as confirmation/context. Every axis uses two values:

- Activity: the rolling 12-candle true-range sum, normalized to basis points.
- Persistence: absolute 12-candle net close move divided by the sum of absolute close-to-close moves.

Each axis is converted to a robust percentile against its own historical IST hour × weekday distribution. UTC is kept as source time, then a timezone-aware `Asia/Kolkata` timestamp supplies both hour and weekday. The distribution is fit on the first four months and checked on the final two. Labels are strict quadrants:

- `TREND`: high activity and high persistence.
- `CHOP`: high activity and low persistence.
- `GRIND`: low activity and high persistence.
- `DEAD`: low activity and low persistence.

The labels describe current conditions, not an entry signal. The UI deliberately shows the driving measurements and a stale state when the WebSocket disconnects.

## Swing-window study

The study uses discrete, non-overlapping 15m continuation entries: both regime axes must be high (`TREND`), and rolling direction determines trade side (the near-redundant EMA20 filter was removed to simplify the system without affecting performance). Risk is `1.2 × ATR(14)`, target is `2R`, and the maximum holding period is 12 hours. A candle touching stop and target is counted conservatively as stopped. Sessions use their native timezone (`Asia/Tokyo`, `Europe/London`, `America/New_York`) so DST is handled correctly. This remains a small six-month research sample, not a production backtest.

## Calibration & Maintenance

- **Calibration Note**: The baseline was fit on a more volatile period (Mar–Jun 2026). In calmer markets, `TREND` will appear less frequently. This is by design — the filter is telling you the market is objectively quieter than the historical norm.
- **Sample Size Caveats**: Session and weekday buckets in the swing study contain modest sample sizes (n=6 to n=11 per bucket), which makes individual rankings noisy and unsuited for standalone trade decisions.
- **Periodic Re-fit**: Re-run the pipeline every 2–3 months as new data accumulates (`npm run data:pipeline`). The 4-month/2-month split will naturally adapt as the window slides to prevent permanent calibration drift.
- **Drift Monitoring**: `scripts/verify_research.py` monitors calibration drift across 5m, 15m, and 1h data and warns if the out-of-sample median percentile deviates by more than ±15 from 50.

## Deploy

```bash
npm install
npm run build
npm run start
```

Deploy the repository to Vercel after running the data pipeline and committing `public/baseline.json`. The browser connects directly to `wss://fstream.binance.com/stream?streams=btcusdt@kline_5m/btcusdt@kline_15m/btcusdt@kline_1h`; no API key or backend WebSocket proxy is needed for public market data. Closed regime calls are retained in browser IndexedDB and can be exported as JSON or CSV from the terminal. A server-side JSONL log is also available when running on a persistent host (`next start`, Docker, VPS).

Run `npm run data:verify` after each analysis run to check timezone mapping, 5m browser/research formula parity, baseline shape, artifact structure, and calibration drift. Use `npm run data:pipeline` to download, analyze, and verify in one command.

See [`research/last-run.md`](research/last-run.md) for the run-specific numbers and caveats.
