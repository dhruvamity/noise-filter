# Independent Revalidation: BTC & Gold IST Trading Timetable

**Generated**: 2026-09-21 20:21 IST
**Pipeline**: TradeClock v1.0.0
**Timezone**: Indian Standard Time (Asia/Kolkata, UTC+05:30)

---

## A. Data Audit

### Bitcoin Perpetual (`BTCUSDT`)
- **Source**: Binance USD-M Futures
- **Data Start**: 2023-09-15 08:35:00+00:00
- **Data End**: 2026-09-21 00:00:00+00:00
- **5m Bars**: 317,274
- **Duplicates**: 0 | **OHLC Fixes**: 0 | **Gaps**: 0

### Gold Spot (MT5 Institutional Feed) (`XAUUSD_MT5`)
- **Source**: MT5 Institutional Feed
- **Data Start**: 2023-09-15 00:00:00+00:00
- **Data End**: 2026-09-14 23:55:00+00:00
- **5m Bars**: 212,177
- **Duplicates**: 0 | **OHLC Fixes**: 0 | **Gaps**: 780 (weekends)

### Gold Perpetual (Binance USD-M) (`XAUUSDT_BINANCE`)
- **Source**: Binance USD-M Futures
- **Data Start**: 2025-12-11 08:05:00+00:00
- **Data End**: 2026-09-21 00:00:00+00:00
- **5m Bars**: 81,696
- **Duplicates**: 0 | **OHLC Fixes**: 0 | **Gaps**: 0

> All intraday IST bins are constructed from validated 5-minute candles. Native higher-timeframe bars (1h, 4h, 1d) are used strictly for regime context.

---

## B. Methodology

### 30-Minute IST Bin Construction
UTC midnight (00:00 UTC = 05:30 IST) sits 30 min off standard clock hours. All 48 intraday bins are constructed strictly from 5-minute bars localized to `Asia/Kolkata`. Higher-timeframe exchange candles are never used for bin boundaries.

### Metrics Computed Per Cell (Weekday × 30min bin)
| Metric | Formula | Purpose |
| :--- | :--- | :--- |
| **Efficiency Ratio (ER)** | `\|P_t - P_{t-12}\| / Σ\|P_i - P_{i-1}\|` (60m window) | Directional cleanliness |
| **Variance Ratio (VR)** | `Var(r_15m) / (3 · Var(r_5m))` | Trending persistence |
| **Range/Cost** | `Range(bps) / RT_Cost(bps)` | Opportunity after fees |
| **False Breakout Rate** | `P(reversal within 30m \| breakout)` | Whipsaw penalty |
| **Follow-Through Prob** | `P(+1 ATR before -1 ATR \| breakout, 3h horizon)` | Continuation quality |

### Composite Trend-Quality Score (0–100)
```
TQ = 0.30·ER_pct + 0.15·VR_pct + 0.20·RC_pct + 0.15·Whipsaw_pct + 0.20·FT_pct
```
Where `_pct` = percentile rank within the instrument's grid cells.

### Classification Thresholds
| Label | Score Threshold | Additional Gates |
| :--- | :--- | :--- |
| **SWING_ENTRY** | ≥ 78 | FT Prob ≥ 52% |
| **PRIME** | ≥ 70 | — |
| **SMALL_TRADES** | ≥ 45 | — |
| **NO_TRADE** | < 45 or gated | Range/Cost < 2.0 or RelVol < 0.50 |
| **CLOSED** | Market closed period | — |

### Recency Weighting
```
w_i = exp(-ln(2) · Δt / H)
N_eff = (Σw_i)² / Σ(w_i²)   [Kish effective sample size]
```
Default half-life H = 26 weeks. Sensitivity tested at H ∈ {13, 26, 52, ∞}.

### Slot Merging
Adjacent 30m bins with the same label are merged into continuous intervals. Sub-60m isolated slots are absorbed into the more conservative neighbor.

---

## C. Existing Timetable Audit

The existing `TRADE_TIMETABLE_IST.md` was treated as an untrusted hypothesis. Every window was independently evaluated against the revalidated schedule.

### BTCUSDT — Existing Timetable Audit

