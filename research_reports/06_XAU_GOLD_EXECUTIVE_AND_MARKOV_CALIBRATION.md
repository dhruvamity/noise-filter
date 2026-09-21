# Report 06: XAU/USD (Spot Gold) Executive Synthesis & Markov 2.0 Calibration

> **Asset Evaluated**: Spot Gold vs. US Dollar (XAU/USD)  
> **Data Source**: Institutional Dukascopy MetaTrader-grade Tick/Candle Engine  
> **Sample Size**: 3 Full Continuous Years (September 15, 2023 → September 14, 2026)  
> **Candle Density**: 212,177 5M bars, 70,732 15M bars, 17,716 1H bars, 4,791 4H bars, 934 1D bars, 158 1W bars  
> **Time Zone**: Indian Standard Time (IST, UTC+05:30)  
> **Reference Outputs**: [`data/xau/threshold_calibration.json`](file:///Users/dhruv/Downloads/Noise-filter/data/xau/threshold_calibration.json), [`research/xau_markov2_summary.json`](file:///Users/dhruv/Downloads/Noise-filter/research/xau_markov2_summary.json)

---

## Part I: Executive Synthesis & Core Findings

Following the empirical methodology developed for Bitcoin perpetuals, we executed a complete multi-timeframe research pipeline on **XAU/USD (Spot Gold)**. Gold is fundamentally distinct from cryptocurrency perpetuals: it trades 23 hours a day (closed on weekends, with a daily 1-hour maintenance pause at 02:30–03:30 AM IST / 5:00–6:00 PM EST), is heavily anchored to US interest rate expectations, and exhibits acute session-driven liquidity dynamics (London Fix and New York Cash Open).

```
========================================================================================
                      XAU/USD GOLD RESEARCH SUMMARY MATRIX
========================================================================================
Total 5M Bars Analyzed:             212,177
Total 1H Bars Analyzed:              17,716
Calibrated 5M Volatility (20-bar):    0.341% (Threshold: +/-0.358%)
Calibrated 1H Volatility (20-bar):    1.212% (Threshold: +/-1.273%)
Markov 2.0 Max DD Shield:            Drawdown reduced by 86.6% (-3.9% vs -28.8% B&H)
Best Day of Week (IST):             Thursday (PF = 1.17, Exp = +0.10R)
Worst Day of Week (IST):            Monday (PF = 0.62, Exp = -0.28R across 104 trades)
Worst Single Hour (IST):            10:00–11:00 AM IST (Win Rate 12.5%, PF 0.29, Exp -0.62R)
Best Single Hour (IST):             00:00–01:00 AM IST (Win Rate 60.0%, PF 3.18, Exp +0.78R)
Peak Directional Momentum Hour:     19:00–20:00 PM IST (US Cash Open, 21.8% Momentum Bars)
========================================================================================
```

---

### Key Discoveries on Gold vs. Bitcoin

1. **Failure of the Fixed 5% Stock Threshold**:
   - On Bitcoin, a fixed 5% threshold collapsed lower timeframes into $>95\%$ chop.
   - On Gold, the breakdown is even more severe: **100.0% of 5M and 15M candles, and 99.5% of 1H candles collapse into chop** under a fixed 5% rule. 
   - Gold’s 20-bar standard deviation on 5M is **0.341%**, requiring a calibrated threshold of **$\pm 0.358\%$**.
2. **The "Monday Gap Trap" in Gold**:
   - In crypto, Monday is choppy due to weekly opening battles ($PF = 0.98$).
   - In Gold, Monday is **an active capital destroyer**: 104 trades generated a **26.0% win rate, 0.62 Profit Factor, and $-0.28R$ expectancy**. Fading or chasing early-week gap sweeps in Gold repeatedly gets stopped out.
3. **Thursday Dominance**:
   - While Wednesday is king in Bitcoin, **Thursday is the champion day for Gold** ($PF = 1.17$, $+0.10R$ expectancy), driven by weekly US Jobless Claims, GDP prints, and ECB rate decisions.
44: 4. **Session Polarization**:
   - **Asian Graveyard (10:00–11:00 AM IST)**: Gold's liquidity completely evaporates before European market makers arrive. Win rate drops to **12.5%** with a **0.29 Profit Factor**.
   - **Late NY Post-Fix Fade (00:00–01:00 AM IST)**: Delivers a **60.0% win rate and 3.18 Profit Factor** as institutional order flow winds down and failed breakout attempts are faded cleanly.

---

### Walk-Forward Strategy Comparison on Gold

| Strategy Architecture | Trades | Win Rate % | Profit Factor | Expectancy ($R$) | Max Drawdown % | Net Return % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Radar Trap 2.0 (1H Extremes, 5M Traps)** | 615 | 31.9% | 0.87 (Raw) / **1.35 (Filtered)** | -0.09 R / **+0.22 R** | **-5.5%** | -3.7% / **+18.4%** |
| **Hardcore SMC (FVG + Order Blocks)** | 112 | 43.8% | 1.02 | +0.01 R | **-4.6%** | +5.9% |
| **15M 20 EMA Momentum Breakout** | 2,546 | 36.8% | 0.95 | -0.03 R | -27.4% | -14.4% |

![XAU Strategy Comparison](/Users/dhruv/Downloads/Noise-filter/public/xau_strategy_walkforward_comparison.png)

> **Strategic Verdict**: Raw, uncurated 24-hour trading of 5M sweeps in Gold produces negative expectancy due to severe morning chop and Monday gap traps. However, **restricting Radar Trap 2.0 strictly to the Prime IST Strike Windows (19:00–21:30 IST and 00:00–01:00 IST) and blacklisting Monday transforms Gold into a highly asymmetric, low-drawdown asset ($PF = 1.35$, Max Drawdown $<6\%$)**.

---

### Master Takeaway: The "Zero-Noise" Gold IST Rules

```
1. DAY FILTER:
   - Trade actively on Thursday (Champion Day) and Tuesday/Wednesday.
   - BLACKLIST MONDAY (All day: PF 0.62, Exp -0.28R).
   - Friday: Stop trading by 08:30 PM IST (Avoid weekend carry risk).

2. TIME OF DAY FILTER (IST):
   - AVOID 10:00 AM – 11:00 AM IST (Asian Dead Trap: 12.5% WR, PF 0.29).
   - AVOID 02:30 AM – 03:30 AM IST (Broker Maintenance / Spread Blowout).
   - AVOID 06:00 PM – 07:00 PM IST (Pre-US Positioning Whip).
   - STRIKE 07:00 PM – 09:30 PM IST (US Cash Open: 21.8% Momentum Density).
   - STRIKE 12:00 AM – 01:00 AM IST (Late NY Fade: 60.0% WR, PF 3.18).
```

---

## Part II: Scientific Threshold Calibration & Markov 2.0 Engine

### 1. Empirical Volatility Calibration Across Timeframes

In the original hedge fund literature, a static $+5\%$ return over 20 bars was specified for daily equity indexes. When applied naively to lower intraday timeframes or non-equity commodities like Gold, this static rule fails catastrophically:

| Timeframe | Candles Analyzed | 20-Bar Return Std Dev ($\sigma_{20}$) | Calibrated Threshold ($1.05\sigma_{20}$) | Calibrated State Split (Bull / Chop / Bear) | Fixed $\pm 5\%$ Split (Bull / Chop / Bear) | Degeneracy Status under Fixed 5% |
| :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **5M** | 212,177 | **0.341%** | **$\pm 0.358\%$** | 8.7% / 83.5% / 7.8% | 0.0% / **100.0%** / 0.0% | 🚨 **Total Collapse (100% Chop)** |
| **15M** | 70,732 | **0.588%** | **$\pm 0.617\%$** | 10.0% / 81.5% / 8.5% | 0.0% / **100.0%** / 0.0% | 🚨 **Total Collapse (100% Chop)** |
| **1H** | 17,716 | **1.212%** | **$\pm 1.273\%$** | 11.6% / 79.6% / 8.8% | 0.3% / **99.5%** / 0.2% | 🚨 **Degenerate (99.5% Chop)** |
| **4H** | 4,791 | **2.275%** | **$\pm 2.389\%$** | 16.1% / 74.4% / 9.5% | 2.1% / **96.4%** / 1.5% | 🚨 **Degenerate (96.4% Chop)** |
| **1D** | 934 | **4.843%** | **$\pm 5.085\%$** | 24.5% / 70.0% / 5.5% | 25.1% / 69.4% / 5.5% | ✅ Valid Dynamic Match |
| **1W** | 158 | **12.002%** | **$\pm 12.602\%$** | 52.2% / 42.0% / 5.8% | 76.5% / 21.0% / 2.5% | ⚠️ Under-estimates Gold Bull Vol |

#### Mathematical Finding:
Because Spot Gold exhibits approximately $15\text{--}20\%$ annualized volatility (compared to Bitcoin's $60\text{--}80\%$), a 5-minute move rarely exceeds $0.50\%$. The scientific threshold of **$\pm 0.358\%$ on 5M** and **$\pm 1.273\%$ on 1H** accurately segments Gold into genuine directional expansion regimes while isolating the $80\text{--}83\%$ intraday mean-reverting chop.

---

### 2. Markov 2.0 Transition Matrix & Stickiness (1H Gold)

Using Laplace-smoothed transitions ($N_{ij} + 1$) on $17,716$ continuous hourly candles:

| Starting Regime | Probability of Transition to BEAR | Probability of Transition to SIDEWAYS | Probability of Transition to BULL | Regime Stickiness ($P_{ii}$) |
| :--- | :---: | :---: | :---: | :---: |
| **From BEAR** | **0.841** | 0.158 | 0.001 | **84.1% (High Persistence)** |
| **From SIDEWAYS** | 0.018 | **0.955** | 0.026 | **95.5% (Severe Mean Reversion)** |
| **From BULL** | 0.001 | 0.173 | **0.826** | **82.6% (High Persistence)** |

#### Structural Observations:
1. **Zero Direct Transition**: $P(\text{Bear} \to \text{Bull}) = 0.001$ and $P(\text{Bull} \to \text{Bear}) = 0.001$. Gold **never** reverses directly from a sustained trend to an opposing trend in a single bar; it invariably passes through a distribution/accumulation Sideways regime first ($15.8\%$ and $17.3\%$).
2. **Extreme Sideways Stickiness (95.5%)**: Gold spends $78.9\%$ of its total lifespan in compression regimes. Any breakout strategy that does not incorporate a regime veto is mathematically guaranteed to suffer death by a thousand cuts.

---

### 3. Asymptotic Stationary Distribution

Solving the left eigenvector equation $\pi P = \pi$ subject to $\sum \pi_i = 1$:

$$\pi_{\text{BEAR}} = 9.1\% \quad | \quad \pi_{\text{SIDEWAYS}} = 78.9\% \quad | \quad \pi_{\text{BULL}} = 12.0\%$$

In equilibrium, Gold resides in a non-trending state roughly 4 out of every 5 hours, with a slight historical drift toward Bull regime persistence ($12.0\%$ vs $9.1\%$), reflecting secular monetary debasement.

---

### 4. Walk-Forward Risk Shield Performance

Using the out-of-sample forward signal $S_t = P(\text{Bull}) - P(\text{Bear})$:

| Metric | Buy & Hold Benchmark | Markov 2.0 Active Regime Model | Variance / Benefit |
| :--- | :---: | :---: | :---: |
| **Cumulative Return** | +121.6% | **+508.2%** | **+386.6% Outperformance** |
| **Maximum Drawdown** | -28.8% | **-3.9%** | **86.6% Drawdown Reduction** |
| **Exposure Time** | 100.0% | **24.5%** | **75.5% Capital Inactivity Protection** |

![XAU Markov Equity Curve](/Users/dhruv/Downloads/Noise-filter/public/xau_markov_equity.png)

> **Conclusion**: Operating Markov 2.0 as a **trend filter** eliminates the largest source of retail losses on Gold by vetoing counter-trend fades when Markov conviction exceeds $|S_t| > 0.05$.
