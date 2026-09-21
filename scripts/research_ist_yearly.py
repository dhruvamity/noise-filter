#!/usr/bin/env python3
"""
Year-by-Year Empirical Analysis for BTCUSDT Perpetuals in Indian Standard Time (IST)
Separately evaluates years: 2024, 2025, 2026 (YTD)
Computes for each individual year:
1. 7x24 IST Chop % and Momentum % Heatmap (168 cells)
2. Day-of-Week performance (Trades, Win Rate %, Profit Factor, Expectancy R, Return %)
3. 24-Hour hourly breakdown in IST (Red Zones vs Strike Windows)
4. Radar Trap 2.0 institutional sweep backtest
5. Cross-year stability analysis (checking if patterns persist year-over-year)
"""

from __future__ import annotations
import json
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
PUBLIC_DIR = ROOT / "public"
RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

IST = timezone(timedelta(hours=5, minutes=30))
DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

def load_data():
    print("Loading 3-year klines...")
    df_5m = pd.read_parquet(RAW_DIR / "5m" / "klines.parquet")
    df_1h = pd.read_parquet(RAW_DIR / "1h" / "klines.parquet")
    
    for df in [df_5m, df_1h]:
        for col in ['open', 'high', 'low', 'close', 'volume', 'quote_volume']:
            df[col] = df[col].astype(float)
        df['dt_utc'] = pd.to_datetime(df['open_time'], unit='ms', utc=True)
        df['dt_ist'] = df['dt_utc'].dt.tz_convert('Asia/Kolkata')
        df['year_ist'] = df['dt_ist'].dt.year
        df['dow_ist'] = df['dt_ist'].dt.dayofweek  # 0 = Monday, 6 = Sunday
        df['hour_ist'] = df['dt_ist'].dt.hour      # 0 to 23
        df['dow_name'] = df['dow_ist'].map(lambda d: DAYS_OF_WEEK[d])
    return df_5m, df_1h

def get_markov_signals(df_1h: pd.DataFrame, window=20, thresh=0.02):
    close = df_1h['close'].values
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

def backtest_radar_trap_full(df_5m: pd.DataFrame, df_1h: pd.DataFrame, sig_1h: np.ndarray):
    """
    Backtests Radar Trap 2.0 across the dataset and records detailed trade records with year, dow, and hour.
    """
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
    years = df['year_ist'].values
    dows = df['dow_ist'].values
    hours = df['hour_ist'].values
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    dts = df['dt_ist'].values
    n = len(df)
    
    trades = []
    in_pos = False
    pos_type = 0
    entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
    entry_year, entry_dow, entry_hour = 0, 0, 0
    entry_time = None
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
                    trades.append({
                        'year_ist': entry_year,
                        'dow_ist': entry_dow,
                        'hour_ist': entry_hour,
                        'pnl_r': -1.0,
                        'ret': ret,
                        'type': 'LONG',
                        'bars': i - entry_idx,
                        'entry_time': str(entry_time)
                    })
                    in_pos = False; last_exit = i; continue
                if c_h >= tp_px:
                    ret = (tp_px / entry_px) - 1.0
                    trades.append({
                        'year_ist': entry_year,
                        'dow_ist': entry_dow,
                        'hour_ist': entry_hour,
                        'pnl_r': target_r,
                        'ret': ret,
                        'type': 'LONG',
                        'bars': i - entry_idx,
                        'entry_time': str(entry_time)
                    })
                    in_pos = False; last_exit = i; continue
            elif pos_type == -1: # Short
                if c_h >= sl_px:
                    ret = 1.0 - (sl_px / entry_px)
                    trades.append({
                        'year_ist': entry_year,
                        'dow_ist': entry_dow,
                        'hour_ist': entry_hour,
                        'pnl_r': -1.0,
                        'ret': ret,
                        'type': 'SHORT',
                        'bars': i - entry_idx,
                        'entry_time': str(entry_time)
                    })
                    in_pos = False; last_exit = i; continue
                if c_l <= tp_px:
                    ret = 1.0 - (tp_px / entry_px)
                    trades.append({
                        'year_ist': entry_year,
                        'dow_ist': entry_dow,
                        'hour_ist': entry_hour,
                        'pnl_r': target_r,
                        'ret': ret,
                        'type': 'SHORT',
                        'bars': i - entry_idx,
                        'entry_time': str(entry_time)
                    })
                    in_pos = False; last_exit = i; continue
                    
            if i - entry_idx >= 48:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({
                    'year_ist': entry_year,
                    'dow_ist': entry_dow,
                    'hour_ist': entry_hour,
                    'pnl_r': r,
                    'ret': ret,
                    'type': 'LONG' if pos_type==1 else 'SHORT',
                    'bars': i - entry_idx,
                    'entry_time': str(entry_time)
                })
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
                entry_year = years[i]
                entry_dow = dows[i]
                entry_hour = hours[i]
                entry_time = dts[i]
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
                entry_year = years[i]
                entry_dow = dows[i]
                entry_hour = hours[i]
                entry_time = dts[i]
                continue
                
    return pd.DataFrame(trades)

