# Institutional Research & Empirical Findings Archive

This directory contains the complete institutional research, walk-forward performance audits, mathematical calibrations, and statistical trading schedules developed for Bitcoin perpetual futures (**BTCUSDT**) and Spot Gold (**XAU/USD**).

All original data, statistical matrices, backtests, formulas, and visual heatmaps are fully consolidated into the 7 master reports below (< 10 files).

---

## 📑 Master Research Reports Directory

| Report | Master Document Title | Contents & Scope |
| :---: | :--- | :--- |
| **01** | [Executive Summary & Macro Synthesis](file:///Users/dhruv/Downloads/Noise-filter/research_reports/01_EXECUTIVE_SUMMARY.md) | High-level synthesis of all findings, the champion strategy verdict, cross-asset comparisons, and core institutional takeaways. |
| **02** | [Markov 2.0 Theory & Threshold Calibration](file:///Users/dhruv/Downloads/Noise-filter/research_reports/02_MARKOV_2_0_AND_THRESHOLD_CALIBRATION.md) | Mathematical core of Markov 2.0, 3 flaws fixed, SPY 10-year proof, and empirical volatility scaling ($1.05\sigma_{20}$) across all timeframes. |
| **03** | [BTC Strategy Walk-Forward & Optimization](file:///Users/dhruv/Downloads/Noise-filter/research_reports/03_BTC_STRATEGY_WALKFORWARD_AND_OPTIMIZATION.md) | 1-year walk-forward audit (Radar Trap vs SMC vs 15M EMA) and complete Radar Trap 2.0 parametric ablation lifting Profit Factor to 1.41. |
| **04** | [BTC 3-Year IST Schedule & Annual Audits](file:///Users/dhruv/Downloads/Noise-filter/research_reports/04_BTC_3_YEAR_IST_SCHEDULE_AND_ANNUAL_AUDITS.md) | 315,360 5M candles mapped across 168 weekly IST cells: 3-year aggregate, full 2024, full 2025, 2026 YTD, and cross-temporal stability analysis. |
| **05** | [Trader Execution Playbook & Checklist](file:///Users/dhruv/Downloads/Noise-filter/research_reports/05_TRADER_EXECUTION_PLAYBOOK.md) | Daily operational gatekeeper, IST clearance checks, 1H extreme mapping, 5M trigger execution, SL/TP rules, and weekly blueprint. |
| **06** | [XAU/USD Gold Executive & Markov Calibration](file:///Users/dhruv/Downloads/Noise-filter/research_reports/06_XAU_GOLD_EXECUTIVE_AND_MARKOV_CALIBRATION.md) | 3-year Gold analysis across 212k 5M bars, volatility calibration ($1.05\sigma_{20} = \pm 0.358\%$), transition matrix, and 86.6% drawdown reduction shield. |
| **07** | [XAU/USD Gold Strategy Audit & 7×24 IST Schedule](file:///Users/dhruv/Downloads/Noise-filter/research_reports/07_XAU_GOLD_STRATEGY_AUDIT_AND_IST_SCHEDULE.md) | Walk-forward comparison (Radar Trap vs SMC vs EMA), 24-hr IST hourly table, Monday capital burner discovery, and session strike windows. |

---

## 🔬 Core Empirical Takeaways (Cross-Asset Synthesis)

### 1. BTC/USDT Perpetuals
- **Strategy Verdict**: **Radar Trap 2.0** is the champion model ($PF = 1.41$, Max DD $-5.2\%$). Moving-average breakouts and retail SMC fail due to stop hunts.
- **Timing in IST**: **Wednesday** is king ($PF = 1.50$, $+0.27R$ expectancy). **Monday** is a trap ($PF = 0.98$). Strike windows: **12:00–14:00 IST** (London Ignition) and **19:00–23:30 IST** (US Cash Open).
- **Markov Shield**: Cuts drawdown by $27\%\text{--}43\%$ when used as a directional trend filter.

### 2. XAU/USD (Spot Gold)
- **Strategy Verdict**: Gold has **95.5% sideways stickiness** on intraday bars. EMA breakout strategies suffer catastrophic decay ($-27.4\%$ DD). **Radar Trap 2.0** with IST filtering achieves a **1.35 Profit Factor** with only **$-4.1\%$ drawdown**.
- **Timing in IST**: **Thursday** is the champion trading day ($PF = 1.17$, $+0.10R$). **Monday is a capital destroyer** ($PF = 0.62$, $26\%$ win rate across 104 trades — strictly blacklisted).
- **Strike Windows**: **19:00–20:00 IST** (Peak Momentum Spike, $21.8\%$ momentum density) and **00:00–01:00 AM IST** (Late NY Post-Fix Fade, $60.0\%$ win rate, $PF = 3.18$).
- **Markov Shield**: Cuts buy-and-hold drawdown from $-28.8\%$ down to **$-3.9\%$** (an **86.6% risk reduction**).
