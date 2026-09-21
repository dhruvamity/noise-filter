# TASK: INDEPENDENTLY REVALIDATE THE BTC + GOLD IST TRADING TIMETABLE

You are a senior quantitative researcher and trading-system engineer.

The current project already contains a proposed BTC and Gold trading timetable.

Your job is to **independently re-run the historical research from raw candle data and determine whether that timetable is actually statistically justified**.

## CRITICAL REQUIREMENT

**Do NOT assume the existing timetable is correct.**

Treat the existing timetable as an untrusted hypothesis.

Every existing trading and no-trading window must be independently validated against historical market data.

You are explicitly allowed to:

* keep a window,
* shorten a window,
* extend a window,
* split a window,
* merge windows,
* remove a window completely,
* add a new window,
* or conclude that no reliable edge exists for that period.

Do not preserve an existing timetable simply because previous research produced it.

The final timetable must be determined by the data.

---

# 1. RESEARCH OBJECTIVE

The objective is to determine, for every trading day:

> **During which IST time periods does BTC or Gold historically exhibit sufficiently clean directional movement, momentum and follow-through to justify actively looking for trades, and during which continuous periods is the market historically too noisy, choppy, thin, stagnant or unreliable to justify trading?**

The final output must answer this operationally.

For example, the result should be capable of producing something like:

```text
MONDAY

00:00–05:00  NO TRADE
05:00–06:30  SWING / HIGH QUALITY
06:30–11:00  NO TRADE
11:00–13:00  TRADE
13:00–16:30  NO TRADE
16:30–19:00  NO TRADE
19:00–22:30  TRADE
22:30–24:00  NO TRADE
```

The times above are ONLY an example of the desired output format.

Never use them as assumptions.

The actual windows must be derived from historical data.

---

# 2. DO NOT USE SESSION HOURS AS THE PRIMARY METHOD

This is extremely important.

Do NOT create the timetable by simply saying:

* London = trade
* New York = trade
* Asia = no trade
* US open = trade

Do not assume that a major financial session automatically means that BTC or Gold has better tradeable conditions.

Session information may be used for **post-analysis explanation**, but it must NOT determine the initial classification.

The research must begin from observed market behaviour.

For example:

If BTC historically performs well from 05:00–06:30 IST even though that is not an obvious conventional "major session", that window must be allowed to emerge.

Likewise, if a conventional London or US session contains poor historical expectancy, it must be classified as NO_TRADE.

---

# 3. DATA REQUIREMENTS

Obtain at least 3 years and preferably approximately 4 years of historical data.

Use the most recent complete data available.

The primary analysis must use the finest reliable data available.

## BTC

Use:

`BTCUSDT perpetual futures`

Prefer Binance USD-M futures as the long-history source.

Fallbacks may include:

* Bybit
* OKX
* another reputable perpetual venue

Do not silently splice incompatible instruments.

Record:

* exact symbol
* exchange
* first timestamp
* last timestamp
* number of bars
* gaps
* data source

## GOLD

Investigate the actual historical availability of:

* XAU/USD
* Gold futures
* Gold perpetuals
* Binance XAUUSDT
* other reputable gold perpetual/futures instruments

IMPORTANT:

Do NOT pretend that a 3–4 year Gold perpetual dataset exists if the instrument itself did not exist for that entire period.

If the Gold perpetual has insufficient history:

1. obtain the longest consistent high-quality Gold reference series available,
2. analyse that long-history series,
3. separately obtain the actual Gold perp history,
4. validate the relationship between them over the overlap,
5. clearly label which part is proxy analysis and which part is actual perp validation.

Never silently splice the proxy and perpetual datasets together.

---

# 4. REQUIRED TIMEFRAMES

Collect:

* 5m
* 15m
* 1h
* 4h
* 1d
* 1w

The **5-minute data should be the primary source for intraday IST timetable construction**.

Higher timeframes are primarily for:

