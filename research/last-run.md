# Last research run

This run uses six months of BTCUSDT USDⓈ-M Futures klines ending 10 September 2026. It retains all 12 exchange kline fields and has validated counts of 51,840 5m, 17,280 15m, and 4,320 1h candles with no duplicate opens.

## Corrected model

All IST fields now come from a single timezone-aware conversion. The live terminal uses the same 5m rolling window as research: 13 closes produce 12 true-range and close-to-close moves. It seeds closed history before accepting WebSocket updates, preventing forming candles from entering the regime calculation.

Regimes are real two-axis quadrants, using activity ≥55th percentile and persistence ≥65th percentile as the high thresholds. The baseline artifact includes those thresholds and all 168 IST weekday/hour buckets for 5m, 15m, and 1h.

## Simplified swing study

The out-of-sample slice begins 12 July 2026. It contains 47 non-overlapping 15m continuation entries: both activity and persistence are high (`TREND`), and rolling direction determines trade side (the near-redundant EMA20 gate was removed). Risk is 1.2×ATR(14), the target is 2R, and maximum holding time is 12 hours.

The current sample is small. London has 11 qualifying entries, NY open 7, Tokyo 10, NY afternoon 9, and Overnight 10. These rankings are useful for monitoring but are not sufficient to claim a durable day/session edge. Sessions are evaluated in their native market time zones, including DST.

## Calibration & Maintenance

- **Calibration shift**: The baseline was fit on a more volatile period (Mar–Jun 2026, avg candle range ~115–134 bp). The out-of-sample period (Jul–Sep 2026) was calmer (avg candle range ~84–105 bp). Consequently, OOS median activity percentile sits at ~17th percentile rather than 50th, and `TREND` occurs less frequently. This is by design: the filter indicates the market is objectively quieter than the historical norm.
- **Periodic re-fit**: Re-run `npm run data:pipeline` every 2–3 months as new data accumulates.

## Sept sanity checks

The 9 September IST tail is `GRIND` (low activity, high persistence); the available 10 September IST tail is `DEAD` (low activity, low persistence). These are sanity observations only and did not tune the thresholds.
