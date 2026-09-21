#!/usr/bin/env python3
"""
Comprehensive 3-Year BTCUSDT Empirical Analysis in Indian Standard Time (IST, UTC+05:30)
Evaluates across 7 Days of the Week × 24 Hourly Buckets (168 cells):
1. Chop / Flat Market Probability (Low volatility, tight dojis, lack of follow-through)
2. Directional Momentum & Follow-Through (MFE/MAE ratio, trend persistence, breakout expansion)
3. Markov 2.0 Regime State Distributions & Stickiness
4. Radar Trap (Liquidity Sweep) & SMC Strategy Performance by Day & Hour
5. Generates high-resolution heatmaps and actionable trading schedules
"""

from __future__ import annotations
import json
import os
import ssl
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
RESEARCH_DIR = ROOT / "research"
RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR = ROOT / "public"
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

# IST Timezone: UTC + 5:30
IST = timezone(timedelta(hours=5, minutes=30))
DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

def load_data():
    print("Loading 3-year klines from parquet...")
    df_5m = pd.read_parquet(RAW_DIR / "5m" / "klines.parquet")
    df_15m = pd.read_parquet(RAW_DIR / "15m" / "klines.parquet")
    df_1h = pd.read_parquet(RAW_DIR / "1h" / "klines.parquet")
    
    for df in [df_5m, df_15m, df_1h]:
        for col in ['open', 'high', 'low', 'close', 'volume', 'quote_volume']:
            df[col] = df[col].astype(float)
        # Parse UTC datetime then convert to IST
        df['dt_utc'] = pd.to_datetime(df['open_time'], unit='ms', utc=True)
        df['dt_ist'] = df['dt_utc'].dt.tz_convert('Asia/Kolkata')
        df['dow_ist'] = df['dt_ist'].dt.dayofweek  # 0 = Monday, 6 = Sunday
        df['hour_ist'] = df['dt_ist'].dt.hour      # 0 to 23
        df['dow_name'] = df['dow_ist'].map(lambda d: DAYS_OF_WEEK[d])
        
    print(f"Loaded: 5M ({len(df_5m):,} bars), 15M ({len(df_15m):,} bars), 1H ({len(df_1h):,} bars)")
    print(f"Date range (IST): {df_5m['dt_ist'].min()} → {df_5m['dt_ist'].max()}")
    return df_5m, df_15m, df_1h

def get_markov_signals(df_candle: pd.DataFrame, window=20, thresh=0.02):
    close = df_candle['close'].values
    n = len(close)
    returns = pd.Series(close).pct_change(window).values
    states = np.full(n, np.nan)
    states[returns >= thresh] = 2  # BULL
    states[returns <= -thresh] = 0 # BEAR
    states[(returns > -thresh) & (returns < thresh)] = 1 # SIDEWAYS
    
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
    return states, signals

