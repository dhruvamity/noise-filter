# Report 05: Trader Execution Playbook & Checklist

## 1. Operating Philosophy

Trading Bitcoin perpetual futures with tight stops on the 5-minute and 15-minute timeframe requires **disciplined execution timing and structural confluence**.

You are an institutional liquidity sweep trader. You do **not** chase moving averages, you do **not** enter in the middle of ranges, and you **never** enter trades during statistical chop graveyards.

---

## 2. The Daily Execution Checklist (IST)

### Step 1: Time & Day Clearance (The Gatekeeper)
Before even looking at a chart, verify the statistical window:
- [ ] **Is today Monday?**
  - **YES** $\implies$ **STOP. Sit on hands.** Let the weekly range establish. No trades.
  - **NO** $\implies$ Proceed to next check.
- [ ] **Is the current time between 08:00 AM and 12:00 PM IST?**
  - **YES** $\implies$ **STOP. Stand aside.** The Asian morning graveyard has negative expectancy (PF 0.58).
  - **NO** $\implies$ Proceed to next check.
- [ ] **Is the current time between 02:00 PM and 04:00 PM IST, or 05:00 PM and 07:00 PM IST?**
  - **YES** $\implies$ **STAND ASIDE.** These are fakeout trapping windows.
  - **NO** $\implies$ Proceed to Step 2.
- [ ] **Is the current time in a Prime Strike Window?**
  - **12:00 PM – 02:00 PM IST** (London Open Ignition: $PF = 2.03$)
  - **07:00 PM – 11:30 PM IST** (US Cash Session Expansion: $PF = 1.66$)
  - **01:00 AM – 03:00 AM IST** (Late NY Extreme Rejection: $PF = 2.04$)
  - **If YES $\implies$ GREEN LIGHT TO HUNT SETUPS.**

---

### Step 2: Higher-Timeframe (1H) Macro Range Mapping
1. **Identify the 72-Hour Macro Extreme Range**:
   - Rolling 72-Hour Highest High = $R_{\text{high}}$ (Macro Resistance).
   - Rolling 72-Hour Lowest Low = $R_{\text{low}}$ (Macro Support).
   - Macro Range Span = $R_{\text{high}} - R_{\text{low}}$.
2. **Calculate the Extreme 20% Execution Zones**:
   - **Resistance Sell Zone (Top 20%)**: Price $\ge R_{\text{high}} - 0.20 \times \text{Span}$.
   - **Middle 60% Chop Zone (DO NOT TRADE)**: Price is between 20% and 80% of span. **Zero entries permitted.**
   - **Support Buy Zone (Bottom 20%)**: Price $\le R_{\text{low}} + 0.20 \times \text{Span}$.

---

### Step 3: Lower-Timeframe (5M) Execution Trigger

#### For Short Setup (Buyer Trap at Resistance):
1. **The Sweep**: Current or prior 5M candle pierces above $R_{\text{high}}$ ($\text{High} > R_{\text{high}}$).
2. **The Rejection**: The candle fails to sustain and closes back **strictly below** $R_{\text{high}}$ ($\text{Close} < R_{\text{high}}$).
3. **Candle Color Confirmation**: The candle must be a **Red/Bearish close** ($\text{Close} < \text{Open}$), proving that buyers were trapped and sellers took control.
4. **Markov 2.0 Trend Veto Check**:
   - Check the 1H Markov signal $S_{\text{1H}}$.
   - If $S_{\text{1H}} > +0.05$ (Macro 1H is in strong Bull breakout expansion) $\implies$ **VETOED. Do not short.**
   - If $S_{\text{1H}} \le +0.05$ $\implies$ **EXECUTE SHORT AT CANDLE CLOSE.**

#### For Long Setup (Seller Trap at Support):
1. **The Sweep**: Current or prior 5M candle pierces below $R_{\text{low}}$ ($\text{Low} < R_{\text{low}}$).
2. **The Rejection**: The candle fails to sustain and closes back **strictly above** $R_{\text{low}}$ ($\text{Close} > R_{\text{low}}$).
3. **Candle Color Confirmation**: The candle must be a **Green/Bullish close** ($\text{Close} > \text{Open}$), proving that short sellers were trapped.
4. **Markov 2.0 Trend Veto Check**:
   - If $S_{\text{1H}} < -0.05$ (Macro 1H is in strong Bear collapse) $\implies$ **VETOED. Do not catch falling knives.**
   - If $S_{\text{1H}} \ge -0.05$ $\implies$ **EXECUTE LONG AT CANDLE CLOSE.**

---

### Step 4: Risk Management & Order Parameters
- **Stop-Loss (SL)**:
  - Longs: $\text{Sweep Low} \times 0.9995$ (or $\text{Low} - 0.5\times \text{ATR}$).
  - Shorts: $\text{Sweep High} \times 1.0005$ (or $\text{High} + 0.5\times \text{ATR}$).
- **Take-Profit (TP)**:
  - Enforce strictly **$2.0R$** ($\text{Reward} = 2.0 \times \text{Risk}$).
  - Minimum R:R filter: Entry to TP must be $\ge 1.2R$.
- **Time Stop**:
  - Maximum holding duration: **48 bars on 5M (4 hours)**. If the trade has not hit SL or TP within 4 hours, close at market to avoid mid-range consolidation churn.
- **Cooldown**:
  - Minimum 6 bars (30 minutes) cooldown after exiting before re-entering in the same direction.

---

## 3. Weekly Trading Blueprint

```
MONDAY:     [⛔ REST DAY] - Sit on hands. Map 72H range extremes.
TUESDAY:    [🟡 SELECTIVE] - Trade only 12:00–14:00 IST & 19:00–23:00 IST.
WEDNESDAY:  [🏆 PRIME DAY] - Maximum conviction day. Focus heavily on US session (19:00–23:30 IST).
THURSDAY:   [🟡 SELECTIVE] - Trade early London. Avoid overnight hours.
FRIDAY:     [🟡 SELECTIVE] - Trade London & US open. Close all intraday positions before midnight.
SATURDAY:   [🟢 REST / PASSIVE] - Only trade if massive 72H wick sweep triggers.
SUNDAY:     [🟢 EVENING PREP] - Monitor weekly close sweeps (22:00–02:00 IST).
```
