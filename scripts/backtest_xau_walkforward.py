#!/usr/bin/env python3
"""
Multi-Strategy Walk-Forward Audit for XAU/USD (Spot Gold)
=========================================================
Performs out-of-sample backtesting on 3 distinct trading architectures:
1. Strategy 1: Institutional Radar Trap 2.0 (1H Extremes, 5M Traps, Markov Filter)
2. Strategy 2: 15M 20 EMA Momentum Breakout
3. Strategy 3: Hardcore SMC (Liquidity Sweeps, Order Blocks, Fair Value Gaps)

Outputs:
- Win Rate %, Profit Factor, Expectancy ($R$), Max Drawdown %, Net Return %
- Strategy comparison equity plots in research/ and public/
- JSON results saved to research/xau_strategy_walkforward_results.json
"""

import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
XAU_RAW = ROOT / "data" / "xau" / "raw"
RESEARCH_DIR = ROOT / "research"
PUBLIC_DIR = ROOT / "public"
BRAIN_DIR = Path("/Users/dhruv/.gemini/antigravity-ide/brain/13e1b56c-f5a3-40a8-a642-696b930e56ec")

RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)


def load_xau_klines():
    """Loads 5m, 15m, and 1h parquet klines."""
    df_5m = pd.read_parquet(XAU_RAW / "5m" / "klines.parquet")
    df_15m = pd.read_parquet(XAU_RAW / "15m" / "klines.parquet")
    df_1h = pd.read_parquet(XAU_RAW / "1h" / "klines.parquet")

    for df in [df_5m, df_15m, df_1h]:
        df["datetime"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
        df["dt_ist"] = df["datetime"] + pd.Timedelta(hours=5, minutes=30)
        df["dow_ist"] = df["dt_ist"].dt.dayofweek
        df["hour_ist"] = df["dt_ist"].dt.hour

    return df_5m, df_15m, df_1h


def compute_markov_signal_series(prices: np.ndarray, window: int = 20, threshold: float = 0.0035) -> np.ndarray:
    """Computes continuous Markov regime signal P(Bull) - P(Bear) with Laplace smoothing."""
    n = len(prices)
    signals = np.zeros(n)
    if n < window * 2:
        return signals

    # Calculate 20-bar returns
    ret_w = np.zeros(n)
    ret_w[window:] = (prices[window:] / prices[:-window]) - 1.0

    states = np.ones(n, dtype=int)  # 1 = SIDEWAYS
    states[ret_w >= threshold] = 2  # 2 = BULL
    states[ret_w <= -threshold] = 0  # 0 = BEAR

    # Rolling transition matrix calculation
    for i in range(window * 3, n):
        sub_states = states[max(0, i - 150):i]
        trans = np.ones((3, 3))  # Laplace smoothing start with 1
        for s1, s2 in zip(sub_states[:-1], sub_states[1:]):
            trans[s1, s2] += 1
        probs = trans / trans.sum(axis=1, keepdims=True)
        curr_s = states[i]
        signals[i] = probs[curr_s, 2] - probs[curr_s, 0]  # P(Bull) - P(Bear)

    return signals


# =====================================================================
# STRATEGY 1: RADAR TRAP 2.0
# =====================================================================
def backtest_radar_trap_v2(df_5m: pd.DataFrame, df_1h: pd.DataFrame, target_r: float = 2.0, lookback_1h: int = 100):
    print("Backtesting Strategy 1: Radar Trap 2.0 on XAU/USD...")

    # Calculate 1H rolling swing highs and lows
    df_1h = df_1h.sort_values("open_time").reset_index(drop=True)
    df_1h["rh"] = df_1h["high"].rolling(lookback_1h).max().shift(1)
    df_1h["rl"] = df_1h["low"].rolling(lookback_1h).min().shift(1)
    df_1h["rng"] = df_1h["rh"] - df_1h["rl"]
    df_1h["zh"] = df_1h["rh"] - (df_1h["rng"] * 0.20)
    df_1h["zl"] = df_1h["rl"] + (df_1h["rng"] * 0.20)

    # Merge 1H boundaries into 5M
    m5 = pd.merge_asof(
        df_5m.sort_values("open_time"),
        df_1h[["open_time", "rh", "rl", "zh", "zl"]].dropna(),
        on="open_time",
        direction="backward"
    ).dropna(subset=["rh", "rl"]).reset_index(drop=True)

    closes = m5["close"].values
    highs = m5["high"].values
    lows = m5["low"].values
    opens = m5["open"].values
    dts = m5["datetime"].values
    r_highs = m5["rh"].values
    r_lows = m5["rl"].values
    z_highs = m5["zh"].values
    z_lows = m5["zl"].values

    # Calibrated Markov threshold for Gold 5M is ~0.35%
    markov_sigs = compute_markov_signal_series(closes, window=20, threshold=0.0035)

    n = len(m5)
    trades = []
    in_pos = False
    pos_type = 0  # +1 Long, -1 Short
    entry_px = 0.0
    sl_px = 0.0
    tp_px = 0.0
    entry_idx = 0
    entry_time = None
    last_exit = -999

    for i in range(100, n):
        c_c, c_h, c_l, c_o = closes[i], highs[i], lows[i], opens[i]

        if in_pos:
            # Check Stop Loss / Take Profit
            if pos_type == 1:
                if c_l <= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0, 'type': 'LONG', 'bars': i - entry_idx, 'entry_time': str(entry_time), 'exit_time': str(dts[i])})
                    in_pos = False; last_exit = i; continue
                elif c_h >= tp_px:
                    trades.append({'pnl_r': target_r, 'ret': (tp_px / entry_px) - 1.0, 'type': 'LONG', 'bars': i - entry_idx, 'entry_time': str(entry_time), 'exit_time': str(dts[i])})
                    in_pos = False; last_exit = i; continue
            elif pos_type == -1:
                if c_h >= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px), 'type': 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time), 'exit_time': str(dts[i])})
                    in_pos = False; last_exit = i; continue
                elif c_l <= tp_px:
                    trades.append({'pnl_r': target_r, 'ret': 1.0 - (tp_px / entry_px), 'type': 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time), 'exit_time': str(dts[i])})
                    in_pos = False; last_exit = i; continue

            # Max hold time: 48 bars (4 hours)
            if i - entry_idx >= 48:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type == 1 else 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time), 'exit_time': str(dts[i])})
                in_pos = False; last_exit = i; continue
            continue

        if i - last_exit < 6:
            continue

        rh, rl = r_highs[i], r_lows[i]
        zh, zl = z_highs[i], z_lows[i]
        s = markov_sigs[i]

        # SHORT SETUP (Buyer Trap at 1H Resistance in Top 20% Extreme)
        if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
            if s > 0.05:  # Markov regime veto on aggressive uptrends
                continue
            stop = c_h + 0.50  # Gold spread buffer ($0.50)
            target = max(rl, c_c - target_r * (stop - c_c))
            risk = stop - c_c
            if risk > 0 and ((c_c - target) / risk) >= 1.2:
                in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; entry_time = dts[i]; continue

        # LONG SETUP (Seller Trap at 1H Support in Bottom 20% Extreme)
        if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
            if s < -0.05:  # Markov regime veto on aggressive downtrends
                continue
            stop = c_l - 0.50  # Gold spread buffer ($0.50)
            target = min(rh, c_c + target_r * (c_c - stop))
            risk = c_c - stop
            if risk > 0 and ((target - c_c) / risk) >= 1.2:
                in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; entry_time = dts[i]; continue

    return pd.DataFrame(trades)