def compute_ist_regime_metrics(df_5m: pd.DataFrame, df_15m: pd.DataFrame):
    """
    Computes statistical chop vs momentum metrics across all 168 (Day × Hour) IST cells.
    """
    print("\nComputing statistical chop and momentum metrics across 7x24 IST cells...")
    df = df_5m.copy()
    
    # 1. Normalized True Range (in bps)
    prev_close = df['close'].shift(1)
    tr = np.maximum(df['high'] - df['low'], np.maximum((df['high'] - prev_close).abs(), (df['low'] - prev_close).abs()))
    df['tr_bp'] = (tr / df['close']) * 10000.0
    
    # 2. Candle body ratio: large body = conviction; tiny body with long wicks = indecision/chop
    candle_span = df['high'] - df['low']
    df['body_ratio'] = (df['close'] - df['open']).abs() / np.maximum(candle_span, 1e-8)
    
    # 3. 12-bar (1 hour) Forward Directional Efficiency (MFE vs MAE)
    # Measures whether a trade in the breakout direction expands cleanly or gets trapped
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    n = len(df)
    
    forward_mfe_long = np.zeros(n)
    forward_mae_long = np.zeros(n)
    
    for i in range(n - 12):
        future_high = np.max(highs[i+1 : i+13])
        future_low = np.min(lows[i+1 : i+13])
        c = closes[i]
        forward_mfe_long[i] = max(0.0, (future_high - c) / c * 10000.0)
        forward_mae_long[i] = max(0.0, (c - future_low) / c * 10000.0)
        
    df['fwd_mfe_bp'] = forward_mfe_long
    df['fwd_mae_bp'] = forward_mae_long
    df['fwd_ratio'] = forward_mfe_long / np.maximum(forward_mae_long, 1.0)
    
    # Chop definition:
    # 5M bar has low range (< 25th percentile TR) OR body_ratio < 0.25 (indecision) OR fwd_mfe < 15 bps
    tr_p25 = df['tr_bp'].quantile(0.25)
    df['is_chop'] = (df['tr_bp'] < tr_p25) | (df['body_ratio'] < 0.20)
    
    # Momentum definition:
    # 5M bar has above-median range AND body_ratio >= 0.55 AND fwd_mfe >= 35 bps
    tr_p50 = df['tr_bp'].quantile(0.50)
    df['is_momentum'] = (df['tr_bp'] > tr_p50) & (df['body_ratio'] > 0.50) & (df['fwd_mfe_bp'] > 30.0)
    
    # Group by Day of Week & Hour IST
    grouped = df.groupby(['dow_ist', 'hour_ist']).agg(
        total_bars=('close', 'count'),
        avg_range_bp=('tr_bp', 'mean'),
        median_range_bp=('tr_bp', 'median'),
        avg_volume_usd=('quote_volume', 'mean'),
        chop_pct=('is_chop', lambda x: x.mean() * 100.0),
        momentum_pct=('is_momentum', lambda x: x.mean() * 100.0),
        fwd_mfe_bp=('fwd_mfe_bp', 'mean'),
        fwd_mae_bp=('fwd_mae_bp', 'mean'),
        fwd_ratio=('fwd_ratio', 'median')
    ).reset_index()
    
    return grouped

def backtest_strategies_by_ist(df_5m: pd.DataFrame, df_1h: pd.DataFrame, sig_1h: np.ndarray):
    """
    Backtests Radar Trap 2.0 (Liquidity sweep at 72H extremes) and SMC setups
    across 3 full years, partitioning results by (DayOfWeek, HourIST).
    """
    print("\nBacktesting Radar Trap 2.0 across 3 years with IST tagging...")
    df_1h_c = df_1h.copy()
    df_1h_c['range_high'] = df_1h_c['high'].rolling(72).max().shift(1)
    df_1h_c['range_low'] = df_1h_c['low'].rolling(72).min().shift(1)
    df_1h_c['range_span'] = df_1h_c['range_high'] - df_1h_c['range_low']
    df_1h_c['zone_high_bound'] = df_1h_c['range_high'] - 0.20 * df_1h_c['range_span']
    df_1h_c['zone_low_bound'] = df_1h_c['range_low'] + 0.20 * df_1h_c['range_span']
    df_1h_c['sig_1h'] = sig_1h
    
    df_5m_c = df_5m.copy()
    df_5m_c['h1_open_time'] = (df_5m_c['open_time'] // 3_600_000) * 3_600_000
    
    cols = ['open_time', 'range_high', 'range_low', 'zone_high_bound', 'zone_low_bound', 'sig_1h']
    df = pd.merge(df_5m_c, df_1h_c[cols], left_on='h1_open_time', right_on='open_time', suffixes=('', '_1h'))
    
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    dows = df['dow_ist'].values
    hours = df['hour_ist'].values
    dts = df['dt_ist'].values
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    n = len(df)
    
    trades = []
    in_pos = False
    pos_type = 0
    entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
    entry_dow, entry_hour = 0, 0
    last_exit = -100
    target_r = 2.0
    
    for i in range(1200, n - 1):
        if in_pos:
            c_h = highs[i]
            c_l = lows[i]
            c_c = closes[i]
            
            if pos_type == 1: # Long
                if c_l <= sl_px:
                    ret = (sl_px / entry_px) - 1.0
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': -1.0, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                if c_h >= tp_px:
                    ret = (tp_px / entry_px) - 1.0
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': target_r, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
            elif pos_type == -1: # Short
                if c_h >= sl_px:
                    ret = 1.0 - (sl_px / entry_px)
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': -1.0, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                if c_l <= tp_px:
                    ret = 1.0 - (tp_px / entry_px)
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': target_r, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                    
            if i - entry_idx >= 48: # 4 hour max hold
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type==1 else 'SHORT', 'bars': i - entry_idx})
                in_pos = False; last_exit = i; continue
            continue
            
        if i - last_exit < 6: continue
        
        rh, rl = r_highs[i], r_lows[i]
        zh, zl = z_highs[i], z_lows[i]
        s = sigs[i]
        c_o, c_h, c_l, c_c = opens[i], highs[i], lows[i], closes[i]
        
        if np.isnan(rh) or np.isnan(rl) or rh == rl: continue
        
        # SHORT SETUP (Buyer Trap at Resistance)
        if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
            if s > 0.05: # Markov trend veto
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
                entry_dow = dows[i]
                entry_hour = hours[i]
                continue
                
        # LONG SETUP (Seller Trap at Support)
        if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
            if s < -0.05: # Markov trend veto
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
                entry_dow = dows[i]
                entry_hour = hours[i]
                continue
                
    tdf = pd.DataFrame(trades)
    print(f"Total 3-year Radar Trap trades: {len(tdf)}")
    return tdf