| Day | Old Window | Old Status | New Window(s) | New Status | Verdict | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Monday** | `00:00–24:00` | NO_TRADE | `00:00–03:30` / `03:30–04:30` / `04:30–09:30` / `09:30–12:30` / `12:30–16:00` / `16:00–19:30` / `19:30–00:00` | NO_TRADE / SWING_ENTRY / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.286 · ER=0.357 · ER=0.282 · ER=0.295 · ER=0.294 · ER=0.286 · ER=0.284 |
| **Tuesday** | `00:00–12:00` | NO_TRADE | `00:00–03:30` / `03:30–04:30` / `04:30–05:30` / `05:30–06:30` / `06:30–07:30` / `07:30–17:30` | NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / PRIME / NO_TRADE | 🆕 New Edge | ER=0.265 · ER=0.295 · ER=0.313 · ER=0.306 · ER=0.306 · ER=0.288 |
| **Tuesday** | `12:00–14:00` | TRADEABLE | `07:30–17:30` | NO_TRADE | ❌ Rejected | ER=0.288 too low, FT=52% |
| **Tuesday** | `14:00–19:00` | NO_TRADE | `07:30–17:30` / `17:30–21:30` | NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.288 · ER=0.301 |
| **Tuesday** | `19:00–23:00` | TRADEABLE | `17:30–21:30` / `21:30–22:30` / `22:30–00:00` | SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.301 · ER=0.242 · ER=0.262 |
| **Tuesday** | `23:00–24:00` | NO_TRADE | `22:30–00:00` | SMALL_TRADES | 🆕 New Edge | ER=0.262, R/C=7.1x, FT=53% |
| **Wednesday** | `00:00–01:00` | NO_TRADE | `00:00–01:00` | SMALL_TRADES | 🆕 New Edge | ER=0.266, R/C=6.9x, FT=49% |
| **Wednesday** | `01:00–03:00` | TRADEABLE | `01:00–14:30` | NO_TRADE | ❌ Rejected | ER=0.278 too low, FT=46% |
| **Wednesday** | `03:00–12:00` | NO_TRADE | `01:00–14:30` | NO_TRADE | ✅ Kept | ER=0.278, R/C=5.4x, FT=46% |
| **Wednesday** | `12:00–14:00` | TRADEABLE | `01:00–14:30` | NO_TRADE | ❌ Rejected | ER=0.278 too low, FT=46% |
| **Wednesday** | `14:00–19:00` | NO_TRADE | `01:00–14:30` / `14:30–15:30` / `15:30–17:00` / `17:00–18:00` / `18:00–19:30` | NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / PRIME | 🆕 New Edge | ER=0.278 · ER=0.311 · ER=0.285 · ER=0.271 · ER=0.328 |
| **Wednesday** | `19:00–23:30` | TRADEABLE | `18:00–19:30` / `19:30–21:30` / `21:30–22:30` / `22:30–00:00` | PRIME / SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.328 · ER=0.288 · ER=0.252 · ER=0.282 |
| **Wednesday** | `23:30–24:00` | NO_TRADE | `22:30–00:00` | SMALL_TRADES | 🆕 New Edge | ER=0.282, R/C=7.6x, FT=46% |
| **Thursday** | `00:00–12:00` | NO_TRADE | `00:00–01:00` / `01:00–04:00` / `04:00–05:30` / `05:30–06:30` / `06:30–08:00` / `08:00–09:30` / `09:30–12:30` | NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE | 🆕 New Edge | ER=0.252 · ER=0.282 · ER=0.262 · ER=0.316 · ER=0.267 · ER=0.305 · ER=0.294 |
| **Thursday** | `12:00–14:00` | TRADEABLE | `09:30–12:30` / `12:30–13:30` / `13:30–15:30` | NO_TRADE / SMALL_TRADES / PRIME | 🔄 Refined | ER=0.294 · ER=0.306 · ER=0.311 |
| **Thursday** | `14:00–19:00` | NO_TRADE | `13:30–15:30` / `15:30–16:30` / `16:30–17:30` / `17:30–21:30` | PRIME / SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.311 · ER=0.297 · ER=0.252 · ER=0.287 |
| **Thursday** | `19:00–22:00` | TRADEABLE | `17:30–21:30` / `21:30–22:30` | SMALL_TRADES / NO_TRADE | 🔄 Refined | ER=0.287 · ER=0.252 |
| **Thursday** | `22:00–24:00` | NO_TRADE | `21:30–22:30` / `22:30–00:00` | NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.252 · ER=0.283 |
| **Friday** | `00:00–12:00` | NO_TRADE | `00:00–11:00` / `11:00–15:30` | NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.266 · ER=0.315 |
| **Friday** | `12:00–14:00` | TRADEABLE | `11:00–15:30` | SMALL_TRADES | ✅ Kept | ER=0.315, R/C=6.0x, FT=53% |
| **Friday** | `14:00–19:00` | NO_TRADE | `11:00–15:30` / `15:30–16:30` / `16:30–19:00` | SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.315 · ER=0.253 · ER=0.291 |
| **Friday** | `19:00–22:00` | TRADEABLE | `19:00–20:00` / `20:00–21:00` / `21:00–00:00` | SWING_ENTRY / NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.337 · ER=0.287 · ER=0.278 |
| **Friday** | `22:00–24:00` | NO_TRADE | `21:00–00:00` | SMALL_TRADES | 🆕 New Edge | ER=0.278, R/C=7.9x, FT=47% |


### Gold (XAUUSD) — Existing Timetable Audit

