# Fix checklist

- [x] Use one IST timestamp for historical hour, weekday, date slices, and browser baseline keys.
- [x] Seed browser history and score only closed candles.
- [x] Make browser and research true-range, range, persistence, and percentile calculations identical.
- [x] Centralize regime thresholds in the generated baseline artifact.
- [x] Restore a true two-axis regime map and match UI wording to each quadrant.
- [x] Replace UTC-shaped session labels with explicit timezone/DST-aware session definitions.
- [x] Replace overlapping 5m forward windows with discrete 15m continuation entries, 1.2 ATR risk, 2R target, and non-overlap.
- [x] Use 5m, 15m, and 1h data in the generated research artifact and live terminal.
- [x] Remove or wire currently unused calculated features.
- [x] Upgrade local-only logging to a durable/exportable review path without introducing a WebSocket proxy.
- [x] Add verification checks for timezone mapping, formula parity, baseline shape, and production build.
