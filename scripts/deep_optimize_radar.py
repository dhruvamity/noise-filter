#!/usr/bin/env python3
"""
Deep Systematic Exploration & Optimization of Strategy 1: Radar Trap
Explores:
1. Lookback periods (48h, 72h, 96h, 120h)
2. Target R:R (1.5R, 1.75R, 2.0R, 2.25R, 2.5R, 3.0R)
3. Time/Session Filters (Asian session 00:00-07:00 UTC vs Western 07:00-24:00 UTC vs Full 24/7)
4. Markov Regime Thresholds (0.02, 0.04, 0.06, 0.08)
5. Trailing stop / Breakeven mechanics
"""

import numpy as np
import pandas as pd
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
RESEARCH_DIR = ROOT / "research"

def load_data():
    df_5m = pd.read_parquet(RAW_DIR / "5m" / "klines.parquet")
    df_1h = pd.read_parquet(RAW_DIR / "1h" / "klines.parquet")
    
    for df in [df_5m, df_1h]:
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
        df['datetime'] = pd.to_datetime(df['open_time'], unit='ms')
    return df_5m, df_1h

def get_markov_signals(df_candle: pd.DataFrame, window=20, thresh=0.02):
    close = df_candle['close'].values
    n = len(close)
    returns = pd.Series(close).pct_change(window).values
    states = np.full(n, np.nan)
    states[returns >= thresh] = 2
    states[returns <= -thresh] = 0
    states[(returns > -thresh) & (returns < thresh)] = 1
    
    signals = np.zeros(n)
    counts_str = np.zeros((3, 3), dtype=float)
    min_bars = max(window * 3, 100)
    for i in range(0, min_bars - window, window):
        s1, s2 = states[i], states[i + window]
        if not (np.isnan(s1) or np.isnan(s2)):
            counts_str[int(s1), int(s2)] += 1
    for t in range(min_bars, n):
        if (t % window) == 0 and t >= window:
            s1, s2 = states[t - window], states[t]
            if not (np.isnan(s1) or np.isnan(s2)):
                counts_str[int(s1), int(s2)] += 1
        curr = states[t]
        if not np.isnan(curr):
            curr = int(curr)
            row_sum = counts_str[curr].sum()
            if row_sum > 0:
                signals[t] = (counts_str[curr, 2] - counts_str[curr, 0]) / row_sum
    return signals