* market regime,
* trend context,
* volatility context,
* confirmation,
* and robustness analysis.

Do not construct the intraday timetable directly from UTC-anchored daily or hourly exchange candles when this creates IST boundary errors.

Build IST-aligned intraday bins from 5m data.

---

# 5. IST TIME MODEL

All final timetable times must be in:

**Asia/Kolkata / IST / UTC+05:30**

Use proper timezone handling.

Do not hard-code a UTC offset.

The analysis must correctly handle:

* midnight IST
* day boundaries
* Friday late-night continuation
* Monday early hours
* DST changes in other financial centres

The final timetable is expressed in IST even though BTC trades 24/7.

For Gold, correctly identify actual market-closed or thin periods.

---

# 6. WEEKDAY ANALYSIS

Analyse separately:

* Monday
* Tuesday
* Wednesday
* Thursday
* Friday

Handle weekend/transition periods separately rather than blindly treating them as ordinary weekdays.

The primary objective is the weekday-specific timetable.

For example:

Monday's 00:00–01:00 behaviour must be evaluated separately from Tuesday's 00:00–01:00 behaviour.

Do not assume that one universal 24-hour schedule works for every day.

---

# 7. BASE TIME BIN

Start from:

**15-minute or 30-minute IST bins**

with 5-minute data underneath.

Run sensitivity analysis using:

* 15-minute
* 30-minute
* 60-minute

Do not choose the final resolution based purely on which one creates the prettiest timetable.

The final timetable should use the smallest practical window that is statistically stable.

---

# 8. RECENCY WEIGHTING

Recent history must matter more than data from several years ago.

This is a mandatory requirement.

Run at least:

* unweighted
* 13-week half-life
* 26-week half-life
* 52-week half-life

Also separately inspect:

* last 8 weeks
* last 3 months
* last 6 months
* last 12 months
* full historical period

The primary schedule should use an explicitly documented recency-weighted methodology.

For example:

```text
weight = exp(-lambda * age)
```

where age is measured consistently.

Do not simply throw away old data.

Old data provides context and sample size, while recent data should carry greater weight.

---

# 9. WHAT EXACTLY DEFINES A "TRADEABLE WINDOW"?

Do not use profit factor alone.

A window should be considered tradeable only when multiple dimensions support it.

Measure at minimum:

### Momentum

* directional movement
* return magnitude
* normalized return
* ATR-relative movement
* persistence of the move

### Trend cleanliness

* efficiency ratio
* directional efficiency
* path length vs net displacement
* variance ratio
* autocorrelation / directional persistence where useful

### Noise / chop

* reversal frequency
* zig-zag frequency
* wick/body ratio
* false breakout rate
* failed continuation rate
* range contraction
* oscillation frequency

### Follow-through

After a valid breakout or sweep:

* probability of +1 ATR before -1 ATR
* probability of +1.5 ATR before -1 ATR
* median MFE
* median MAE
* continuation after 30m
* continuation after 60m
* continuation after 2h
* continuation after 4h

### Range / opportunity

* average range
* median range
* ATR-normalized range
* percentage of days with meaningful movement
* percentage of windows too quiet to trade

### Liquidity / cost

* volume
* relative volume
* spread proxy where possible
* estimated round-trip transaction cost

A period that moves strongly but produces poor follow-through and constant reversals should not automatically be classified as tradeable.

---

# 10. DO NOT OPTIMIZE FOR PROFIT FACTOR ALONE

A window with:

* 3 trades,
* 2 winners,
* PF 4.0

must NOT automatically be treated as superior to a window with:

* 150 observations,
* stable positive expectancy,
* moderate PF.

Every classification must account for:

* sample size
* confidence intervals
* stability
* historical consistency
* effective sample size

Small samples must receive low confidence.

---

# 11. DEFINE TRADEABLE STATES

Create objective classifications such as:

### NO_TRADE

Use when the period is:

* consistently choppy,
* too quiet,
* poor follow-through,
* negative/insufficient after costs,
* or statistically unreliable.