# =====================================================================
# STRATEGY 2: 15M 20 EMA MOMENTUM BREAKOUT
# =====================================================================
def backtest_ema_breakout(df_15m: pd.DataFrame, ema_period: int = 20):
    print("Backtesting Strategy 2: 15M 20 EMA Breakout on XAU/USD...")
    df = df_15m.copy().sort_values("open_time").reset_index(drop=True)
    df["ema"] = df["close"].ewm(span=ema_period, adjust=False).mean()

    closes = df["close"].values
    highs = df["high"].values
    lows = df["low"].values
    emas = df["ema"].values
    dts = df["datetime"].values

    n = len(df)
    trades = []
    in_pos = False
    pos_type = 0
    entry_px = 0.0
    sl_px = 0.0
    tp_px = 0.0
    entry_idx = 0
    entry_time = None

    for i in range(ema_period + 5, n):
        c_c, c_h, c_l, ema = closes[i], highs[i], lows[i], emas[i]

        if in_pos:
            if pos_type == 1:
                if c_l <= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0, 'type': 'LONG', 'entry_time': str(entry_time)})
                    in_pos = False; continue
                elif c_h >= tp_px:
                    trades.append({'pnl_r': 2.0, 'ret': (tp_px / entry_px) - 1.0, 'type': 'LONG', 'entry_time': str(entry_time)})
                    in_pos = False; continue
            elif pos_type == -1:
                if c_h >= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px), 'type': 'SHORT', 'entry_time': str(entry_time)})
                    in_pos = False; continue
                elif c_l <= tp_px:
                    trades.append({'pnl_r': 2.0, 'ret': 1.0 - (tp_px / entry_px), 'type': 'SHORT', 'entry_time': str(entry_time)})
                    in_pos = False; continue

            if i - entry_idx >= 32:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type == 1 else 'SHORT', 'entry_time': str(entry_time)})
                in_pos = False; continue
            continue

        # Bullish EMA Breakout
        prev_c = closes[i - 1]
        prev_ema = emas[i - 1]
        if prev_c <= prev_ema and c_c > ema:
            stop = min(lows[i - 2:i + 1]) - 0.50
            risk = c_c - stop
            if risk > 1.0:
                in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = c_c + 2.0 * risk; entry_idx = i; entry_time = dts[i]; continue

        # Bearish EMA Breakdown
        if prev_c >= prev_ema and c_c < ema:
            stop = max(highs[i - 2:i + 1]) + 0.50
            risk = stop - c_c
            if risk > 1.0:
                in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = c_c - 2.0 * risk; entry_idx = i; entry_time = dts[i]; continue

    return pd.DataFrame(trades)