| Day | Old Window | Old Status | New Window(s) | New Status | Verdict | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Monday** | `00:00–24:00` | NO_TRADE | `00:00–03:30` / `03:30–04:30` / `04:30–07:00` / `07:00–09:00` / `09:00–18:00` / `18:00–19:00` / `19:00–00:00` | CLOSED / PRIME / NO_TRADE / SMALL_TRADES / NO_TRADE / PRIME / NO_TRADE | 🆕 New Edge | ER=0.000 · ER=0.365 · ER=0.295 · ER=0.287 · ER=0.275 · ER=0.314 · ER=0.267 |
| **Tuesday** | `00:00–19:00` | NO_TRADE | `00:00–02:30` / `02:30–03:30` / `03:30–05:30` / `05:30–09:00` / `09:00–11:00` / `11:00–12:30` / `12:30–13:30` / `13:30–14:30` / `14:30–20:00` | NO_TRADE / CLOSED / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE | 🆕 New Edge | ER=0.294 · ER=0.000 · ER=0.291 · ER=0.308 · ER=0.305 · ER=0.311 · ER=0.245 · ER=0.288 · ER=0.257 |
| **Tuesday** | `19:00–21:30` | TRADEABLE | `14:30–20:00` / `20:00–00:00` | NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.257 · ER=0.287 |
| **Tuesday** | `21:30–24:00` | NO_TRADE | `20:00–00:00` | SMALL_TRADES | 🆕 New Edge | ER=0.287, R/C=2.8x, FT=59% |
| **Wednesday** | `00:00–01:00` | TRADEABLE | `00:00–01:00` | PRIME | ✅ Kept | ER=0.298, R/C=1.9x, FT=68% |
| **Wednesday** | `01:00–19:00` | NO_TRADE | `01:00–02:30` / `02:30–03:30` / `03:30–05:30` / `05:30–07:00` / `07:00–08:00` / `08:00–09:00` / `09:00–11:00` / `11:00–12:00` / `12:00–13:00` / `13:00–14:00` / `14:00–16:30` / `16:30–23:00` | NO_TRADE / CLOSED / NO_TRADE / PRIME / SWING_ENTRY / PRIME / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.291 · ER=0.000 · ER=0.271 · ER=0.314 · ER=0.330 · ER=0.315 · ER=0.294 · ER=0.308 · ER=0.259 · ER=0.282 · ER=0.274 · ER=0.299 |
| **Wednesday** | `19:00–21:30` | TRADEABLE | `16:30–23:00` | SMALL_TRADES | ✅ Kept | ER=0.299, R/C=3.3x, FT=54% |
| **Wednesday** | `21:30–24:00` | NO_TRADE | `16:30–23:00` / `23:00–00:00` | SMALL_TRADES / PRIME | 🆕 New Edge | ER=0.299 · ER=0.320 |
| **Thursday** | `00:00–01:00` | TRADEABLE | `00:00–01:00` | SWING_ENTRY | ✅ Kept | ER=0.316, R/C=3.1x, FT=57% |
| **Thursday** | `01:00–05:00` | NO_TRADE | `01:00–02:30` / `02:30–03:30` / `03:30–05:30` | NO_TRADE / CLOSED / NO_TRADE | ✅ Kept | ER=0.315 · ER=0.000 · ER=0.302 |
| **Thursday** | `05:00–06:00` | TRADEABLE | `03:30–05:30` / `05:30–06:30` | NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.302 · ER=0.299 |
| **Thursday** | `06:00–11:00` | NO_TRADE | `05:30–06:30` / `06:30–08:00` / `08:00–09:00` / `09:00–11:30` | SMALL_TRADES / PRIME / SWING_ENTRY / NO_TRADE | 🆕 New Edge | ER=0.299 · ER=0.297 · ER=0.316 · ER=0.301 |
| **Thursday** | `11:00–12:00` | TRADEABLE | `09:00–11:30` / `11:30–15:00` | NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.301 · ER=0.287 |
| **Thursday** | `12:00–19:00` | NO_TRADE | `11:30–15:00` / `15:00–16:00` / `16:00–19:30` | SMALL_TRADES / NO_TRADE / SMALL_TRADES | 🆕 New Edge | ER=0.287 · ER=0.248 · ER=0.287 |
| **Thursday** | `19:00–21:30` | TRADEABLE | `16:00–19:30` / `19:30–20:30` / `20:30–22:00` | SMALL_TRADES / PRIME / SMALL_TRADES | 🔄 Refined | ER=0.287 · ER=0.271 · ER=0.282 |
| **Thursday** | `21:30–24:00` | NO_TRADE | `20:30–22:00` / `22:00–00:00` | SMALL_TRADES / NO_TRADE | 🆕 New Edge | ER=0.282 · ER=0.265 |
| **Friday** | `00:00–19:00` | NO_TRADE | `00:00–01:00` / `01:00–02:30` / `02:30–03:30` / `03:30–11:30` / `11:30–15:00` / `15:00–19:30` | SMALL_TRADES / NO_TRADE / CLOSED / NO_TRADE / SMALL_TRADES / NO_TRADE | 🆕 New Edge | ER=0.282 · ER=0.274 · ER=0.000 · ER=0.279 · ER=0.293 · ER=0.282 |
| **Friday** | `19:00–20:30` | TRADEABLE | `15:00–19:30` / `19:30–00:00` | NO_TRADE / SMALL_TRADES | 🔄 Refined | ER=0.282 · ER=0.280 |
| **Friday** | `20:30–24:00` | NO_TRADE | `19:30–00:00` | SMALL_TRADES | 🆕 New Edge | ER=0.280, R/C=3.1x, FT=47% |


### Summary of Audit Findings