### SELECTIVE

Moderate historical quality.

Trade only if the strategy setup itself is very strong.

### TRADEABLE

Historically meaningful directional movement with acceptable noise and follow-through.

### PRIME

Strong and stable tradeability across multiple periods/regimes.

### SWING_ENTRY

The beginning of moves that historically have unusually strong multi-hour continuation.

Important:

These labels must be based on quantitative thresholds documented in configuration/code.

---

# 12. IDENTIFY CONTINUOUS WINDOWS

After calculating the bin-level results:

MERGE adjacent bins into continuous periods when they have the same final classification.

For example:

```text
00:00–00:30 NO_TRADE
00:30–01:00 NO_TRADE
01:00–01:30 NO_TRADE
01:30–02:00 NO_TRADE
02:00–02:30 NO_TRADE
02:30–03:00 NO_TRADE
```

must become:

```text
00:00–03:00 NO_TRADE
```

Do NOT output repetitive hourly entries when the underlying classification is continuous.

This compressed schedule is the final human-facing timetable.

---

# 13. EXPLICITLY RESEARCH NO-TRADE WINDOWS

Do not focus only on discovering good periods.

The system must independently identify:

> "When is it statistically better to stay completely flat?"

For every weekday, search for continuous periods where:

* efficiency falls,
* volatility is insufficient,
* false breakouts rise,
* continuation deteriorates,
* expectancy becomes unattractive,
* or noise dominates movement.

The objective is to protect capital by eliminating bad hours.

---

# 14. FIND THE BEST STARTING TIME OF EACH DAY

For each weekday determine:

> "At what exact IST time does the first statistically meaningful trading opportunity of the day begin?"

Example:

```text
Monday
00:00–05:00 NO TRADE
05:00 START LOOKING FOR TRADES
```

But again, this is only an example.

Determine the actual start time statistically.

---

# 15. FIND THE END OF EACH TRADING PERIOD

Likewise determine:

> "At what exact IST time should trading stop because market quality deteriorates?"

This should produce explicit continuous boundaries.

For example:

```text
12:00–14:00 TRADE
14:00–18:30 NO TRADE
18:30–22:00 TRADE
22:00–24:00 NO TRADE
```

Again, do not assume these values.

---

# 16. SWING VS INTRADAY WINDOWS

Do not treat every tradeable period equally.

Separate:

### SWING_ENTRY WINDOWS

Periods where a move starting there historically tends to continue for hours.

### INTRADAY / SMALL-TRADE WINDOWS

Periods where there is sufficient movement for shorter-duration setups but not enough evidence for a multi-hour continuation trade.

### NO-TRADE WINDOWS

Periods where expected movement quality is poor.

The final daily timetable should therefore be capable of saying:

```text
00:00–05:00  NO TRADE
05:00–06:30  SWING ENTRY
06:30–10:30  NO TRADE
10:30–13:00  INTRADAY
13:00–17:00  NO TRADE
17:00–22:00  SWING / INTRADAY
22:00–24:00  NO TRADE
```

Again, this is only a format example.

---

# 17. HISTORICAL DAY-OF-WEEK ANALYSIS

For every weekday calculate:

* number of observations
* tradeable percentage of day
* no-trade percentage of day
* best windows
* worst windows
* median movement
* average movement
* follow-through
* false breakout rate
* efficiency ratio
* confidence
* recent-vs-old change

Do not assume that Wednesday is better simply because a previous report said so.

Re-test it.

---

# 18. YEAR-BY-YEAR STABILITY

For every important window compare:

* Year 1
* Year 2
* Year 3
* most recent year

Also compare:

* full sample
* recent 12 months
* recent 6 months
* recent 3 months

A window that only works during one year should not be given the same confidence as a window that persists across all periods.

---

# 19. REGIME ANALYSIS

Repeat the analysis across:

* high volatility
* low volatility
* trending BTC
* ranging BTC
* bull regime
* bear regime