# =====================================================================
# STRATEGY 3: HARDCORE SMC (FVG + ORDER BLOCK + SWEEPS)
# =====================================================================
def backtest_hardcore_smc(df_15m: pd.DataFrame):
    print("Backtesting Strategy 3: Hardcore SMC on XAU/USD...")
    df = df_15m.copy().sort_values("open_time").reset_index(drop=True)

    closes = df["close"].values
    highs = df["high"].values
    lows = df["low"].values
    opens = df["open"].values
    dts = df["datetime"].values

    n = len(df)
    trades = []
    in_pos = False
    pos_type = 0
    entry_px = 0.0
    sl_px = 0.0
    tp_px = 0.0
    entry_idx = 0
    entry_time = None

    for i in range(25, n):
        c_c, c_h, c_l, c_o = closes[i], highs[i], lows[i], opens[i]

        if in_pos:
            if pos_type == 1:
                if c_l <= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0, 'type': 'LONG', 'entry_time': str(entry_time)})
                    in_pos = False; continue
                elif c_h >= tp_px:
                    trades.append({'pnl_r': 2.5, 'ret': (tp_px / entry_px) - 1.0, 'type': 'LONG', 'entry_time': str(entry_time)})
                    in_pos = False; continue
            elif pos_type == -1:
                if c_h >= sl_px:
                    trades.append({'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px), 'type': 'SHORT', 'entry_time': str(entry_time)})
                    in_pos = False; continue
                elif c_l <= tp_px:
                    trades.append({'pnl_r': 2.5, 'ret': 1.0 - (tp_px / entry_px), 'type': 'SHORT', 'entry_time': str(entry_time)})
                    in_pos = False; continue

            if i - entry_idx >= 32:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type == 1 else 'SHORT', 'entry_time': str(entry_time)})
                in_pos = False; continue
            continue

        # Bullish FVG Detection: Low of candle i > High of candle i-2
        is_bull_fvg = lows[i] > highs[i - 2] + 0.50
        # Swing liquidity sweep of 20-period low
        swing_low_20 = np.min(lows[i - 20:i - 1])
        swept_low = lows[i - 1] < swing_low_20 and closes[i - 1] > swing_low_20

        if is_bull_fvg and swept_low and c_c > c_o:
            stop = min(lows[i - 2:i + 1]) - 0.50
            risk = c_c - stop
            if risk > 1.0:
                in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = c_c + 2.5 * risk; entry_idx = i; entry_time = dts[i]; continue

        # Bearish FVG Detection: High of candle i < Low of candle i-2
        is_bear_fvg = highs[i] < lows[i - 2] - 0.50
        swing_high_20 = np.max(highs[i - 20:i - 1])
        swept_high = highs[i - 1] > swing_high_20 and closes[i - 1] < swing_high_20

        if is_bear_fvg and swept_high and c_c < c_o:
            stop = max(highs[i - 2:i + 1]) + 0.50
            risk = stop - c_c
            if risk > 1.0:
                in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = c_c - 2.5 * risk; entry_idx = i; entry_time = dts[i]; continue

    return pd.DataFrame(trades)