def analyze_single_year(year: int, df_5m: pd.DataFrame, trades_df: pd.DataFrame):
    """
    Computes statistical regime metrics and strategy performance for a specific calendar year.
    """
    print(f"\nAnalyzing Year {year}...")
    df_y = df_5m[df_5m['year_ist'] == year].copy()
    trades_y = trades_df[trades_df['year_ist'] == year].copy()
    
    # 1. Regime metrics (Chop vs Momentum)
    prev_close = df_y['close'].shift(1)
    tr = np.maximum(df_y['high'] - df_y['low'], np.maximum((df_y['high'] - prev_close).abs(), (df_y['low'] - prev_close).abs()))
    df_y['tr_bp'] = (tr / df_y['close']) * 10000.0
    candle_span = df_y['high'] - df_y['low']
    df_y['body_ratio'] = (df_y['close'] - df_y['open']).abs() / np.maximum(candle_span, 1e-8)
    
    highs = df_y['high'].values
    lows = df_y['low'].values
    closes = df_y['close'].values
    n = len(df_y)
    
    forward_mfe = np.zeros(n)
    forward_mae = np.zeros(n)
    for i in range(n - 12):
        fh = np.max(highs[i+1 : i+13])
        fl = np.min(lows[i+1 : i+13])
        c = closes[i]
        forward_mfe[i] = max(0.0, (fh - c) / c * 10000.0)
        forward_mae[i] = max(0.0, (c - fl) / c * 10000.0)
        
    df_y['fwd_mfe_bp'] = forward_mfe
    df_y['fwd_mae_bp'] = forward_mae
    
    tr_p25 = df_y['tr_bp'].quantile(0.25)
    tr_p50 = df_y['tr_bp'].quantile(0.50)
    df_y['is_chop'] = (df_y['tr_bp'] < tr_p25) | (df_y['body_ratio'] < 0.20)
    df_y['is_momentum'] = (df_y['tr_bp'] > tr_p50) & (df_y['body_ratio'] > 0.50) & (df_y['fwd_mfe_bp'] > 30.0)
    
    regime_grid = df_y.groupby(['dow_ist', 'hour_ist']).agg(
        total_bars=('close', 'count'),
        avg_range_bp=('tr_bp', 'mean'),
        chop_pct=('is_chop', lambda x: x.mean() * 100.0),
        momo_pct=('is_momentum', lambda x: x.mean() * 100.0),
        fwd_mfe_bp=('fwd_mfe_bp', 'mean'),
        fwd_mae_bp=('fwd_mae_bp', 'mean')
    ).reset_index()
    
    # 2. Strategy DOW summary
    dow_records = []
    for d in range(7):
        sub = trades_y[trades_y['dow_ist'] == d]
        reg_d = df_y[df_y['dow_ist'] == d]
        chop_d = float(reg_d['is_chop'].mean() * 100.0) if len(reg_d) > 0 else 0.0
        momo_d = float(reg_d['is_momentum'].mean() * 100.0) if len(reg_d) > 0 else 0.0
        avg_r_d = float(reg_d['tr_bp'].mean()) if len(reg_d) > 0 else 0.0
        
        n_t = len(sub)
        if n_t > 0:
            wins = sub[sub['pnl_r'] > 0]
            losses = sub[sub['pnl_r'] < 0]
            wr = len(wins) / n_t * 100.0
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
            'trades': n_t,
            'win_rate': round(wr, 1),
            'pf': round(pf, 2),
            'exp_r': round(exp_r, 2),
            'total_return': round(tot_ret, 1),
            'chop_pct': round(chop_d, 1),
            'momo_pct': round(momo_d, 1),
            'avg_range_bp': round(avg_r_d, 1)
        })
    dow_df = pd.DataFrame(dow_records)
    
    # 3. Strategy Hourly summary
    hourly_records = []
    for h in range(24):
        sub = trades_y[trades_y['hour_ist'] == h]
        reg_h = df_y[df_y['hour_ist'] == h]
        chop_h = float(reg_h['is_chop'].mean() * 100.0) if len(reg_h) > 0 else 0.0
        momo_h = float(reg_h['is_momentum'].mean() * 100.0) if len(reg_h) > 0 else 0.0
        avg_r_h = float(reg_h['tr_bp'].mean()) if len(reg_h) > 0 else 0.0
        
        n_t = len(sub)
        if n_t > 0:
            wins = sub[sub['pnl_r'] > 0]
            losses = sub[sub['pnl_r'] < 0]
            wr = len(wins) / n_t * 100.0
            gains = wins['pnl_r'].sum()
            loss_sum = np.abs(losses['pnl_r'].sum())
            pf = gains / loss_sum if loss_sum > 0 else 99.0
            exp_r = float(sub['pnl_r'].mean())
        else:
            wr, pf, exp_r = 0.0, 0.0, 0.0
        hourly_records.append({
            'hour_ist': h,
            'hour_label': f"{h:02d}:00–{(h+1)%24:02d}:00 IST",
            'trades': n_t,
            'win_rate': round(wr, 1),
            'pf': round(pf, 2),
            'exp_r': round(exp_r, 2),
            'chop_pct': round(chop_h, 1),
            'momo_pct': round(momo_h, 1),
            'avg_range_bp': round(avg_r_h, 1)
        })
    hourly_df = pd.DataFrame(hourly_records)
    
    # 4. Cell matrix (7x24)
    cell_matrix = []
    for d in range(7):
        for h in range(24):
            sub = trades_y[(trades_y['dow_ist'] == d) & (trades_y['hour_ist'] == h)]
            reg_sub = regime_grid[(regime_grid['dow_ist'] == d) & (regime_grid['hour_ist'] == h)]
            chop_p = float(reg_sub['chop_pct'].values[0]) if len(reg_sub) > 0 else 50.0
            momo_p = float(reg_sub['momo_pct'].values[0]) if len(reg_sub) > 0 else 25.0
            avg_r = float(reg_sub['avg_range_bp'].values[0]) if len(reg_sub) > 0 else 0.0
            
            n_t = len(sub)
            if n_t > 0:
                wins = sub[sub['pnl_r'] > 0]
                losses = sub[sub['pnl_r'] < 0]
                wr = len(wins) / n_t * 100.0
                gains = wins['pnl_r'].sum()
                loss_sum = np.abs(losses['pnl_r'].sum())
                pf = gains / loss_sum if loss_sum > 0 else 99.0
                exp_r = float(sub['pnl_r'].mean())
            else:
                wr, pf, exp_r = 0.0, 0.0, 0.0
                
            cell_matrix.append({
                'dow_ist': d,
                'dow_name': DAYS_OF_WEEK[d],
                'hour_ist': h,
                'hour_label': f"{h:02d}:00 IST",
                'chop_pct': round(chop_p, 1),
                'momo_pct': round(momo_p, 1),
                'avg_range_bp': round(avg_r, 1),
                'trades': n_t,
                'win_rate': round(wr, 1),
                'pf': round(pf, 2),
                'exp_r': round(exp_r, 2)
            })
            
    # Plot individual year heatmap
    chop_matrix = np.zeros((7, 24))
    momo_matrix = np.zeros((7, 24))
    for c in cell_matrix:
        chop_matrix[c['dow_ist'], c['hour_ist']] = c['chop_pct']
        momo_matrix[c['dow_ist'], c['hour_ist']] = c['momo_pct']
        
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 10), dpi=150)
    fig.patch.set_facecolor('#0b0f19')
    
    im1 = ax1.imshow(chop_matrix, cmap='YlOrRd', aspect='auto', vmin=20, vmax=60)
    ax1.set_title(f"Year {year} BTCUSDT Chop Probability (%) [IST]", fontsize=13, fontweight='bold', color='white')
    ax1.set_yticks(range(7))
    ax1.set_yticklabels(DAYS_OF_WEEK, color='white', fontsize=10, fontweight='bold')
    ax1.set_xticks(range(24))
    ax1.set_xticklabels([f"{h:02d}" for h in range(24)], color='white', fontsize=9)
    ax1.set_facecolor('#0f172a')
    fig.colorbar(im1, ax=ax1, fraction=0.02, pad=0.02)
    
    im2 = ax2.imshow(momo_matrix, cmap='YlGn', aspect='auto', vmin=15, vmax=45)
    ax2.set_title(f"Year {year} BTCUSDT Momentum Expansion (%) [IST]", fontsize=13, fontweight='bold', color='white')
    ax2.set_yticks(range(7))
    ax2.set_yticklabels(DAYS_OF_WEEK, color='white', fontsize=10, fontweight='bold')
    ax2.set_xticks(range(24))
    ax2.set_xticklabels([f"{h:02d}" for h in range(24)], color='white', fontsize=9)
    ax2.set_facecolor('#0f172a')
    fig.colorbar(im2, ax=ax2, fraction=0.02, pad=0.02)
    
    plt.tight_layout()
    chart_path = RESEARCH_DIR / f"ist_regime_heatmap_{year}.png"
    plt.savefig(chart_path)
    (PUBLIC_DIR / chart_path.name).write_bytes(chart_path.read_bytes())
    plt.close()
    
    # Save individual year JSON
    year_json = {
        'year': year,
        'bars_5m': len(df_y),
        'total_trades': len(trades_y),
        'dow_summary': dow_df.to_dict(orient='records'),
        'hourly_summary': hourly_df.to_dict(orient='records'),
        'cell_matrix': cell_matrix
    }
    (ROOT / "data" / f"ist_schedule_{year}.json").write_text(json.dumps(year_json, indent=2))
    (PUBLIC_DIR / f"ist_schedule_{year}.json").write_text(json.dumps(year_json, indent=2))
    
    return year_json