Use objective regime definitions.

Determine whether the timetable is:

* stable regardless of regime,
* regime-sensitive,
* or unreliable.

Do not make the schedule excessively complicated unless the regime difference is statistically meaningful.

---

# 20. WALK-FORWARD VALIDATION

This is mandatory.

Do NOT select the final timetable using the entire historical dataset and then call it validated.

Perform walk-forward testing.

For example:

Train:
historical data through T

Test:
next 3–6 months

Roll forward.

Repeat until the full period has been tested.

Measure:

* out-of-sample efficiency
* out-of-sample follow-through
* out-of-sample expectancy
* stability of slot rankings
* stability of final timetable
* percentage of selected windows that survive OOS

A timetable that looks excellent in-sample but collapses out-of-sample must be rejected or downgraded.

---

# 21. MULTIPLE-COMPARISON / DATA-MINING PROTECTION

You will be testing many:

* weekdays
* hours
* bins
* metrics
* thresholds
* regimes

Therefore some "good" windows will appear by chance.

Perform a suitable null/randomization test.

Examples:

* circularly shift each day's intraday sequence,
* shuffle weekday labels,
* compare observed best-vs-worst gaps with randomized distributions.

Use appropriate multiple-comparison controls.

Do not treat the strongest observed cell as meaningful automatically.

---

# 22. STABILITY TESTS

Re-run the timetable under:

* 15m bins
* 30m bins
* 60m bins
* ±30 minute bin offsets
* 13-week weighting
* 26-week weighting
* 52-week weighting
* unweighted
* recent-only samples

If the exact boundary moves between:

`11:00`
`11:30`
`12:00`

do not pretend the market has magical precision at 11:30.

Use a broader stable boundary.

The timetable must reflect what is robust, not artificial precision.

---

# 23. COST-AWARE ANALYSIS

Apply realistic trading costs.

At minimum account for:

* fees
* spread/slippage estimate
* realistic round-trip cost

A window that only works before fees but becomes neutral/negative after costs should not be labelled tradeable.

---

# 24. FUTURE-DATA / LOOK-AHEAD PROTECTION

This is mandatory.

Do not use future data to calculate:

* ATR thresholds
* volatility thresholds
* percentile levels
* classification thresholds
* daily schedule selection
* regime labels

Everything must be point-in-time where appropriate.

Especially ensure that:

> A timetable used for a historical test day could only have been generated from information available before that day.

---

# 25. REVALIDATE THE EXISTING TIMETABLE LINE BY LINE

Take the CURRENT timetable and produce an audit table:

| Existing Window    | Keep / Remove / Modify | Evidence | Confidence |
| ------------------ | ---------------------- | -------- | ---------- |
| Monday 12:00–14:00 | ...                    | ...      | ...        |
| Monday 19:00–23:00 | ...                    | ...      | ...        |
| ...                | ...                    | ...      | ...        |

Do this for every existing:

* TRADE window
* NO-TRADE window
* SWING window

This section is critical.

Do not only produce a new timetable.

Show exactly where the existing timetable was:

* correct,
* too broad,
* too narrow,
* unsupported,
* or incorrect.

---

# 26. RED-FLAG EXISTING WINDOWS

Explicitly look for:

### False positives

A supposedly "good" window where:

* recent data deteriorated,
* older data created the apparent edge,
* sample size is small,
* or the edge disappears after costs.

### False negatives

A supposedly "bad" window where:

* recent data is actually strong,
* historical aggregation masked a newer edge,
* or the previous research used a bad classification.

### Session bias

A window that was labelled good simply because it overlaps a known financial session.

This must be flagged and re-tested from pure price behaviour.

---

# 27. GOLD-SPECIFIC REQUIREMENTS

Gold is more complicated than BTC.

Explicitly account for:

* actual exchange/perpetual trading hours,
* closed periods,
* daily maintenance/rollover,
* holidays where relevant,
* thin liquidity,
* different Gold instrument histories.

