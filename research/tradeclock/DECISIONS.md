# TradeClock Architectural Decisions & Defaults

This document logs all engineering, quantitative, and architectural decisions made in the TradeClock research pipeline and live IST terminal.

---

## 1. Dual-Gold Data Ingestion Architecture
- **Decision**: Analyze Gold through two independent pipelines rather than splicing series:
  1. `XAUUSD_MT5`: High-resolution MetaTrader-grade institutional spot data spanning 3 full years (Sept 2023 – Sept 2026).
  2. `XAUUSDT_BINANCE`: Crypto-native USD-M perpetual traded on Binance from its onboard date (`2025-12-11 08:05:00 UTC`) through current day (~9 months).
- **Rationale**: Binance XAUUSDT perpetual is too recent to supply 3–4 years of statistical history. Splicing spot gold into a crypto perp introduces artificial basis shifts and masks funding rate / weekend behavior. Running them independently allows statistical rigor on the multi-year spot data while measuring crypto-perp basis, spread, and funding dynamics on the recent sample.
- **Cross-Validation**: The two feeds are aligned on 5-minute close prices across the overlap window to evaluate correlation, tracking error, and closed-market behavior.

## 2. macOS MetaTrader 5 Bridge
- **Decision**: Implement a dual-mode MT5 downloader in `src/tradeclock/download/mt5.py`:
  - When running in an environment with the official `MetaTrader5` Python package (Windows / Windows VPS) and an active MT5 terminal, it directly queries the MT5 terminal API.
  - When running in macOS or Linux (where MetaQuotes provides no native Python wheels), it seamlessly ingests the institutional MetaTrader-grade spot gold feed (Dukascopy XAU/USD) or reads the verified raw parquet archive.
- **Rationale**: Ensures portability across development environments (macOS local development, Linux servers, Windows execution VPS) without failing dependencies.

## 3. IST 30-Minute Bin Construction from Pure 5-Minute Bars
- **Decision**: All 30-minute IST bins are aggregated strictly from cleaned 5-minute candles (`Asia/Kolkata` timestamps), rather than using native 1-hour or 4-hour exchange candles.
- **Rationale**: Standard crypto exchange bars (Binance) and FX bars are anchored to UTC midnight (`00:00 UTC`). Because IST is `UTC+05:30`, UTC-anchored hourly and daily bars start at `:30` past every IST hour (e.g. 05:30 IST, 06:30 IST). Aggregating directly from 5-minute bars ensures that bins perfectly align with clock boundaries (e.g. 09:00–09:30 IST, 19:00–19:30 IST). Native 1h/4h/1d bars are retained purely for higher-timeframe regime context.

## 4. Time Model: Friday-Late & Monday-Early Blocks
- **Decision**:
  - Saturday 00:00–04:00 IST is classified as `Fri-late` (capturing Friday US afternoon trading).
  - Monday 03:30–06:30 IST is classified as `Mon-early` (capturing Asian market open and Gold weekly restart).
  - Saturday 04:00 IST through Monday 03:30 IST is classified as `CLOSED` (Gold) or `NO_TRADE` (BTC weekend regime).
- **Rationale**: Aligning with institutional session hours rather than raw calendar days prevents false chop classifications during Friday US close and Monday Asian gap opens.

## 5. DST Regimes and Transition Weeks
- **Decision**: Every calendar day is dynamically tagged using `zoneinfo`:
  - `US_SUMMER` (EDT, UTC-4) vs `US_WINTER` (EST, UTC-5).
  - `UK_SUMMER` (BST, UTC+1) vs `UK_WINTER` (GMT, UTC+0).
  - Transition weeks (~3 weeks in March, 1 week in Oct/Nov where US and UK change clocks on different dates) are flagged as `TRANSITION_DESYNC`.
- **Rationale**: New York session open in IST shifts from 19:00 IST (US Summer) to 20:00 IST (US Winter). London open shifts from 13:30 IST to 14:30 IST. Generating separate summer and winter schedules ensures slot timing remains locked to real market volatility rather than drifting by one hour.

## 6. Exponential Recency Weighting & Kish Effective Sample Size
- **Decision**: Compute weighted cell metrics using exponential decay:
  $$w_i = \exp\left(-\frac{\ln(2) \cdot \Delta t}{H}\right)$$
  Default half-life $H = 26$ weeks (6 months). Report Kish effective sample size:
  $$N_{eff} = \frac{\left(\sum w_i\right)^2}{\sum w_i^2}$$
  Run sensitivity tests at $H \in \{13, 26, 52\}$ and unweighted ($H = \infty$).
- **Rationale**: Crypto and macro market regimes shift over 6-month cycles. Older data stabilizes sample size, while recency weights prevent obsolete volatility regimes from dictating current trade windows.

## 7. Block-Bootstrap Confidence Intervals
- **Decision**: 90% confidence intervals for all metrics are computed using a stationary block bootstrap with a block length of 5 days across 1,000 resamples.
- **Rationale**: Intraday price returns and volatility exhibit strong day-to-day clustering and autocorrelation. Standard IID bootstrapping underestimates confidence interval width and inflates apparent statistical significance.

## 8. Conservative Slot Merging & Minimum Slot Length
- **Decision**: Minimum slot duration is set to 60 minutes (two consecutive 30-minute bins). If an isolated 30-minute bin produces a `PRIME` or `SWING_ENTRY` label surrounded by `NO_TRADE`, it is absorbed into the conservative neighbor (`SMALL_TRADES` or `NO_TRADE`).
- **Rationale**: A 30-minute window is too narrow for swing setups and creates whipsaw execution. Only sustained windows of favorable structure qualify as actionable trading slots.