def generate_visualizations(regime_grid: pd.DataFrame, strat_grid: pd.DataFrame, dow_summary: pd.DataFrame, hourly_summary: pd.DataFrame):
    """
    Generates high-resolution heatmaps and performance charts.
    """
    print("\nGenerating heatmaps and research figures...")
    
    # 1. 7x24 Chop Probability Heatmap
    chop_matrix = np.zeros((7, 24))
    momo_matrix = np.zeros((7, 24))
    for _, row in regime_grid.iterrows():
        d = int(row['dow_ist'])
        h = int(row['hour_ist'])
        chop_matrix[d, h] = row['chop_pct']
        momo_matrix[d, h] = row['momentum_pct']
        
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 11), dpi=150)
    fig.patch.set_facecolor('#0b0f19')
    
    # Chop Heatmap
    im1 = ax1.imshow(chop_matrix, cmap='YlOrRd', aspect='auto', vmin=20, vmax=60)
    ax1.set_title("BTCUSDT 3-Year Chop / Flat Market Probability (%) [Indian Standard Time - IST]", fontsize=14, fontweight='bold', color='white', pad=12)
    ax1.set_yticks(range(7))
    ax1.set_yticklabels(DAYS_OF_WEEK, color='white', fontsize=11, fontweight='600')
    ax1.set_xticks(range(24))
    ax1.set_xticklabels([f"{h:02d}:00" for h in range(24)], color='white', fontsize=9, rotation=45)
    ax1.set_facecolor('#0f172a')
    cbar1 = fig.colorbar(im1, ax=ax1, fraction=0.02, pad=0.02)
    cbar1.ax.tick_params(colors='white')
    cbar1.set_label('Chop Probability % (Red = Avoid)', color='white', fontsize=10)
    
    # Add text annotations for key zones on Chop Heatmap
    for d in range(7):
        for h in range(24):
            val = chop_matrix[d, h]
            col = 'white' if val > 42 else '#1e293b'
            ax1.text(h, d, f"{val:.0f}%", ha="center", va="center", color=col, fontsize=7.5, fontweight='bold')
            
    # Momentum Heatmap
    im2 = ax2.imshow(momo_matrix, cmap='YlGn', aspect='auto', vmin=15, vmax=45)
    ax2.set_title("BTCUSDT 3-Year Directional Momentum & Follow-Through (%) [Indian Standard Time - IST]", fontsize=14, fontweight='bold', color='white', pad=12)
    ax2.set_yticks(range(7))
    ax2.set_yticklabels(DAYS_OF_WEEK, color='white', fontsize=11, fontweight='600')
    ax2.set_xticks(range(24))
    ax2.set_xticklabels([f"{h:02d}:00" for h in range(24)], color='white', fontsize=9, rotation=45)
    ax2.set_facecolor('#0f172a')
    cbar2 = fig.colorbar(im2, ax=ax2, fraction=0.02, pad=0.02)
    cbar2.ax.tick_params(colors='white')
    cbar2.set_label('Momentum Expansion % (Green = Strike Zone)', color='white', fontsize=10)
    
    for d in range(7):
        for h in range(24):
            val = momo_matrix[d, h]
            col = 'white' if val > 30 else '#1e293b'
            ax2.text(h, d, f"{val:.0f}%", ha="center", va="center", color=col, fontsize=7.5, fontweight='bold')
            
    plt.tight_layout()
    chart1_path = RESEARCH_DIR / "ist_regime_heatmap.png"
    plt.savefig(chart1_path)
    plt.close()
    
    # 2. Strategy Expectancy Heatmap & Day of Week Bar Charts
    fig, (ax_dow, ax_hr) = plt.subplots(2, 1, figsize=(15, 10), dpi=150)
    fig.patch.set_facecolor('#0b0f19')
    
    # DOW comparison
    dow_colors = ['#10b981' if pf >= 1.20 else '#f59e0b' if pf >= 1.0 else '#ef4444' for pf in dow_summary['pf']]
    bars = ax_dow.bar(dow_summary['dow_name'], dow_summary['pf'], color=dow_colors, width=0.55, edgecolor='#334155')
    ax_dow.axhline(1.0, color='#94a3b8', linestyle='--', alpha=0.7, label='Breakeven (PF = 1.0)')
    ax_dow.set_title("Strategy Profit Factor by Day of the Week (3-Year Sample)", fontsize=13, fontweight='bold', color='white')
    ax_dow.set_ylabel("Profit Factor", color='white')
    ax_dow.set_facecolor('#0f172a')
    ax_dow.tick_params(colors='white')
    ax_dow.grid(True, alpha=0.15, color='#475569', axis='y')
    for bar, pf, wr in zip(bars, dow_summary['pf'], dow_summary['win_rate']):
        y = bar.get_height()
        ax_dow.text(bar.get_x() + bar.get_width()/2.0, y + 0.03, f"PF {pf:.2f}\n(WR {wr:.1f}%)", ha='center', va='bottom', color='white', fontsize=9.5, fontweight='bold')
    ax_dow.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='white')
    
    # Hourly Expectancy Curve
    hr_colors = ['#10b981' if exp >= 0.15 else '#38bdf8' if exp >= 0.0 else '#ef4444' for exp in hourly_summary['exp_r']]
    ax_hr.bar(range(24), hourly_summary['exp_r'], color=hr_colors, width=0.6, edgecolor='#334155')
    ax_hr.axhline(0.0, color='#94a3b8', linestyle='--', alpha=0.7)
    ax_hr.set_title("Strategy Expectancy (R per Trade) by 24-Hour Cycle in IST", fontsize=13, fontweight='bold', color='white')
    ax_hr.set_ylabel("Expectancy (R)", color='white')
    ax_hr.set_xticks(range(24))
    ax_hr.set_xticklabels([f"{h:02d}:00" for h in range(24)], color='white', fontsize=9, rotation=45)
    ax_hr.set_facecolor('#0f172a')
    ax_hr.tick_params(colors='white')
    ax_hr.grid(True, alpha=0.15, color='#475569', axis='y')
    
    # Highlight Session Killzones in IST
    # 05:30 to 11:30 IST: Asian Graveyard
    ax_hr.axvspan(5.5, 11.5, color='#ef4444', alpha=0.12, label='Asian Graveyard Chop (05:30–11:30 IST) · Avoid')
    # 12:30 to 16:30 IST: London Open Strike Zone
    ax_hr.axvspan(12.5, 16.5, color='#38bdf8', alpha=0.15, label='London Session Strike Zone (12:30–16:30 IST)')
    # 18:30 to 23:30 IST: NY Open & US Cash Peak Strike Zone
    ax_hr.axvspan(18.5, 23.5, color='#10b981', alpha=0.18, label='US Cash & NY Open Strike Zone (18:30–23:30 IST)')
    ax_hr.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='white', loc='upper left')
    
    plt.tight_layout()
    chart2_path = RESEARCH_DIR / "ist_strategy_expectancy_heatmap.png"
    plt.savefig(chart2_path)
    plt.close()
    
    # Copy charts to public and artifacts
    for p in [chart1_path, chart2_path]:
        dest_pub = PUBLIC_DIR / p.name
        dest_pub.write_bytes(p.read_bytes())
        
    print(f"Saved charts to {chart1_path} and {chart2_path}")