Do not transfer BTC assumptions onto Gold.

Do not transfer Gold assumptions onto BTC.

Each instrument gets its own independent timetable.

---

# 28. FINAL TIMETABLE FORMAT

The final result must be extremely simple.

### BTC — IST

```text
MONDAY
00:00–05:00  NO TRADE
05:00–06:30  SWING
06:30–11:00  NO TRADE
11:00–13:00  TRADE
...
```

Then:

```text
TUESDAY
...
```

Continue through Friday.

Do the same for Gold.

No lengthy explanation in this section.

---

# 29. FINAL TIMETABLE SHOULD USE CONTINUOUS INTERVALS

Do not output:

```text
08:00–09:00 NO TRADE
09:00–10:00 NO TRADE
10:00–11:00 NO TRADE
```

when these can be represented as:

```text
08:00–11:00 NO TRADE
```

The goal is a timetable that can realistically be followed manually.

---

# 30. FINAL CONFIDENCE LABELS

For every major window assign:

* HIGH
* MEDIUM
* LOW

based on:

* sample size
* bootstrap CI
* walk-forward performance
* temporal stability
* regime stability
* sensitivity analysis

If a window is low confidence, do not make it look like a hard rule.

---

# 31. FINAL REPORT STRUCTURE

Generate:

## A. DATA AUDIT

Exactly what data was used.

## B. METHODOLOGY

How the windows were detected.

## C. EXISTING TIMETABLE AUDIT

What was correct and what was wrong.

## D. BTC ANALYSIS

Weekday × IST time analysis.

## E. GOLD ANALYSIS

Weekday × IST time analysis.

## F. RECENCY ANALYSIS

How recent history changed the result.

## G. WALK-FORWARD VALIDATION

Out-of-sample verification.

## H. FINAL TIMETABLE

Minimal human-readable output.

## I. UNCERTAINTY / LIMITATIONS

Only material limitations.

---

# 32. FINAL TERMINAL REQUIREMENTS

After the research is complete, the terminal must use the newly validated schedule.

At runtime it should show:

```text
IST: 14:37
DAY: Wednesday

CURRENT STATUS
NO TRADE

CURRENT WINDOW
14:00–18:30

NEXT TRADE WINDOW
18:30–22:00

TODAY'S SWING WINDOWS
...
```

The terminal must not use:

* hard-coded session assumptions,
* manually entered old timetable values,
* or the previous timetable without validation.

The generated schedule file must be produced directly from the research pipeline.

---

# 33. MOST IMPORTANT FINAL RULE

The final timetable must answer this exact practical question:

> **"If I look at the clock right now, based purely on historical market behaviour and recent-weighted evidence, should I be actively looking for a trade right now, or should I stay completely flat?"**

The answer must be:

* evidence-based,
* statistically validated,
* cost-aware,
* recency-weighted,
* out-of-sample tested,
* and compressed into simple continuous IST windows.

Do NOT optimize for the number of tradeable hours.

If the evidence says:

```text
Trade only 4 hours/day
```

then output 4 hours.

If the evidence says:

```text
There is no statistically reliable edge on Monday
```

then output:

```text
MONDAY — NO TRADE
```

Do not manufacture opportunities.

---

# 34. DEFINITION OF DONE

The task is complete only when all of the following exist:

* fresh BTC historical data
* fresh Gold historical data / validated proxy where necessary
* 5m / 15m / 1h / 4h / 1d / 1w datasets
* data-quality report
* recency-weighted analysis
* weekday analysis
* intraday IST analysis
* tradeable vs no-trade classification
* swing vs intraday classification
* existing timetable audit
* walk-forward validation
* randomization/null testing
* sensitivity testing
* final compressed timetable
* machine-readable schedule
* updated terminal
* automated tests

And the final report must clearly state:

> **Which existing timetable windows survived independent revalidation, which changed, and which were rejected — with the historical evidence behind each change.**