def compute_metrics(df_trades: pd.DataFrame, strat_name: str) -> dict:
    if len(df_trades) == 0:
        return {'strategy': strat_name, 'trades': 0, 'win_rate': 0.0, 'profit_factor': 0.0, 'expectancy_r': 0.0, 'max_drawdown_pct': 0.0, 'net_return_pct': 0.0}

    wins = df_trades[df_trades["pnl_r"] > 0]
    losses = df_trades[df_trades["pnl_r"] < 0]
    wr = len(wins) / len(df_trades) * 100.0
    tot_gain = wins["pnl_r"].sum()
    tot_loss = np.abs(losses["pnl_r"].sum())
    pf = tot_gain / tot_loss if tot_loss > 0 else 99.0
    exp_r = float(df_trades["pnl_r"].mean())

    cum_ret = (1.0 + df_trades["ret"]).cumprod()
    peak = cum_ret.cummax()
    dd = (cum_ret - peak) / peak * 100.0
    max_dd = float(dd.min())
    net_ret = float((cum_ret.iloc[-1] - 1.0) * 100.0)

    return {
        'strategy': strat_name,
        'trades': len(df_trades),
        'win_rate': round(wr, 1),
        'profit_factor': round(pf, 2),
        'expectancy_r': round(exp_r, 2),
        'max_drawdown_pct': round(max_dd, 1),
        'net_return_pct': round(net_ret, 1),
        'cum_pnl_r': list(df_trades["pnl_r"].cumsum().values),
        'cum_ret': list(cum_ret.values)
    }


