# TradeClock: IST Quant Trade-Window Research & Live Terminal

Autonomous quantitative research pipeline and live Indian Standard Time (IST, UTC+5:30) terminal for Bitcoin and Gold perpetuals.

The system answers: **When to look for trades, and when to stay flat.** It does not generate directional entries or predict market direction. Instead, it statistically identifies high-momentum, clean-trending time windows versus noisy chop, whipsaws, and dead liquidity.

---

## Key Features

1. **Strict IST Alignment**: Built natively from 5-minute candles to avoid the 30-minute UTC misalignment trap (since 00:00 UTC = 05:30 IST).
2. **Dual-Gold Ingestion**:
   - **XAUUSD (MT5 / Spot)**: 3+ years of institutional tick/minute data for robust multi-year weekday/DST patterns.
   - **XAUUSDT (Binance USD-M Perp)**: Ingested from its onboard date (Dec 2025) to present for real crypto-perp dynamics.
   - Independent analysis with cross-feed correlation and basis auditing.
3. **DST-Aware Session Modeling**: Tags London and New York daylight saving shifts (`US_SUMMER` vs `US_WINTER`, `UK_SUMMER` vs `UK_WINTER`) and flags transition weeks.
4. **Recency-Weighted Statistics**: Exponential decay ($H=26$ weeks default) with Kish effective sample size ($N_{eff}$) and sensitivity audits at 13, 26, 52 weeks and unweighted.
5. **Rigorous Momentum vs Chop Metrics**:
   - Rolling 60m Efficiency Ratio ($|net| / path$).
   - Variance Ratio (15m vs 5m, 1h vs 15m).
   - Range in bps & ATR multiples vs round-trip transaction costs.
   - Whipsaw rate, wick/body ratio, false-breakout reversal rate.
   - Follow-through probability (+1 ATR before -1 ATR in 3h) & multi-hour continuation.
   - Corwin-Schultz high-low spread estimator and relative volume.
   - 90% block-bootstrap confidence intervals.
6. **Walk-Forward & Null Hypothesis Validation**:
   - Out-of-sample walk-forward test (train up to $T$, test on next 6-12 months).
   - Circular time-shift Monte Carlo null hypothesis testing.
7. **Multi-Interface Live Terminal**:
   - Interactive Python terminal (`python3 -m tradeclock` using Textual/Rich).
   - Dedicated Next.js web subpage (`/tradeclock`).

---

## Directory Structure

```
tradeclock/
├── config.yaml          # Centralized configuration parameters
├── DECISIONS.md         # Quant and engineering architectural decisions
├── Makefile             # Automation targets (data, analyze, validate, report, app, test)
├── README.md            # System documentation
├── data/
│   ├── raw/             # Raw Parquet feeds (immutable)
│   ├── clean/           # Validated, sanitized Parquet series
│   └── quality_report.md
├── schedule/
│   ├── schedule.json    # Compiled production schedule
│   └── demo_schedule.json
├── report/
│   ├── REPORT.md        # Comprehensive written quantitative report
│   ├── report.html      # Self-contained standalone HTML report
│   └── charts/          # PNG heatmaps and timelines
├── src/tradeclock/
│   ├── download/        # Binance & MT5 ingestors
│   ├── clean/           # Data hygiene, gaps, OHLC sanity, resampler
│   ├── timemodel/       # IST timezone, DST regimes, bins, recency
│   ├── metrics/         # Clean move vs chop quantitative engine
│   ├── classify/        # Trend-Quality score & slot merging
│   ├── validate/        # Walk-forward, null tests, stability
│   ├── report/          # Report & visual generator
│   └── terminal/        # Python Textual TUI & CLI
└── tests/               # Comprehensive pytest test suite
```

---

## Quickstart

### 1. Run Tests
```bash
pytest tradeclock/tests -v
```

### 2. Run the Full Research Pipeline
```bash
make data      # Ingest and validate data
make analyze   # Compute metrics and classify slots
make validate  # Run walk-forward and null tests
make report    # Generate markdown and HTML reports
make schedule  # Export production schedule.json
```

### 3. Launch the Live Terminal
```bash
# Python TUI (reads schedule/schedule.json)
python3 -m tradeclock

# Terminal non-interactive modes
python3 -m tradeclock --now       # Single-line status for tmux / status bars
python3 -m tradeclock --day mon   # Inspect Monday schedule
python3 -m tradeclock --json      # Export current slot as JSON
python3 -m tradeclock --demo      # Run using bundled demo schedule

# Web Terminal Subpage
npm run dev
# Open http://localhost:3000/tradeclock
```