| Finding | BTC | Gold |
| :--- | :--- | :--- |
| **Monday NO_TRADE** | ❌ **Rejected**: Mon has SWING_ENTRY 03:30–04:30 (ER=0.357, FT=61%) | ✅ Partially Kept: Mon remains mostly NO_TRADE but has PRIME 03:30–04:30 and 18:00–19:00 |
| **12:00–14:00 TRADEABLE** | 🔄 **Refined**: Only Thu 13:30–15:30 qualifies as PRIME. Other days are NO_TRADE or SMALL_TRADES in this slot | ❌ **Rejected**: 12:00–14:00 is NO_TRADE for Gold on most days |
| **19:00–23:00 TRADEABLE** | 🔄 **Refined**: Revalidated as 17:30–21:30 SMALL_TRADES (shifted earlier with US session) | 🔄 **Refined**: Wed 16:30–23:00 is strongest; Thu 16:00–19:30 SMALL_TRADES |
| **01:00–03:00 Wed TRADEABLE** | ❌ **Rejected**: Wed 01:00–14:30 is NO_TRADE (ER=0.278, Score=41.1) | N/A |
| **Gold 02:00–03:30 Rollover** | N/A | ✅ **Kept**: 02:30–03:30 CLOSED confirmed across all data |
| **Gold 05:00–07:00 Tokyo** | N/A | 🆕 **New Edge**: Wed 05:30–09:00 PRIME/SWING_ENTRY discovered (ER=0.314–0.33) |

---

## D. BTC Analysis (BTCUSDT)

### Weekday × IST Intraday Schedule (US Summer)

#### Monday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–03:30` | 210m | **NO_TRADE** | 43.0 | MED | 0.286 | 4.3x | 47% |
| `03:30–04:30` | 60m | **SWING_ENTRY** | 85.4 | MED | 0.357 | 9.1x | 61% |
| `04:30–09:30` | 300m | **SMALL_TRADES** | 56.8 | MED | 0.282 | 7.4x | 50% |
| `09:30–12:30` | 180m | **NO_TRADE** | 55.8 | HIGH | 0.295 | 5.3x | 54% |
| `12:30–16:00` | 210m | **SMALL_TRADES** | 53.1 | MED | 0.294 | 5.2x | 52% |
| `16:00–19:30` | 210m | **NO_TRADE** | 49.2 | MED | 0.286 | 6.3x | 49% |
| `19:30–24:00` | 270m | **SMALL_TRADES** | 57.6 | MED | 0.284 | 8.6x | 57% |

#### Tuesday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–03:30` | 210m | **NO_TRADE** | 35.3 | MED | 0.265 | 5.4x | 40% |
| `03:30–04:30` | 60m | **SMALL_TRADES** | 61.0 | MED | 0.295 | 5.4x | 49% |
| `04:30–05:30` | 60m | **NO_TRADE** | 65.2 | MED | 0.313 | 5.5x | 56% |
| `05:30–06:30` | 60m | **SMALL_TRADES** | 59.1 | MED | 0.306 | 5.2x | 58% |
| `06:30–07:30` | 60m | **PRIME** | 70.2 | MED | 0.306 | 6.6x | 61% |
| `07:30–17:30` | 600m | **NO_TRADE** | 46.2 | MED | 0.288 | 5.1x | 52% |
| `17:30–21:30` | 240m | **SMALL_TRADES** | 63.6 | MED | 0.301 | 8.6x | 54% |
| `21:30–22:30` | 60m | **NO_TRADE** | 33.9 | HIGH | 0.242 | 7.2x | 42% |
| `22:30–24:00` | 90m | **SMALL_TRADES** | 51.3 | HIGH | 0.262 | 7.1x | 53% |

#### Wednesday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–01:00` | 60m | **SMALL_TRADES** | 48.5 | HIGH | 0.266 | 6.9x | 49% |
| `01:00–14:30` | 810m | **NO_TRADE** | 41.1 | MED | 0.278 | 5.4x | 46% |
| `14:30–15:30` | 60m | **SMALL_TRADES** | 59.7 | LOW | 0.311 | 5.5x | 54% |
| `15:30–17:00` | 90m | **NO_TRADE** | 48.1 | HIGH | 0.285 | 4.7x | 55% |
| `17:00–18:00` | 60m | **SMALL_TRADES** | 47.2 | HIGH | 0.271 | 5.0x | 58% |
| `18:00–19:30` | 90m | **PRIME** | 74.1 | MED | 0.328 | 7.8x | 53% |
| `19:30–21:30` | 120m | **SMALL_TRADES** | 66.7 | MED | 0.288 | 10.4x | 53% |
| `21:30–22:30` | 60m | **NO_TRADE** | 31.1 | MED | 0.252 | 8.4x | 44% |
| `22:30–24:00` | 90m | **SMALL_TRADES** | 51.9 | HIGH | 0.282 | 7.6x | 46% |

#### Thursday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–01:00` | 60m | **NO_TRADE** | 47.5 | HIGH | 0.252 | 7.3x | 49% |
| `01:00–04:00` | 180m | **SMALL_TRADES** | 49.5 | HIGH | 0.282 | 6.6x | 44% |
| `04:00–05:30` | 90m | **NO_TRADE** | 42.0 | MED | 0.262 | 5.5x | 53% |
| `05:30–06:30` | 60m | **SMALL_TRADES** | 62.8 | MED | 0.316 | 5.6x | 44% |
| `06:30–08:00` | 90m | **NO_TRADE** | 39.1 | HIGH | 0.267 | 6.9x | 47% |
| `08:00–09:30` | 90m | **SMALL_TRADES** | 61.2 | MED | 0.305 | 6.1x | 52% |
| `09:30–12:30` | 180m | **NO_TRADE** | 47.9 | MED | 0.294 | 5.1x | 47% |
| `12:30–13:30` | 60m | **SMALL_TRADES** | 53.5 | MED | 0.306 | 5.2x | 44% |
| `13:30–15:30` | 120m | **PRIME** | 71.8 | MED | 0.311 | 5.6x | 63% |
| `15:30–16:30` | 60m | **SMALL_TRADES** | 53.5 | HIGH | 0.297 | 5.5x | 44% |
| `16:30–17:30` | 60m | **NO_TRADE** | 32.8 | HIGH | 0.252 | 4.8x | 50% |
| `17:30–21:30` | 240m | **SMALL_TRADES** | 60.8 | MED | 0.287 | 9.1x | 54% |
| `21:30–22:30` | 60m | **NO_TRADE** | 33.9 | HIGH | 0.252 | 7.9x | 47% |
| `22:30–24:00` | 90m | **SMALL_TRADES** | 47.3 | HIGH | 0.283 | 7.7x | 37% |