def generate_comparison_chart(summaries: dict):
    """
    Generates a comparative figure showing DOW Profit Factor and Win Rate across 2024, 2025, and 2026.
    """
    fig, (ax_pf, ax_wr) = plt.subplots(2, 1, figsize=(15, 10), dpi=150)
    fig.patch.set_facecolor('#0b0f19')
    
    x = np.arange(7)
    width = 0.25
    
    years = [2024, 2025, 2026]
    colors = ['#38bdf8', '#f59e0b', '#10b981']
    
    for idx, (yr, col) in enumerate(zip(years, colors)):
        dow_data = summaries[yr]['dow_summary']
        pfs = [d['pf'] for d in dow_data]
        wrs = [d['win_rate'] for d in dow_data]
        
        ax_pf.bar(x + (idx - 1) * width, pfs, width, label=f"Year {yr}", color=col, alpha=0.85, edgecolor='#334155')
        ax_wr.bar(x + (idx - 1) * width, wrs, width, label=f"Year {yr}", color=col, alpha=0.85, edgecolor='#334155')
        
    ax_pf.axhline(1.0, color='#94a3b8', linestyle='--', alpha=0.7, label='Breakeven PF = 1.0')
    ax_pf.set_title("Year-over-Year Stability: Strategy Profit Factor by Day of Week (IST)", fontsize=13, fontweight='bold', color='white')
    ax_pf.set_xticks(x)
    ax_pf.set_xticklabels(DAYS_OF_WEEK, color='white', fontweight='bold')
    ax_pf.set_ylabel("Profit Factor", color='white')
    ax_pf.set_facecolor('#0f172a')
    ax_pf.tick_params(colors='white')
    ax_pf.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='white')
    ax_pf.grid(True, alpha=0.15, color='#475569', axis='y')
    
    ax_wr.set_title("Year-over-Year Stability: Strategy Win Rate (%) by Day of Week (IST)", fontsize=13, fontweight='bold', color='white')
    ax_wr.set_xticks(x)
    ax_wr.set_xticklabels(DAYS_OF_WEEK, color='white', fontweight='bold')
    ax_wr.set_ylabel("Win Rate (%)", color='white')
    ax_wr.set_facecolor('#0f172a')
    ax_wr.tick_params(colors='white')
    ax_wr.legend(facecolor='#1e293b', edgecolor='#334155', labelcolor='white')
    ax_wr.grid(True, alpha=0.15, color='#475569', axis='y')
    
    plt.tight_layout()
    chart_path = RESEARCH_DIR / "ist_yearly_comparison.png"
    plt.savefig(chart_path)
    (PUBLIC_DIR / chart_path.name).write_bytes(chart_path.read_bytes())
    plt.close()
    print(f"\nSaved cross-year comparison chart to {chart_path}")

def main():
    df_5m, df_1h = load_data()
    sig_1h = get_markov_signals(df_1h, window=20, thresh=0.02)
    
    print("\nBacktesting Radar Trap 2.0 on 3-year history...")
    trades_df = backtest_radar_trap_full(df_5m, df_1h, sig_1h)
    print(f"Total trades across 3 years: {len(trades_df)}")
    
    yearly_summaries = {}
    for yr in [2024, 2025, 2026]:
        yearly_summaries[yr] = analyze_single_year(yr, df_5m, trades_df)
        
    generate_comparison_chart(yearly_summaries)
    
    summary_out = {
        'generated_at': datetime.now(IST).isoformat(),
        'years': [2024, 2025, 2026],
        'yearly_summaries': yearly_summaries
    }
    (ROOT / "data" / "ist_schedule_yearly_summary.json").write_text(json.dumps(summary_out, indent=2))
    (PUBLIC_DIR / "ist_schedule_yearly_summary.json").write_text(json.dumps(summary_out, indent=2))
    print("\nAll yearly analyses and comparison charts generated successfully!")

if __name__ == "__main__":
    main()