def backtest_radar(
    df_5m: pd.DataFrame,
    df_1h: pd.DataFrame,
    sig_1h: np.ndarray,
    lookback_1h: int = 72,
    target_r: float = 2.0,
    session_filter: str = "all", # 'all', 'western' (07:00-24:00 UTC), 'asia' (00:00-07:00 UTC)
    markov_veto_thresh: float = 0.05,
    enable_markov: bool = True
):
    df_1h_c = df_1h.copy()
    df_1h_c['range_high'] = df_1h_c['high'].rolling(lookback_1h).max().shift(1)
    df_1h_c['range_low'] = df_1h_c['low'].rolling(lookback_1h).min().shift(1)
    df_1h_c['range_span'] = df_1h_c['range_high'] - df_1h_c['range_low']
    df_1h_c['zone_high_bound'] = df_1h_c['range_high'] - 0.20 * df_1h_c['range_span']
    df_1h_c['zone_low_bound'] = df_1h_c['range_low'] + 0.20 * df_1h_c['range_span']
    df_1h_c['sig_1h'] = sig_1h
    
    df_5m_c = df_5m.copy()
    df_5m_c['hour_utc'] = df_5m_c['datetime'].dt.hour
    df_5m_c['h1_open_time'] = (df_5m_c['open_time'] // 3_600_000) * 3_600_000
    
    cols = ['open_time', 'range_high', 'range_low', 'zone_high_bound', 'zone_low_bound', 'sig_1h']
    df = pd.merge(df_5m_c, df_1h_c[cols], left_on='h1_open_time', right_on='open_time', suffixes=('', '_1h'))
    
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    hours = df['hour_utc'].values
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    dts = df['datetime'].values
    n = len(df)
    
    trades = []
    in_pos = False
    pos_type = 0
    entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
    last_exit = -100
    
    for i in range(1200, n - 1):
        if in_pos:
            c_h = highs[i]
            c_l = lows[i]
            c_c = closes[i]
            
            if pos_type == 1: # Long
                if c_l <= sl_px:
                    ret = (sl_px / entry_px) - 1.0
                    trades.append({'pnl_r': -1.0, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx, 'time': dts[i]})
                    in_pos = False; last_exit = i; continue
                if c_h >= tp_px:
                    ret = (tp_px / entry_px) - 1.0
                    trades.append({'pnl_r': target_r, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx, 'time': dts[i]})
                    in_pos = False; last_exit = i; continue
            elif pos_type == -1: # Short
                if c_h >= sl_px:
                    ret = 1.0 - (sl_px / entry_px)
                    trades.append({'pnl_r': -1.0, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx, 'time': dts[i]})
                    in_pos = False; last_exit = i; continue
                if c_l <= tp_px:
                    ret = 1.0 - (tp_px / entry_px)
                    trades.append({'pnl_r': target_r, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx, 'time': dts[i]})
                    in_pos = False; last_exit = i; continue
                    
            if i - entry_idx >= 48: # 4 hour time stop
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type==1 else 'SHORT', 'bars': i - entry_idx, 'time': dts[i]})
                in_pos = False; last_exit = i; continue
            continue
            
        if i - last_exit < 6: continue
        
        # Session filter check
        hr = hours[i]
        if session_filter == "western" and (hr < 7): # Skip 00:00 to 07:00 UTC (Asia graveyard chop)
            continue
        elif session_filter == "asia" and (hr >= 7):
            continue
            
        rh, rl = r_highs[i], r_lows[i]
        zh, zl = z_highs[i], z_lows[i]
        s = sigs[i]
        c_o, c_h, c_l, c_c = opens[i], highs[i], lows[i], closes[i]
        
        if np.isnan(rh) or np.isnan(rl) or rh == rl: continue
        
        # SHORT SETUP
        if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
            if enable_markov and s > markov_veto_thresh:
                continue
            stop = c_h * 1.0005
            target = max(rl, c_c - target_r * (stop - c_c))
            risk = stop - c_c
            if risk > 0 and ((c_c - target) / risk) >= 1.2:
                in_pos = True
                pos_type = -1
                entry_px = c_c
                sl_px = stop
                tp_px = target
                entry_idx = i
                continue
                
        # LONG SETUP
        if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
            if enable_markov and s < -markov_veto_thresh:
                continue
            stop = c_l * 0.9995
            target = min(rh, c_c + target_r * (c_c - stop))
            risk = c_c - stop
            if risk > 0 and ((target - c_c) / risk) >= 1.2:
                in_pos = True
                pos_type = 1
                entry_px = c_c
                sl_px = stop
                tp_px = target
                entry_idx = i
                continue
                
    tdf = pd.DataFrame(trades)
    if len(tdf) == 0:
        return {"trades": 0, "win_rate": 0, "pf": 0, "total_return": 0, "max_dd": 0, "exp_r": 0, "tdf": tdf}
        
    wins = tdf[tdf['pnl_r'] > 0]
    losses = tdf[tdf['pnl_r'] < 0]
    wr = len(wins) / len(tdf)
    gains = wins['pnl_r'].sum()
    loss_sum = np.abs(losses['pnl_r'].sum())
    pf = gains / loss_sum if loss_sum > 0 else 99.0
    cum = np.cumprod(1 + tdf['ret'].values)
    peaks = np.maximum.accumulate(cum)
    dds = (cum - peaks) / peaks
    max_dd = np.min(dds) if len(dds) > 0 else 0
    
    return {
        "trades": len(tdf),
        "win_rate": round(wr * 100, 1),
        "pf": round(pf, 2),
        "total_return": round((cum[-1] - 1.0) * 100, 1),
        "max_dd": round(max_dd * 100, 1),
        "exp_r": round(float(tdf['pnl_r'].mean()), 2),
        "tdf": tdf
    }