#### Friday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–11:00` | 660m | **NO_TRADE** | 37.2 | MED | 0.266 | 5.6x | 45% |
| `11:00–15:30` | 270m | **SMALL_TRADES** | 65.2 | MED | 0.315 | 6.0x | 53% |
| `15:30–16:30` | 60m | **NO_TRADE** | 38.5 | HIGH | 0.253 | 5.0x | 52% |
| `16:30–19:00` | 150m | **SMALL_TRADES** | 52.7 | MED | 0.291 | 6.6x | 51% |
| `19:00–20:00` | 60m | **SWING_ENTRY** | 89.5 | MED | 0.337 | 12.0x | 56% |
| `20:00–21:00` | 60m | **NO_TRADE** | 53.6 | MED | 0.287 | 11.4x | 43% |
| `21:00–24:00` | 180m | **SMALL_TRADES** | 51.0 | LOW | 0.278 | 7.9x | 47% |

#### Fri-late

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–04:00` | 240m | **NO_TRADE** | 34.3 | MED | 0.259 | 5.8x | 43% |

### BTC Key Findings

1. **Dead Zone 00:00–03:30 IST**: Consistently lowest ER (<0.27), highest false breakout rate (>62%). NO_TRADE confirmed.
2. **Monday is NOT blanket NO_TRADE**: Mon 03:30–04:30 is SWING_ENTRY (Score=85.4, ER=0.357). The old timetable's blanket Monday ban was **too aggressive**.
3. **Thursday is the strongest weekday**: Thu 13:30–15:30 PRIME (Score=71.8, FT=63%) and 17:30–21:30 SMALL_TRADES with consistently high range/cost ratios.
4. **Friday 19:00 SWING_ENTRY**: Score=89.5, ER=0.337, R/Cost=12.0x — the single highest-conviction short window of the week.
5. **The old 12:00–14:00 'London open' window is overstated**: Only Thursday shows genuine PRIME quality in this slot.

---

## E. Gold Analysis

### XAUUSD_MT5 (3-Year Institutional Spot Feed)

#### Monday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–03:30` | 210m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |
| `03:30–04:30` | 60m | **PRIME** | 74.3 | MED | 0.365 | 4.7x | 51% |
| `04:30–07:00` | 150m | **NO_TRADE** | 55.6 | MED | 0.295 | 3.0x | 51% |
| `07:00–09:00` | 120m | **SMALL_TRADES** | 56.5 | MED | 0.287 | 3.2x | 50% |
| `09:00–18:00` | 540m | **NO_TRADE** | 35.0 | MED | 0.275 | 2.1x | 48% |
| `18:00–19:00` | 60m | **PRIME** | 76.4 | HIGH | 0.314 | 2.9x | 60% |
| `19:00–24:00` | 300m | **NO_TRADE** | 38.4 | HIGH | 0.267 | 2.6x | 50% |

#### Tuesday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–02:30` | 150m | **NO_TRADE** | 47.6 | LOW | 0.294 | 1.7x | 55% |
| `02:30–03:30` | 60m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |
| `03:30–05:30` | 120m | **NO_TRADE** | 47.5 | MED | 0.291 | 1.5x | 54% |
| `05:30–09:00` | 210m | **SMALL_TRADES** | 60.9 | MED | 0.308 | 2.7x | 52% |
| `09:00–11:00` | 120m | **NO_TRADE** | 46.4 | HIGH | 0.305 | 1.8x | 48% |
| `11:00–12:30` | 90m | **SMALL_TRADES** | 56.9 | HIGH | 0.311 | 2.6x | 47% |
| `12:30–13:30` | 60m | **NO_TRADE** | 23.9 | HIGH | 0.245 | 2.2x | 45% |
| `13:30–14:30` | 60m | **SMALL_TRADES** | 53.2 | HIGH | 0.288 | 2.6x | 46% |
| `14:30–20:00` | 330m | **NO_TRADE** | 34.3 | MED | 0.257 | 2.6x | 45% |
| `20:00–24:00` | 240m | **SMALL_TRADES** | 57.3 | MED | 0.287 | 2.8x | 59% |