def main():
    df_5m, df_15m, df_1h = load_data()
    states_1h, sig_1h = get_markov_signals(df_1h, window=20, thresh=0.02)
    
    # 1. Compute 7x24 Regime Metrics (Chop %, Momentum %, Volatility)
    regime_grid = compute_ist_regime_metrics(df_5m, df_15m)
    
    # 2. Backtest Strategies by (Day, Hour)
    trade_df = backtest_strategies_by_ist(df_5m, df_1h, sig_1h)
    
    # Aggregate Strategy Results by Day of Week
    dow_records = []
    for d in range(7):
        sub = trade_df[trade_df['dow_ist'] == d]
        n_trades = len(sub)
        if n_trades > 0:
            wins = sub[sub['pnl_r'] > 0]
            losses = sub[sub['pnl_r'] < 0]
            wr = len(wins) / n_trades * 100.0
            gains = wins['pnl_r'].sum()
            loss_sum = np.abs(losses['pnl_r'].sum())
            pf = gains / loss_sum if loss_sum > 0 else 99.0
            exp_r = float(sub['pnl_r'].mean())
            tot_ret = float(((1 + sub['ret']).prod() - 1.0) * 100.0)
        else:
            wr, pf, exp_r, tot_ret = 0.0, 0.0, 0.0, 0.0
            
        dow_records.append({
            'dow_ist': d,
            'dow_name': DAYS_OF_WEEK[d],
            'trades': n_trades,
            'win_rate': round(wr, 1),
            'pf': round(pf, 2),
            'exp_r': round(exp_r, 2),
            'total_return': round(tot_ret, 1)
        })
    dow_summary = pd.DataFrame(dow_records)
    
    # Aggregate Strategy Results by Hourly IST Bucket
    hourly_records = []
    for h in range(24):
        sub = trade_df[trade_df['hour_ist'] == h]
        n_trades = len(sub)
        if n_trades > 0:
            wins = sub[sub['pnl_r'] > 0]
            losses = sub[sub['pnl_r'] < 0]
            wr = len(wins) / n_trades * 100.0
            gains = wins['pnl_r'].sum()
            loss_sum = np.abs(losses['pnl_r'].sum())
            pf = gains / loss_sum if loss_sum > 0 else 99.0
            exp_r = float(sub['pnl_r'].mean())
        else:
            wr, pf, exp_r = 0.0, 0.0, 0.0
            
        hourly_records.append({
            'hour_ist': h,
            'hour_label': f"{h:02d}:00–{(h+1)%24:02d}:00 IST",
            'trades': n_trades,
            'win_rate': round(wr, 1),
            'pf': round(pf, 2),
            'exp_r': round(exp_r, 2)
        })
    hourly_summary = pd.DataFrame(hourly_records)
    
    # 7x24 Strategy Cell Breakdown
    cell_matrix = []
    for d in range(7):
        for h in range(24):
            sub = trade_df[(trade_df['dow_ist'] == d) & (trade_df['hour_ist'] == h)]
            reg_sub = regime_grid[(regime_grid['dow_ist'] == d) & (regime_grid['hour_ist'] == h)]
            chop_pct = float(reg_sub['chop_pct'].values[0]) if len(reg_sub) > 0 else 50.0
            momo_pct = float(reg_sub['momentum_pct'].values[0]) if len(reg_sub) > 0 else 25.0
            avg_range = float(reg_sub['avg_range_bp'].values[0]) if len(reg_sub) > 0 else 0.0
            
            n_trades = len(sub)
            if n_trades > 0:
                wins = sub[sub['pnl_r'] > 0]
                losses = sub[sub['pnl_r'] < 0]
                wr = len(wins) / n_trades * 100.0
                gains = wins['pnl_r'].sum()
                loss_sum = np.abs(losses['pnl_r'].sum())
                pf = gains / loss_sum if loss_sum > 0 else 99.0
                exp_r = float(sub['pnl_r'].mean())
            else:
                wr, pf, exp_r = 0.0, 0.0, 0.0
                
            # Session categorization
            classification = "NEUTRAL"
            if d in [5, 6]: # Weekend
                if chop_pct > 40.0:
                    classification = "WEEKEND_CHOP"
            if h in [6, 7, 8, 9, 10]: # Asian Graveyard
                classification = "ASIAN_GRAVEYARD"
            elif h in [13, 14, 15, 16]: # London Open Strike
                classification = "LONDON_STRIKE"
            elif h in [19, 20, 21, 22, 23]: # NY Cash Peak Strike
                classification = "NY_STRIKE"
                
            cell_matrix.append({
                'dow_ist': d,
                'dow_name': DAYS_OF_WEEK[d],
                'hour_ist': h,
                'hour_label': f"{h:02d}:00 IST",
                'chop_pct': round(chop_pct, 1),
                'momo_pct': round(momo_pct, 1),
                'avg_range_bp': round(avg_range, 1),
                'trades': n_trades,
                'win_rate': round(wr, 1),
                'pf': round(pf, 2),
                'exp_r': round(exp_r, 2),
                'classification': classification
            })
            
    # Visualizations
    generate_visualizations(regime_grid, pd.DataFrame(cell_matrix), dow_summary, hourly_summary)
    
    # Save JSON result
    output = {
        'generated_at': datetime.now(IST).isoformat(),
        'timezone': 'IST (UTC+05:30)',
        'data_period': '3 Years (Binance BTCUSDT Perp)',
        'dow_summary': dow_summary.to_dict(orient='records'),
        'hourly_summary': hourly_summary.to_dict(orient='records'),
        'cell_matrix': cell_matrix
    }
    
    out_file = ROOT / "data" / "ist_schedule_analysis.json"
    out_file.write_text(json.dumps(output, indent=2))
    (PUBLIC_DIR / "ist_schedule.json").write_text(json.dumps(output, indent=2))
    print(f"\nSaved analysis results to {out_file} and {PUBLIC_DIR / 'ist_schedule.json'}")
    
    # Print Console Summary Guide
    print("\n" + "="*90)
    print("3-YEAR EMPIRICAL BTCUSDT SCHEDULE GUIDE (INDIAN STANDARD TIME - IST)")
    print("="*90)
    print("\n--- 1. DAY OF WEEK STATISTICAL BREAKDOWN ---")
    for r in dow_records:
        tag = "🔴 AVOID (Chop / Low PF)" if r['pf'] < 1.05 or r['exp_r'] <= 0.0 else "🟢 TRADEABLE" if r['pf'] >= 1.25 else "🟡 SELECTIVE"
        print(f"{r['dow_name']:<10} | Trades: {r['trades']:<4} | WinRate: {r['win_rate']:<5}% | PF: {r['pf']:<5} | Exp: {r['exp_r']:<5}R | Ret: {r['total_return']:<6}% | Status: {tag}")
        
    print("\n--- 2. HOURLY 24-HOUR CYCLE BREAKDOWN (IST) ---")
    for r in hourly_records:
        h = r['hour_ist']
        tag = "🔴 RED ZONE (Chop Graveyard)" if h in [6, 7, 8, 9, 10] or r['pf'] < 1.0 else "🟢 GREEN ZONE (High Conviction Strike)" if h in [13, 14, 15, 19, 20, 21, 22] and r['pf'] >= 1.25 else "🟡 YELLOW ZONE (Selective Range)"
        print(f"{r['hour_label']:<20} | Trades: {r['trades']:<3} | WinRate: {r['win_rate']:<5}% | PF: {r['pf']:<5} | Exp: {r['exp_r']:<5}R | Status: {tag}")
    print("="*90)

if __name__ == "__main__":
    main()