def main():
    df_5m, df_1h = load_data()
    sig_1h = get_markov_signals(df_1h, window=20, thresh=0.02)
    
    print("================================================================================")
    print("PARAMETRIC STUDY: RADAR TRAP (1-YEAR BTCUSDT PERPETUAL)")
    print("================================================================================")
    
    # 1. Target R:R Study (with 100h and Markov)
    print("\n--- 1. Target R:R Sensitivity (Lookback=100h, Markov Gated) ---")
    for tr in [1.5, 1.75, 2.0, 2.25, 2.5, 3.0]:
        res = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=100, target_r=tr)
        print(f"Target {tr:.2f}R | Trades: {res['trades']:<4} | WinRate: {res['win_rate']:<4}% | PF: {res['pf']:<4} | Ret: {res['total_return']:<5}% | MaxDD: {res['max_dd']:<5}% | Exp: {res['exp_r']}R")
        
    # 2. Lookback Sensitivity (with 2.0R target)
    print("\n--- 2. Lookback Window Sensitivity (Target=2.0R, Markov Gated) ---")
    for lb in [48, 72, 96, 100, 120, 144]:
        res = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=lb, target_r=2.0)
        print(f"Lookback {lb:<3}h | Trades: {res['trades']:<4} | WinRate: {res['win_rate']:<4}% | PF: {res['pf']:<4} | Ret: {res['total_return']:<5}% | MaxDD: {res['max_dd']:<5}% | Exp: {res['exp_r']}R")
        
    # 3. Session Filtering (Lookback=72h, Target=2.0R)
    print("\n--- 3. Session Filtering Breakdown (Lookback=72h, Target=2.0R, Markov Gated) ---")
    for sess in ["all", "western", "asia"]:
        res = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=72, target_r=2.0, session_filter=sess)
        print(f"Session {sess:<8} | Trades: {res['trades']:<4} | WinRate: {res['win_rate']:<4}% | PF: {res['pf']:<4} | Ret: {res['total_return']:<5}% | MaxDD: {res['max_dd']:<5}% | Exp: {res['exp_r']}R")

    # 4. Markov Gating Impact across configurations
    print("\n--- 4. Gated vs Ungated Comparison on Optimized Radar Trap 2.0 (72h, 2.0R, Western) ---")
    res_ungated = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=72, target_r=2.0, session_filter="western", enable_markov=False)
    res_gated = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=72, target_r=2.0, session_filter="western", enable_markov=True)
    print(f"Radar 2.0 (Ungated) | Trades: {res_ungated['trades']:<4} | WinRate: {res_ungated['win_rate']:<4}% | PF: {res_ungated['pf']:<4} | Ret: {res_ungated['total_return']:<5}% | MaxDD: {res_ungated['max_dd']:<5}% | Exp: {res_ungated['exp_r']}R")
    print(f"Radar 2.0 (Markov)  | Trades: {res_gated['trades']:<4} | WinRate: {res_gated['win_rate']:<4}% | PF: {res_gated['pf']:<4} | Ret: {res_gated['total_return']:<5}% | MaxDD: {res_gated['max_dd']:<5}% | Exp: {res_gated['exp_r']}R")

    # Generate comparative equity curve for Radar 1.0 vs Radar 2.0
    res_baseline = backtest_radar(df_5m, df_1h, sig_1h, lookback_1h=100, target_r=2.5, session_filter="all", enable_markov=True)
    
    tdf_base = res_baseline['tdf']
    tdf_opt = res_gated['tdf']
    
    fig, ax = plt.subplots(figsize=(12, 6), dpi=150)
    
    if len(tdf_base) > 0:
        cum_base = (1 + tdf_base['ret']).cumprod()
        ax.plot(cum_base.values, label=f"Baseline Radar 1.0 (100h, 2.5R, All Sess) - PF {res_baseline['pf']}, Ret {res_baseline['total_return']}%, DD {res_baseline['max_dd']}%", color='#f59e0b', linewidth=1.8)
        
    if len(tdf_opt) > 0:
        cum_opt = (1 + tdf_opt['ret']).cumprod()
        ax.plot(cum_opt.values, label=f"Upgraded Radar 2.0 (72h, 2.0R, Western) - PF {res_gated['pf']}, Ret {res_gated['total_return']}%, DD {res_gated['max_dd']}%", color='#10b981', linewidth=2.2)
        
    ax.set_title("Radar Trap Evolution: Baseline 1.0 vs Optimized 2.0 (1-Year BTCUSDT)", fontsize=14, fontweight='bold', color='white')
    ax.set_facecolor('#0f172a')
    fig.patch.set_facecolor('#0b0f19')
    ax.grid(True, alpha=0.15, color='#475569')
    ax.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='white')
    ax.tick_params(colors='white')
    for spine in ax.spines.values():
        spine.set_color('#334155')
        
    plt.tight_layout()
    chart_path = RESEARCH_DIR / "radar_evolution_comparison.png"
    plt.savefig(chart_path)
    print(f"\nSaved comparison chart to {chart_path}")

if __name__ == "__main__":
    main()