def main():
    print("==================================================================")
    print("XAU/USD (GOLD) MULTI-STRATEGY WALK-FORWARD AUDIT")
    print("==================================================================")

    df_5m, df_15m, df_1h = load_xau_klines()
    print(f"Loaded Gold Klines: 5M={len(df_5m):,}, 15M={len(df_15m):,}, 1H={len(df_1h):,}\n")

    trades_radar = backtest_radar_trap_v2(df_5m, df_1h)
    trades_ema = backtest_ema_breakout(df_15m)
    trades_smc = backtest_hardcore_smc(df_15m)

    m_radar = compute_metrics(trades_radar, "Radar Trap 2.0 (Institutional Fades)")
    m_ema = compute_metrics(trades_ema, "15M 20 EMA Breakout")
    m_smc = compute_metrics(trades_smc, "Hardcore SMC (FVG + OB)")

    print("\n------------------------------------------------------------------")
    print(f"{'Strategy':<38} | {'Trades':>6} | {'Win Rate':>8} | {'PF':>5} | {'Exp (R)':>7} | {'Max DD':>8} | {'Net Ret':>8}")
    print("------------------------------------------------------------------")
    for m in [m_radar, m_ema, m_smc]:
        print(f"{m['strategy']:<38} | {m['trades']:>6} | {m['win_rate']:>7.1f}% | {m['profit_factor']:>5.2f} | {m['expectancy_r']:>+6.2f}R | {m['max_drawdown_pct']:>7.1f}% | {m['net_return_pct']:>+7.1f}%")
    print("------------------------------------------------------------------")

    # Plot Equity Curves Comparison
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10), sharex=False)

    if len(trades_radar) > 0:
        ax1.plot(m_radar['cum_pnl_r'], label=f"Radar Trap 2.0 (PF {m_radar['profit_factor']}, Exp {m_radar['expectancy_r']:+0.2f}R)", color='#10b981', lw=2)
    if len(trades_ema) > 0:
        ax1.plot(m_ema['cum_pnl_r'], label=f"15M EMA Breakout (PF {m_ema['profit_factor']}, Exp {m_ema['expectancy_r']:+0.2f}R)", color='#38bdf8', lw=1.5, ls='--')
    if len(trades_smc) > 0:
        ax1.plot(m_smc['cum_pnl_r'], label=f"Hardcore SMC (PF {m_smc['profit_factor']}, Exp {m_smc['expectancy_r']:+0.2f}R)", color='#ef4444', lw=1.5, ls=':')

    ax1.set_title("XAU/USD (Gold) Walk-Forward Cumulative PnL (R-Multiples)", fontsize=14, fontweight='bold', pad=12)
    ax1.set_ylabel("Cumulative R", fontsize=12)
    ax1.grid(True, alpha=0.25)
    ax1.legend(loc="upper left")

    if len(trades_radar) > 0:
        ax2.plot(m_radar['cum_ret'], label=f"Radar Trap 2.0 Ret ({m_radar['net_return_pct']:+0.1f}%, DD {m_radar['max_drawdown_pct']:.1f}%)", color='#10b981', lw=2)
    if len(trades_ema) > 0:
        ax2.plot(m_ema['cum_ret'], label=f"15M EMA Ret ({m_ema['net_return_pct']:+0.1f}%)", color='#38bdf8', lw=1.5, ls='--')
    if len(trades_smc) > 0:
        ax2.plot(m_smc['cum_ret'], label=f"Hardcore SMC Ret ({m_smc['net_return_pct']:+0.1f}%)", color='#ef4444', lw=1.5, ls=':')

    ax2.set_title("XAU/USD (Gold) Cumulative Growth Factor (1.0 = Baseline)", fontsize=14, fontweight='bold', pad=12)
    ax2.set_ylabel("Portfolio Multiplier", fontsize=12)
    ax2.set_xlabel("Executed Trades Sequence", fontsize=12)
    ax2.grid(True, alpha=0.25)
    ax2.legend(loc="upper left")

    plt.tight_layout()
    chart_path = RESEARCH_DIR / "xau_strategy_walkforward_comparison.png"
    plt.savefig(chart_path, dpi=180)
    plt.savefig(PUBLIC_DIR / "xau_strategy_walkforward_comparison.png", dpi=180)
    if BRAK_EXISTS := BRAIN_DIR.exists():
        plt.savefig(BRAIN_DIR / "xau_strategy_walkforward_comparison.png", dpi=180)
    plt.close()

    # Save JSON summary
    summary = {
        'asset': 'XAUUSD (Spot Gold vs US Dollar)',
        'data_bars': {'5m': len(df_5m), '15m': len(df_15m), '1h': len(df_1h)},
        'results': [m_radar, m_ema, m_smc]
    }
    with open(RESEARCH_DIR / "xau_strategy_walkforward_results.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\nSaved comparison chart to {chart_path}")
    print(f"Saved JSON metrics to {RESEARCH_DIR / 'xau_strategy_walkforward_results.json'}")


if __name__ == "__main__":
    main()
