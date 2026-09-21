# TradeClock Data Quality and Hygiene Audit Report

Generated at: 2026-09-21T13:20:55.906003+00:00 UTC

## 1. Raw vs Cleaned Dataset Inventory

| Symbol | TF | Bars | Start Date (UTC) | End Date (UTC) | Duplicates | OHLC Fixes | Zero Vol | Gaps | Max Gap (h) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | 5m | 317,274 | 2023-09-15 08:35 | 2026-09-21 00:00 | 0 | 0 | 5 | 0 | 0.0 |
| **BTCUSDT** | 15m | 105,758 | 2023-09-15 08:45 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **BTCUSDT** | 1h | 26,440 | 2023-09-15 09:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **BTCUSDT** | 4h | 6,610 | 2023-09-15 12:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **BTCUSDT** | 1d | 1,102 | 2023-09-16 00:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **BTCUSDT** | 1w | 157 | 2023-09-18 00:00 | 2026-09-14 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **XAUUSD_MT5** | 5m | 212,177 | 2023-09-15 00:00 | 2026-09-14 23:55 | 0 | 0 | 0 | 780 | 73.1 |
| **XAUUSD_MT5** | 15m | 70,732 | 2023-09-15 00:00 | 2026-09-14 23:45 | 0 | 0 | 0 | 774 | 73.2 |
| **XAUUSD_MT5** | 1h | 17,716 | 2023-09-15 00:00 | 2026-09-14 23:00 | 0 | 0 | 0 | 773 | 74.0 |
| **XAUUSD_MT5** | 4h | 4,791 | 2023-09-15 00:00 | 2026-09-14 20:00 | 0 | 0 | 0 | 161 | 72.0 |
| **XAUUSD_MT5** | 1d | 934 | 2023-09-15 00:00 | 2026-09-14 00:00 | 0 | 0 | 0 | 157 | 72.0 |
| **XAUUSD_MT5** | 1w | 158 | 2023-09-15 00:00 | 2026-09-14 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 5m | 81,696 | 2025-12-11 08:05 | 2026-09-21 00:00 | 0 | 0 | 368 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 15m | 27,232 | 2025-12-11 08:15 | 2026-09-21 00:00 | 0 | 0 | 25 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 1h | 6,808 | 2025-12-11 09:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 4h | 1,702 | 2025-12-11 12:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 1d | 284 | 2025-12-12 00:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |
| **XAUUSDT_BINANCE** | 1w | 41 | 2025-12-15 00:00 | 2026-09-21 00:00 | 0 | 0 | 0 | 0 | 0.0 |

## 2. Resampled vs Native Cross-Check (5m -> Higher Timeframes)

Cross-checking resampled candles from 5m data against exchange-native bars ensures arithmetic fidelity:

| Symbol | Timeframe | Overlapping Bars | Max Close Difference | Mismatches (>0.001) | Audit Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | 15m | 105,758 | 291.900000 | 4 | `FLAGGED` |
| **BTCUSDT** | 1h | 26,440 | 221.500000 | 3 | `FLAGGED` |
| **XAUUSD_MT5** | 15m | 70,732 | 0.000000 | 0 | `PASS` |
| **XAUUSD_MT5** | 1h | 17,694 | 6.877000 | 28 | `FLAGGED` |
| **XAUUSDT_BINANCE** | 15m | 27,232 | 3.900000 | 1 | `FLAGGED` |
| **XAUUSDT_BINANCE** | 1h | 6,808 | 0.050000 | 1 | `FLAGGED` |

## 3. Gold Market Closed Periods & Maintenance Audits

- **Weekend Filter**: Spot Gold markets close Friday 17:00 ET and reopen Sunday 18:00 ET. All weekend price prints or thin holiday bars are flagged in `is_market_closed`.
- **Daily Break**: Monday through Thursday between 17:00 and 18:00 ET represents the standard NYMEX/CME maintenance and settlement window where trading is paused or frozen.
- **Binance XAUUSDT vs MT5 Spot Alignment**: Over the available overlap (Dec 2025 to Sept 2026), closed-market periods in the crypto perp exhibit thin, flat spread widening, which are sanitized to prevent false chop ratings.

## 4. Time Alignment Trap Prevention

- Native exchange bars (1h, 4h, 1d) are anchored to `00:00 UTC = 05:30 IST`, placing bar boundaries exactly 30 minutes off standard IST clock hours.
- **Policy**: All 30-minute IST bins are constructed strictly from validated 5-minute candles to guarantee exact clock alignment (e.g. 09:00, 09:30, 19:00, 19:30 IST). Native higher-timeframe bars are preserved strictly for higher-timeframe context.