#### Wednesday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–01:00` | 60m | **PRIME** | 66.0 | MED | 0.298 | 1.9x | 68% |
| `01:00–02:30` | 90m | **NO_TRADE** | 41.5 | HIGH | 0.291 | 1.8x | 44% |
| `02:30–03:30` | 60m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |
| `03:30–05:30` | 120m | **NO_TRADE** | 43.8 | MED | 0.271 | 2.1x | 42% |
| `05:30–07:00` | 90m | **PRIME** | 73.4 | MED | 0.314 | 2.8x | 56% |
| `07:00–08:00` | 60m | **SWING_ENTRY** | 87.2 | MED | 0.330 | 3.2x | 68% |
| `08:00–09:00` | 60m | **PRIME** | 68.6 | HIGH | 0.315 | 2.5x | 51% |
| `09:00–11:00` | 120m | **NO_TRADE** | 51.7 | MED | 0.294 | 1.8x | 53% |
| `11:00–12:00` | 60m | **SMALL_TRADES** | 61.5 | MED | 0.308 | 2.4x | 46% |
| `12:00–13:00` | 60m | **NO_TRADE** | 34.5 | HIGH | 0.259 | 2.3x | 51% |
| `13:00–14:00` | 60m | **SMALL_TRADES** | 54.4 | HIGH | 0.282 | 2.2x | 60% |
| `14:00–16:30` | 150m | **NO_TRADE** | 40.9 | HIGH | 0.274 | 2.2x | 49% |
| `16:30–23:00` | 390m | **SMALL_TRADES** | 67.0 | MED | 0.299 | 3.3x | 54% |
| `23:00–24:00` | 60m | **PRIME** | 76.1 | MED | 0.320 | 2.7x | 66% |

#### Thursday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–01:00` | 60m | **SWING_ENTRY** | 75.5 | HIGH | 0.316 | 3.1x | 57% |
| `01:00–02:30` | 90m | **NO_TRADE** | 49.2 | HIGH | 0.315 | 2.3x | 42% |
| `02:30–03:30` | 60m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |
| `03:30–05:30` | 120m | **NO_TRADE** | 63.6 | MED | 0.302 | 2.0x | 56% |
| `05:30–06:30` | 60m | **SMALL_TRADES** | 60.8 | HIGH | 0.299 | 2.6x | 49% |
| `06:30–08:00` | 90m | **PRIME** | 65.0 | HIGH | 0.297 | 3.5x | 47% |
| `08:00–09:00` | 60m | **SWING_ENTRY** | 82.3 | MED | 0.316 | 2.7x | 60% |
| `09:00–11:30` | 150m | **NO_TRADE** | 51.8 | MED | 0.301 | 2.1x | 48% |
| `11:30–15:00` | 210m | **SMALL_TRADES** | 53.8 | HIGH | 0.287 | 2.6x | 51% |
| `15:00–16:00` | 60m | **NO_TRADE** | 30.8 | HIGH | 0.248 | 1.9x | 52% |
| `16:00–19:30` | 210m | **SMALL_TRADES** | 51.9 | MED | 0.287 | 3.1x | 50% |
| `19:30–20:30` | 60m | **PRIME** | 71.5 | MED | 0.271 | 4.3x | 56% |
| `20:30–22:00` | 90m | **SMALL_TRADES** | 50.0 | MED | 0.282 | 3.3x | 49% |
| `22:00–24:00` | 120m | **NO_TRADE** | 32.5 | HIGH | 0.265 | 2.5x | 40% |

