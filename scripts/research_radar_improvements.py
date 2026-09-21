#!/usr/bin/env python3
"""
Deep Research & Optimization for Strategy 1: Radar Trap (Institutional Liquidity Sweep)
Tests:
- Baseline
- Rejection Wick Ratio (wick >= 40% of total candle height)
- Volume Climax Filter (volume >= 1.3x 20-period volume MA on sweep)
- Dynamic Minimum SL (wick + max(0.05%, 0.5x ATR))
- Range Midpoint Exit (TP1 at 50% range midpoint with Breakeven trigger)
- Range Lookback (72h vs 100h vs 144h)
- Combined Radar Trap 2.0
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from pathlib import Path
import json

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

def run_experiment(
    df_5m: pd.DataFrame,
    df_1h: pd.DataFrame,
    sig_1h: np.ndarray,
    lookback_1h: int = 100,
    min_wick_ratio: float = 0.0,
    vol_mult: float = 0.0,
    use_midpoint_tp: bool = False,
    atr_buffer_mult: float = 0.0,
    veto_trend: bool = True
):
    df_1h_c = df_1h.copy()
    df_1h_c['range_high'] = df_1h_c['high'].rolling(lookback_1h).max().shift(1)
    df_1h_c['range_low'] = df_1h_c['low'].rolling(lookback_1h).min().shift(1)
    df_1h_c['range_span'] = df_1h_c['range_high'] - df_1h_c['range_low']
    df_1h_c['zone_high_bound'] = df_1h_c['range_high'] - 0.20 * df_1h_c['range_span']
    df_1h_c['zone_low_bound'] = df_1h_c['range_low'] + 0.20 * df_1h_c['range_span']
    df_1h_c['range_mid'] = (df_1h_c['range_high'] + df_1h_c['range_low']) / 2.0
    df_1h_c['sig_1h'] = sig_1h
    
    df_5m_c = df_5m.copy()
    # 5M ATR 14
    prev_close = df_5m_c['close'].shift(1)
    tr = np.maximum(df_5m_c['high'] - df_5m_c['low'], np.maximum((df_5m_c['high'] - prev_close).abs(), (df_5m_c['low'] - prev_close).abs()))
    df_5m_c['atr14'] = tr.rolling(14).mean()
    df_5m_c['vol_ma20'] = df_5m_c['volume'].rolling(20).mean()
    
    df_5m_c['h1_open_time'] = (df_5m_c['open_time'] // 3_600_000) * 3_600_000
    cols = ['open_time', 'range_high', 'range_low', 'range_mid', 'zone_high_bound', 'zone_low_bound', 'sig_1h']
    df = pd.merge(df_5m_c, df_1h_c[cols], left_on='h1_open_time', right_on='open_time', suffixes=('', '_1h'))
    
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    vols = df['volume'].values
    vol_mas = df['vol_ma20'].values
    atrs = df['atr14'].values
    
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    r_mids = df['range_mid'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    n = len(df)
    
    trades = []
    in_pos = False
    pos_type = 0
    entry_px, sl_px, tp_px, mid_px, entry_idx = 0.0, 0.0, 0.0, 0.0, 0
    hit_tp1 = False
    last_exit = -100
    
    for i in range(1200, n - 1):
        if in_pos:
            c_h = highs[i]
            c_l = lows[i]
            c_c = closes[i]
            
            # Position logic
            if pos_type == 1: # Long
                if c_l <= sl_px:
                    # Stopped out
                    loss_r = 0.0 if hit_tp1 else -1.0
                    ret = (sl_px / entry_px) - 1.0
                    trades.append({'pnl_r': loss_r, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                
                # Check Midpoint TP1
                if use_midpoint_tp and not hit_tp1 and c_h >= mid_px:
                    hit_tp1 = True
                    # Move SL to breakeven (entry price)
                    sl_px = entry_px
                    
                if c_h >= tp_px:
                    gain_r = (tp_px - entry_px) / (entry_px - sl_px) if not hit_tp1 else 1.5
                    ret = (tp_px / entry_px) - 1.0
                    trades.append({'pnl_r': gain_r, 'ret': ret, 'type': 'LONG', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                    
            elif pos_type == -1: # Short
                if c_h >= sl_px:
                    loss_r = 0.0 if hit_tp1 else -1.0
                    ret = 1.0 - (sl_px / entry_px)
                    trades.append({'pnl_r': loss_r, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                    
                if use_midpoint_tp and not hit_tp1 and c_l <= mid_px:
                    hit_tp1 = True
                    sl_px = entry_px
                    
                if c_l <= tp_px:
                    gain_r = (entry_px - tp_px) / (sl_px - entry_px) if not hit_tp1 else 1.5
                    ret = 1.0 - (tp_px / entry_px)
                    trades.append({'pnl_r': gain_r, 'ret': ret, 'type': 'SHORT', 'bars': i - entry_idx})
                    in_pos = False; last_exit = i; continue
                    
            # 4-hour max holding time (48 bars)
            if i - entry_idx >= 48:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type==1 else 'SHORT', 'bars': i - entry_idx})
                in_pos = False; last_exit = i; continue
            continue
            
        if i - last_exit < 6: continue
        
        rh, rl, rm = r_highs[i], r_lows[i], r_mids[i]
        zh, zl = z_highs[i], z_lows[i]
        s = sigs[i]
        c_o, c_h, c_l, c_c = opens[i], highs[i], lows[i], closes[i]
        c_v, c_vma, c_atr = vols[i], vol_mas[i], atrs[i]
        
        if np.isnan(rh) or np.isnan(rl) or rh == rl or np.isnan(c_atr):
            continue
            
        candle_range = c_h - c_l
        if candle_range <= 0: continue
        
        # Volume filter
        if vol_mult > 0 and c_v < vol_mult * c_vma:
            continue
            
        # SHORT SETUP (Buyer Trap at Resistance)
        if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
            upper_wick = c_h - max(c_o, c_c)
            wick_ratio = upper_wick / candle_range
            if wick_ratio < min_wick_ratio:
                continue
                
            if veto_trend and s > 0.05:
                continue
                
            buf = c_h * 0.0005
            if atr_buffer_mult > 0:
                buf = max(buf, atr_buffer_mult * c_atr)
            stop = c_h + buf
            target = max(rl, c_c - 2.5 * (stop - c_c))
            risk = stop - c_c
            if risk > 0 and ((c_c - target) / risk) >= 1.5:
                in_pos = True
                pos_type = -1
                entry_px = c_c
                sl_px = stop
                tp_px = target
                mid_px = rm
                hit_tp1 = False
                entry_idx = i
                continue
                
        # LONG SETUP (Seller Trap at Support)
        if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
            lower_wick = min(c_o, c_c) - c_l
            wick_ratio = lower_wick / candle_range
            if wick_ratio < min_wick_ratio:
                continue
                
            if veto_trend and s < -0.05:
                continue
                
            buf = c_l * 0.0005
            if atr_buffer_mult > 0:
                buf = max(buf, atr_buffer_mult * c_atr)
            stop = c_l - buf
            target = min(rh, c_c + 2.5 * (c_c - stop))
            risk = c_c - stop
            if risk > 0 and ((target - c_c) / risk) >= 1.5:
                in_pos = True
                pos_type = 1
                entry_px = c_c
                sl_px = stop
                tp_px = target
                mid_px = rm
                hit_tp1 = False
                entry_idx = i
                continue
                
    tdf = pd.DataFrame(trades)
    if len(tdf) == 0:
        return {"trades": 0, "win_rate": 0, "pf": 0, "ret": 0, "max_dd": 0, "exp_r": 0}
        
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
        "exp_r": round(float(tdf['pnl_r'].mean()), 2)
    }

def main():
    df_5m, df_1h = load_data()
    sig_1h = get_markov_signals(df_1h, window=20, thresh=0.02)
    
    experiments = {
        "1. Baseline Ungated": {"lookback_1h": 100, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": False},
        "2. Baseline + Markov Gate (Current)": {"lookback_1h": 100, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": True},
        "3. Wick Rejection (>= 35% wick)": {"lookback_1h": 100, "min_wick_ratio": 0.35, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": True},
        "4. Volume Climax (>= 1.2x MA)": {"lookback_1h": 100, "min_wick_ratio": 0.0, "vol_mult": 1.2, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": True},
        "5. Dynamic ATR Stop Buffer (0.5x ATR)": {"lookback_1h": 100, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.5, "veto_trend": True},
        "6. Midpoint Partial TP & Breakeven": {"lookback_1h": 100, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": True, "atr_buffer_mult": 0.0, "veto_trend": True},
        "7. Faster Range Lookback (72h)": {"lookback_1h": 72, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": True},
        "8. Wider Range Lookback (144h)": {"lookback_1h": 144, "min_wick_ratio": 0.0, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.0, "veto_trend": True},
        "9. Radar Trap 2.0 (Wick + ATR Buffer + Markov)": {"lookback_1h": 100, "min_wick_ratio": 0.30, "vol_mult": 0.0, "use_midpoint_tp": False, "atr_buffer_mult": 0.5, "veto_trend": True},
        "10. Radar Trap 2.0 + Midpoint BE": {"lookback_1h": 100, "min_wick_ratio": 0.30, "vol_mult": 0.0, "use_midpoint_tp": True, "atr_buffer_mult": 0.5, "veto_trend": True},
    }
    
    print("==================================================================================")
    print("RADAR TRAP OPTIMIZATION & EXPERIMENTATION RESULTS (1-YEAR BTCUSDT PERP)")
    print("==================================================================================")
    
    results = {}
    for name, params in experiments.items():
        res = run_experiment(df_5m, df_1h, sig_1h, **params)
        results[name] = res
        print(f"{name:<45} | Trades: {res['trades']:<4} | WinRate: {res['win_rate']:<4}% | PF: {res['pf']:<4} | Ret: {res['total_return']:<5}% | MaxDD: {res['max_dd']:<5}% | Exp: {res['exp_r']}R")
        
    (RESEARCH_DIR / "radar_trap_optimization.json").write_text(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