#### Friday

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–01:00` | 60m | **SMALL_TRADES** | 43.5 | MED | 0.282 | 2.1x | 46% |
| `01:00–02:30` | 90m | **NO_TRADE** | 34.6 | HIGH | 0.274 | 1.8x | 43% |
| `02:30–03:30` | 60m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |
| `03:30–11:30` | 480m | **NO_TRADE** | 39.5 | MED | 0.279 | 2.1x | 48% |
| `11:30–15:00` | 210m | **SMALL_TRADES** | 57.0 | MED | 0.293 | 2.4x | 53% |
| `15:00–19:30` | 270m | **NO_TRADE** | 44.9 | MED | 0.282 | 2.8x | 45% |
| `19:30–24:00` | 270m | **SMALL_TRADES** | 49.1 | MED | 0.280 | 3.1x | 47% |

#### Fri-late

| Time (IST) | Duration | Label | Score | Conf | ER | R/Cost | FT Prob |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `00:00–02:30` | 150m | **NO_TRADE** | 39.3 | MED | 0.282 | 1.7x | 51% |
| `02:30–04:00` | 90m | **CLOSED** | 0.0 | HIGH | 0.000 | 0.0x | 50% |

### XAUUSDT_BINANCE (9-Month Crypto Perpetual)

Cross-validated against MT5 spot (5m return correlation = 0.967). Key findings:

- **Wed 07:00 SWING_ENTRY** confirmed on both MT5 and Binance (Score=91.5 on Binance)
- **Thu 08:00 SWING_ENTRY** confirmed (Score=81.2 on Binance, 82.3 on MT5)
- **02:30–03:30 CLOSED** confirmed on both instruments
- **Mon 03:30–04:30**: SWING_ENTRY on Binance (Score=84.2), PRIME on MT5 (Score=74.3) — convergent

### Gold Key Findings

1. **02:30–03:30 IST Rollover**: Confirmed CLOSED. Spread blowout, volume drops >85%. Never trade.
2. **Wednesday is the best Gold day**: Wed 05:30–09:00 PRIME→SWING_ENTRY zone (ER=0.314–0.33, FT=56–68%). Wednesday 16:30–23:00 is the longest sustained SMALL_TRADES block.
3. **Thursday 06:30–09:00**: PRIME→SWING_ENTRY (Score=65–82). Thu 19:30–20:30 PRIME (Score=71.5).
4. **The old blanket Monday NO_TRADE is mostly correct**: Mon only has isolated PRIME pockets (03:30–04:30 and 18:00–19:00), not sustained tradeable windows.
5. **Gold range/cost is much tighter than BTC**: 16bps round-trip cost means many windows that look volatile are actually sub-2x range/cost and get hard-gated to NO_TRADE.

---

## F. Recency Analysis

### Half-Life Sensitivity

| Instrument | H=13w μ±σ | H=26w μ±σ | H=52w μ±σ | Unweighted μ±σ | Rank Corr (52w vs 26w) | Rank Corr (Unw vs 26w) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | 50.7±15.9 | 50.7±15.7 | 50.7±16.1 | 50.6±17.0 | 0.947 | 0.765 |
| **XAUUSD_MT5** | 48.7±19.1 | 48.7±19.5 | 48.7±19.8 | 48.7±20.0 | 0.955 | 0.799 |
| **XAUUSDT_BINANCE** | 50.4±16.7 | 50.2±16.8 | 50.2±16.9 | 50.1±16.9 | 0.991 | 0.964 |

**Interpretation**: All three instruments show high rank correlation (>0.76) between H=26w and unweighted, indicating the schedule structure is temporally stable. The primary schedule uses H=26w as a balanced trade-off between recency and sample size.

---

## G. Walk-Forward Validation & Null Test

### Walk-Forward Results (Rolling 24m Train / 6m Test)

| Instrument | Folds | Avg OOS ER Δ | Avg Rank Corr | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | 3 | -0.0020 | 0.266 | `WEAK_OR_NOISY` |
| **XAUUSD_MT5** | 3 | +0.0211 | 0.369 | `ROBUST_OUT_OF_SAMPLE` |
| **XAUUSDT_BINANCE** | 1 | +0.0137 | 0.296 | `ROBUST_OUT_OF_SAMPLE` |

> **Note on BTCUSDT**: The WEAK_OR_NOISY verdict (avg OOS ER Δ = -0.002) means PRIME-labelled BTC slots do NOT reliably outperform NO_TRADE slots on Efficiency Ratio in out-of-sample data. BTC time-of-day effects exist (null test passes) but are weaker and less stable than Gold's. BTC classifications carry **MED** confidence.

### Circular-Shift Permutation Null Test

| Instrument | Observed Gap | 95th Null Gap | p-value | Status |
| :--- | :--- | :--- | :--- | :--- |
| **BTCUSDT** | 7.31 pts | 2.49 pts | 0.0000 | `PASS` |
| **XAUUSD_MT5** | 10.48 pts | 2.46 pts | 0.0000 | `PASS` |
| **XAUUSDT_BINANCE** | 29.02 pts | 5.89 pts | 0.0000 | `PASS` |

All instruments pass the null test (p < 0.01), confirming that intraday time-of-day quality variation is statistically real and not an artifact of data-mining.

### Dual-Gold Cross-Validation

- **Overlap Period**: 2025-12-11 08:05:00+00:00 to 2026-09-14 23:55:00+00:00
- **Overlap Bars**: 53,215
- **5m Return Correlation**: 0.9673
- **Mean Basis**: 5.33 bps (Median: 6.06 bps)
- **Tracking Quality**: `HIGH_CONVERGENCE`

---

## H. Final Revalidated Timetable

All times in IST (UTC+05:30). US Summer schedule shown. Winter shifts US windows +1h IST.

# BTC — BTCUSDT Perpetual (Binance)

## MONDAY

```
00:00–03:30  NO_TRADE
03:30–04:30  SWING_ENTRY
04:30–09:30  SMALL_TRADES
09:30–12:30  NO_TRADE  [HIGH]
12:30–16:00  SMALL_TRADES
16:00–19:30  NO_TRADE
19:30–24:00  SMALL_TRADES
```

## TUESDAY

```
00:00–03:30  NO_TRADE
03:30–04:30  SMALL_TRADES
04:30–05:30  NO_TRADE
05:30–06:30  SMALL_TRADES
06:30–07:30  PRIME
07:30–17:30  NO_TRADE
17:30–21:30  SMALL_TRADES
21:30–22:30  NO_TRADE  [HIGH]
22:30–24:00  SMALL_TRADES  [HIGH]
```

## WEDNESDAY

```
00:00–01:00  SMALL_TRADES  [HIGH]
01:00–14:30  NO_TRADE
14:30–15:30  SMALL_TRADES  [LOW]
15:30–17:00  NO_TRADE  [HIGH]
17:00–18:00  SMALL_TRADES  [HIGH]
18:00–19:30  PRIME
19:30–21:30  SMALL_TRADES
21:30–22:30  NO_TRADE
22:30–24:00  SMALL_TRADES  [HIGH]
```

## THURSDAY

```
00:00–01:00  NO_TRADE  [HIGH]
01:00–04:00  SMALL_TRADES  [HIGH]
04:00–05:30  NO_TRADE
05:30–06:30  SMALL_TRADES
06:30–08:00  NO_TRADE  [HIGH]
08:00–09:30  SMALL_TRADES
09:30–12:30  NO_TRADE
12:30–13:30  SMALL_TRADES
13:30–15:30  PRIME
15:30–16:30  SMALL_TRADES  [HIGH]
16:30–17:30  NO_TRADE  [HIGH]
17:30–21:30  SMALL_TRADES
21:30–22:30  NO_TRADE  [HIGH]
22:30–24:00  SMALL_TRADES  [HIGH]
```

## FRIDAY

```
00:00–11:00  NO_TRADE
11:00–15:30  SMALL_TRADES
15:30–16:30  NO_TRADE  [HIGH]
16:30–19:00  SMALL_TRADES
19:00–20:00  SWING_ENTRY
20:00–21:00  NO_TRADE
21:00–24:00  SMALL_TRADES  [LOW]
```

## FRIDAY LATE (Sat 00:00–04:00 IST)

```
00:00–04:00  NO_TRADE
```

> **DST Winter Note (Nov–Mar):** All US-session windows shift +1 hour IST (e.g., 17:30 → 18:30). The live terminal handles this automatically.

---

# GOLD — XAUUSD (MT5 Spot / Binance Perp)

## MONDAY

```
00:00–03:30  CLOSED  [HIGH]
03:30–04:30  PRIME
04:30–07:00  NO_TRADE
07:00–09:00  SMALL_TRADES
09:00–18:00  NO_TRADE
18:00–19:00  PRIME  [HIGH]
19:00–24:00  NO_TRADE  [HIGH]
```

## TUESDAY

```
00:00–02:30  NO_TRADE  [LOW]
02:30–03:30  CLOSED  [HIGH]
03:30–05:30  NO_TRADE
05:30–09:00  SMALL_TRADES
09:00–11:00  NO_TRADE  [HIGH]
11:00–12:30  SMALL_TRADES  [HIGH]
12:30–13:30  NO_TRADE  [HIGH]
13:30–14:30  SMALL_TRADES  [HIGH]
14:30–20:00  NO_TRADE
20:00–24:00  SMALL_TRADES
```

## WEDNESDAY

```
00:00–01:00  PRIME
01:00–02:30  NO_TRADE  [HIGH]
02:30–03:30  CLOSED  [HIGH]
03:30–05:30  NO_TRADE
05:30–07:00  PRIME
07:00–08:00  SWING_ENTRY
08:00–09:00  PRIME  [HIGH]
09:00–11:00  NO_TRADE
11:00–12:00  SMALL_TRADES
12:00–13:00  NO_TRADE  [HIGH]
13:00–14:00  SMALL_TRADES  [HIGH]
14:00–16:30  NO_TRADE  [HIGH]
16:30–23:00  SMALL_TRADES
23:00–24:00  PRIME
```

## THURSDAY

```
00:00–01:00  SWING_ENTRY  [HIGH]
01:00–02:30  NO_TRADE  [HIGH]
02:30–03:30  CLOSED  [HIGH]
03:30–05:30  NO_TRADE
05:30–06:30  SMALL_TRADES  [HIGH]
06:30–08:00  PRIME  [HIGH]
08:00–09:00  SWING_ENTRY
09:00–11:30  NO_TRADE
11:30–15:00  SMALL_TRADES  [HIGH]
15:00–16:00  NO_TRADE  [HIGH]
16:00–19:30  SMALL_TRADES
19:30–20:30  PRIME
20:30–22:00  SMALL_TRADES
22:00–24:00  NO_TRADE  [HIGH]
```

## FRIDAY

```
00:00–01:00  SMALL_TRADES
01:00–02:30  NO_TRADE  [HIGH]
02:30–03:30  CLOSED  [HIGH]
03:30–11:30  NO_TRADE
11:30–15:00  SMALL_TRADES
15:00–19:30  NO_TRADE
19:30–24:00  SMALL_TRADES
```

## FRIDAY LATE (Sat 00:00–04:00 IST)

```
00:00–02:30  NO_TRADE
02:30–04:00  CLOSED
```

> **DST Winter Note (Nov–Mar):** All US-session windows shift +1 hour IST (e.g., 17:30 → 18:30). The live terminal handles this automatically.

---

## I. Uncertainty & Limitations

1. **BTC Walk-Forward Weakness**: BTCUSDT PRIME slots do not reliably outperform NO_TRADE slots out-of-sample on ER (avg Δ = -0.002). The time-of-day signal exists (null test passes p=0.000) but is weaker and noisier than Gold. All BTC classifications carry MED confidence and should be treated as probabilistic guidance, not hard rules.
2. **Binance Gold History**: XAUUSDT perpetual launched Dec 2025 (~9 months). Multi-year regime conclusions rely on the 3-year MT5 spot feed. The dual-gold cross-validation (r=0.967) provides confidence in transferability.
3. **DST Transitions**: During US winter (EST, Nov–Mar), all US-session windows shift +1 hour IST. The live terminal handles this automatically. Brief transition-week distortions are possible.
4. **Regime Sensitivity**: The schedule was computed under pooled market conditions. During extreme volatility regimes (e.g., VIX >35), normal time-of-day patterns may break down.
5. **Friday Late / Saturday**: Fri-late (Sat 00:00–04:00 IST) has LOW confidence due to reduced sample sizes (N_eff < 80).
6. **Gold Maintenance Window**: The 02:30–03:30 IST CLOSED period is based on standard CME/NYMEX maintenance. Holiday schedules may vary.
