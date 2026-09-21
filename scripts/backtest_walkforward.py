#!/usr/bin/env python3
"""
Comprehensive Walk-Forward Backtesting for:
1. Strategy 1: Radar Trap (1H S/R liquidity sweeps with 5M execution)
2. Strategy 2: 15M 20 EMA Breakout + HTF 1H Bias + Volume + ATR
3. Strategy 3: Hardcore SMC (Order Blocks, FVGs, CHoCH/BOS)
Evaluates UNGATED vs. MARKOV 2.0 FILTER GATED.
"""

from __future__ import annotations
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
ARTIFACT_DIR = Path("/Users/dhruv/.gemini/antigravity-ide/brain/13e1b56c-f5a3-40a8-a642-696b930e56ec")
RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

def load_data():
    df_5m = pd.read_parquet(RAW_DIR / "5m" / "klines.parquet")
    df_15m = pd.read_parquet(RAW_DIR / "15m" / "klines.parquet")
    df_1h = pd.read_parquet(RAW_DIR / "1h" / "klines.parquet")
    
    for df in [df_5m, df_15m, df_1h]:
        for col in ['open', 'high', 'low', 'close', 'volume']:
            df[col] = df[col].astype(float)
        df['datetime'] = pd.to_datetime(df['open_time'], unit='ms')
    return df_5m, df_15m, df_1h

def get_markov_filter_series(df_candle: pd.DataFrame, window: int = 20, threshold: float = 0.01):
    """Compute walk-forward stride-sampled Markov 2.0 signal series."""
    close = df_candle['close'].values
    n = len(close)
    returns = pd.Series(close).pct_change(window).values
    
    states = np.full(n, np.nan)
    states[returns >= threshold] = 2 # BULL
    states[returns <= -threshold] = 0 # BEAR
    states[(returns > -threshold) & (returns < threshold)] = 1 # SIDEWAYS
    
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

def backtest_radar_trap(df_5m: pd.DataFrame, df_1h: pd.DataFrame, sig_1h: np.ndarray):
    """
    Strategy 1: Radar Trap (1H extremes with 5M execution)
    """
    df_1h_c = df_1h.copy()
    df_1h_c['range_high'] = df_1h_c['high'].rolling(100).max().shift(1)
    df_1h_c['range_low'] = df_1h_c['low'].rolling(100).min().shift(1)
    df_1h_c['range_span'] = df_1h_c['range_high'] - df_1h_c['range_low']
    df_1h_c['zone_high_bound'] = df_1h_c['range_high'] - 0.20 * df_1h_c['range_span']
    df_1h_c['zone_low_bound'] = df_1h_c['range_low'] + 0.20 * df_1h_c['range_span']
    df_1h_c['sig_1h'] = sig_1h
    
    df_5m_c = df_5m.copy()
    df_5m_c['h1_open_time'] = (df_5m_c['open_time'] // 3_600_000) * 3_600_000
    df = pd.merge(df_5m_c, df_1h_c[['open_time', 'range_high', 'range_low', 'zone_high_bound', 'zone_low_bound', 'sig_1h']], left_on='h1_open_time', right_on='open_time')
    
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    dates = df['datetime'].values
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    n = len(df)
    
    def simulate(use_filter=False):
        trades = []
        in_pos = False
        pos_type = 0
        entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
        last_exit = -100
        
        for i in range(1200, n - 1):
            if in_pos:
                if pos_type == 1:
                    if lows[i] <= sl_px:
                        trades.append({'time': dates[i], 'pnl_r': -1.0, 'ret': (sl_px/entry_px)-1.0, 'type': 'LONG'})
                        in_pos = False; last_exit = i; continue
                    elif highs[i] >= tp_px:
                        trades.append({'time': dates[i], 'pnl_r': (tp_px-entry_px)/(entry_px-sl_px), 'ret': (tp_px/entry_px)-1.0, 'type': 'LONG'})
                        in_pos = False; last_exit = i; continue
                elif pos_type == -1:
                    if highs[i] >= sl_px:
                        trades.append({'time': dates[i], 'pnl_r': -1.0, 'ret': 1.0-(sl_px/entry_px), 'type': 'SHORT'})
                        in_pos = False; last_exit = i; continue
                    elif lows[i] <= tp_px:
                        trades.append({'time': dates[i], 'pnl_r': (entry_px-tp_px)/(sl_px-entry_px), 'ret': 1.0-(tp_px/entry_px), 'type': 'SHORT'})
                        in_pos = False; last_exit = i; continue
                if i - entry_idx >= 48:
                    r = (closes[i]-entry_px)/(entry_px-sl_px) if pos_type == 1 else (entry_px-closes[i])/(sl_px-entry_px)
                    ret = (closes[i]/entry_px)-1.0 if pos_type == 1 else 1.0-(closes[i]/entry_px)
                    trades.append({'time': dates[i], 'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type==1 else 'SHORT'})
                    in_pos = False; last_exit = i; continue
                continue
                
            if i - last_exit < 6: continue
            rh, rl, zh, zl, s = r_highs[i], r_lows[i], z_highs[i], z_lows[i], sigs[i]
            c_o, c_h, c_l, c_c = opens[i], highs[i], lows[i], closes[i]
            
            # Short setup at 1H Resistance
            if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
                if use_filter and s > 0.05: # Veto fading when macro 1H is in strong bull trend
                    continue
                stop = c_h * 1.0005
                target = max(rl, c_c - 2.5 * (stop - c_c))
                risk = stop - c_c
                if risk > 0 and ((c_c - target)/risk) >= 1.5:
                    in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; continue
                    
            # Long setup at 1H Support
            if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
                if use_filter and s < -0.05: # Veto fading when macro 1H is in strong bear collapse
                    continue
                stop = c_l * 0.9995
                target = min(rh, c_c + 2.5 * (c_c - stop))
                risk = c_c - stop
                if risk > 0 and ((target - c_c)/risk) >= 1.5:
                    in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; continue
                    
        return pd.DataFrame(trades)
        
    return simulate(False), simulate(True)

def backtest_radar_trap_v2(df_5m: pd.DataFrame, df_1h: pd.DataFrame, sig_1h: np.ndarray):
    """
    Strategy 1 Upgrade: Radar Trap 2.0 (Optimized)
    - 72H (3-Day) Macro Rolling Extremes
    - 2.0R Realistic Profit Target (locks profit before mid-range chop)
    - Western Active Hours Killzone (07:00-24:00 UTC, filters Asian graveyard chop)
    - Markov 2.0 Trend Veto (|S_t| > 0.05)
    """
    df_1h_c = df_1h.copy()
    df_1h_c['range_high'] = df_1h_c['high'].rolling(72).max().shift(1)
    df_1h_c['range_low'] = df_1h_c['low'].rolling(72).min().shift(1)
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
    dates = df['datetime'].values
    r_highs = df['range_high'].values
    r_lows = df['range_low'].values
    z_highs = df['zone_high_bound'].values
    z_lows = df['zone_low_bound'].values
    sigs = df['sig_1h'].values
    n = len(df)
    
    def simulate(use_filter=False):
        trades = []
        in_pos = False
        pos_type = 0
        entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
        last_exit = -100
        
        for i in range(1200, n - 1):
            if in_pos:
                if pos_type == 1:
                    if lows[i] <= sl_px:
                        trades.append({'time': dates[i], 'pnl_r': -1.0, 'ret': (sl_px/entry_px)-1.0, 'type': 'LONG'})
                        in_pos = False; last_exit = i; continue
                    elif highs[i] >= tp_px:
                        trades.append({'time': dates[i], 'pnl_r': 2.0, 'ret': (tp_px/entry_px)-1.0, 'type': 'LONG'})
                        in_pos = False; last_exit = i; continue
                elif pos_type == -1:
                    if highs[i] >= sl_px:
                        trades.append({'time': dates[i], 'pnl_r': -1.0, 'ret': 1.0-(sl_px/entry_px), 'type': 'SHORT'})
                        in_pos = False; last_exit = i; continue
                    elif lows[i] <= tp_px:
                        trades.append({'time': dates[i], 'pnl_r': 2.0, 'ret': 1.0-(tp_px/entry_px), 'type': 'SHORT'})
                        in_pos = False; last_exit = i; continue
                if i - entry_idx >= 48:
                    r = (closes[i]-entry_px)/(entry_px-sl_px) if pos_type == 1 else (entry_px-closes[i])/(sl_px-entry_px)
                    ret = (closes[i]/entry_px)-1.0 if pos_type == 1 else 1.0-(closes[i]/entry_px)
                    trades.append({'time': dates[i], 'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type==1 else 'SHORT'})
                    in_pos = False; last_exit = i; continue
                continue
                
            if i - last_exit < 6: continue
            
            # Killzone Session Filter: Western Active Hours (07:00-24:00 UTC)
            if hours[i] < 7:
                continue
                
            rh, rl, zh, zl, s = r_highs[i], r_lows[i], z_highs[i], z_lows[i], sigs[i]
            c_o, c_h, c_l, c_c = opens[i], highs[i], lows[i], closes[i]
            if np.isnan(rh) or np.isnan(rl) or rh == rl: continue
            
            # Short setup at 72H Resistance
            if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
                if use_filter and s > 0.05:
                    continue
                stop = c_h * 1.0005
                target = max(rl, c_c - 2.0 * (stop - c_c))
                risk = stop - c_c
                if risk > 0 and ((c_c - target)/risk) >= 1.2:
                    in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; continue
                    
            # Long setup at 72H Support
            if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
                if use_filter and s < -0.05:
                    continue
                stop = c_l * 0.9995
                target = min(rh, c_c + 2.0 * (c_c - stop))
                risk = c_c - stop
                if risk > 0 and ((target - c_c)/risk) >= 1.2:
                    in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; continue
                    
        return pd.DataFrame(trades)
        
    return simulate(False), simulate(True)


def backtest_ema_breakout(df_15m: pd.DataFrame, df_1h: pd.DataFrame, sig_15m: np.ndarray):
    """
    Strategy 2: 15M 20 EMA Breakout + HTF 1H Bias + Volume + ATR
    """
    df = df_15m.copy()
    df['ema20'] = df['close'].ewm(span=20, adjust=False).mean()
    df['vol_ma20'] = df['volume'].rolling(20).mean()
    
    prev_close = df['close'].shift(1)
    tr = np.maximum(df['high'] - df['low'], np.maximum((df['high'] - prev_close).abs(), (df['low'] - prev_close).abs()))
    df['atr14'] = tr.rolling(14).mean()
    df['sig_15m'] = sig_15m
    
    df_1h_c = df_1h.copy()
    df_1h_c['ema50_1h'] = df_1h_c['close'].ewm(span=50, adjust=False).mean()
    df['h1_open_time'] = (df['open_time'] // 3_600_000) * 3_600_000
    df = pd.merge(df, df_1h_c[['open_time', 'ema50_1h']], left_on='h1_open_time', right_on='open_time', suffixes=('', '_1h'))
    
    closes = df['close'].values
    opens = df['open'].values
    highs = df['high'].values
    lows = df['low'].values
    vols = df['volume'].values
    vol_mas = df['vol_ma20'].values
    ema20s = df['ema20'].values
    atr14s = df['atr14'].values
    ema50_1hs = df['ema50_1h'].values
    sigs = df['sig_15m'].values
    dates = df['datetime'].values
    n = len(df)
    
    def simulate(use_filter=False):
        trades = []
        in_pos = False
        pos_type = 0
        entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
        
        for i in range(200, n - 1):
            if in_pos:
                if pos_type == 1:
                    if lows[i] <= sl_px:
                        trades.append({'time': dates[i], 'type': 'LONG', 'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0})
                        in_pos = False; continue
                    elif highs[i] >= tp_px:
                        trades.append({'time': dates[i], 'type': 'LONG', 'pnl_r': (tp_px - entry_px) / (entry_px - sl_px), 'ret': (tp_px / entry_px) - 1.0})
                        in_pos = False; continue
                elif pos_type == -1:
                    if highs[i] >= sl_px:
                        trades.append({'time': dates[i], 'type': 'SHORT', 'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px)})
                        in_pos = False; continue
                    elif lows[i] <= tp_px:
                        trades.append({'time': dates[i], 'type': 'SHORT', 'pnl_r': (entry_px - tp_px) / (sl_px - entry_px), 'ret': 1.0 - (tp_px / entry_px)})
                        in_pos = False; continue
                if i - entry_idx >= 32:
                    pnl_r = (closes[i] - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - closes[i]) / (sl_px - entry_px)
                    ret = (closes[i] / entry_px) - 1.0 if pos_type == 1 else 1.0 - (closes[i] / entry_px)
                    trades.append({'time': dates[i], 'type': 'LONG' if pos_type == 1 else 'SHORT', 'pnl_r': pnl_r, 'ret': ret})
                    in_pos = False; continue
                continue
                
            c_close, c_open, p_close = closes[i], opens[i], closes[i - 1]
            c_ema, c_vol, c_vol_ma = ema20s[i], vols[i], vol_mas[i]
            c_atr, htf_ema, sig = atr14s[i], ema50_1hs[i], sigs[i]
            
            if np.isnan(c_atr) or np.isnan(c_vol_ma) or c_vol_ma == 0: continue
            if c_vol < 1.2 * c_vol_ma: continue
            
            # LONG BREAKOUT
            if p_close <= c_ema and c_close > c_ema and c_close > c_open and c_close > htf_ema:
                if use_filter and sig < 0.0: continue
                in_pos = True; pos_type = 1; entry_px = c_close; sl_px = c_close - 1.2 * c_atr; tp_px = c_close + 2.2 * c_atr; entry_idx = i; continue
                
            # SHORT BREAKOUT
            if p_close >= c_ema and c_close < c_ema and c_close < c_open and c_close < htf_ema:
                if use_filter and sig > 0.0: continue
                in_pos = True; pos_type = -1; entry_px = c_close; sl_px = c_close + 1.2 * c_atr; tp_px = c_close - 2.2 * c_atr; entry_idx = i; continue
                
        return pd.DataFrame(trades)
        
    return simulate(False), simulate(True)

def backtest_hardcore_smc(df_15m: pd.DataFrame, sig_15m: np.ndarray):
    """
    Strategy 3: Hardcore SMC (Smart Money Concepts)
    """
    df = df_15m.copy()
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    dates = df['datetime'].values
    sigs = sig_15m
    n = len(df)
    
    is_swing_high = np.zeros(n, dtype=bool)
    is_swing_low = np.zeros(n, dtype=bool)
    for i in range(2, n - 2):
        if highs[i] > highs[i-1] and highs[i] > highs[i-2] and highs[i] > highs[i+1] and highs[i] > highs[i+2]:
            is_swing_high[i] = True
        if lows[i] < lows[i-1] and lows[i] < lows[i-2] and lows[i] < lows[i+1] and lows[i] < lows[i+2]:
            is_swing_low[i] = True
            
    def simulate(use_filter=False):
        trades = []
        in_pos = False
        pos_type = 0
        entry_px, sl_px, tp_px, entry_idx = 0.0, 0.0, 0.0, 0
        last_sh, last_sl = np.nan, np.nan
        active_fvg_bull, active_fvg_bear = None, None
        
        for i in range(50, n - 1):
            if is_swing_high[i - 2]: last_sh = highs[i - 2]
            if is_swing_low[i - 2]: last_sl = lows[i - 2]
            
            if in_pos:
                if pos_type == 1:
                    if lows[i] <= sl_px:
                        trades.append({'time': dates[i], 'type': 'LONG', 'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0})
                        in_pos = False; continue
                    elif highs[i] >= tp_px:
                        trades.append({'time': dates[i], 'type': 'LONG', 'pnl_r': (tp_px - entry_px) / (entry_px - sl_px), 'ret': (tp_px / entry_px) - 1.0})
                        in_pos = False; continue
                elif pos_type == -1:
                    if highs[i] >= sl_px:
                        trades.append({'time': dates[i], 'type': 'SHORT', 'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px)})
                        in_pos = False; continue
                    elif lows[i] <= tp_px:
                        trades.append({'time': dates[i], 'type': 'SHORT', 'pnl_r': (entry_px - tp_px) / (sl_px - entry_px), 'ret': 1.0 - (tp_px / entry_px)})
                        in_pos = False; continue
                if i - entry_idx >= 40:
                    pnl_r = (closes[i] - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - closes[i]) / (sl_px - entry_px)
                    ret = (closes[i] / entry_px) - 1.0 if pos_type == 1 else 1.0 - (closes[i] / entry_px)
                    trades.append({'time': dates[i], 'type': 'LONG' if pos_type == 1 else 'SHORT', 'pnl_r': pnl_r, 'ret': ret})
                    in_pos = False; continue
                continue
                
            # Bullish FVG & BOS
            if lows[i] > highs[i - 2] and not np.isnan(last_sh) and closes[i] > last_sh:
                ob_low = min(lows[i - 2], lows[i - 1])
                active_fvg_bull = {'low': highs[i - 2], 'high': lows[i], 'ob_low': ob_low, 'created': i}
                
            # Bearish FVG & BOS
            if highs[i] < lows[i - 2] and not np.isnan(last_sl) and closes[i] < last_sl:
                ob_high = max(highs[i - 2], highs[i - 1])
                active_fvg_bear = {'low': highs[i], 'high': lows[i - 2], 'ob_high': ob_high, 'created': i}
                
            sig = sigs[i]
            
            # Re-test Bullish FVG
            if active_fvg_bull and i - active_fvg_bull['created'] <= 20:
                if lows[i] <= active_fvg_bull['high'] and closes[i] >= active_fvg_bull['low']:
                    if not use_filter or sig >= 0.0:
                        stop = active_fvg_bull['ob_low'] * 0.999
                        risk = closes[i] - stop
                        if risk > 0:
                            in_pos = True; pos_type = 1; entry_px = closes[i]; sl_px = stop; tp_px = closes[i] + 2.2 * risk; entry_idx = i; active_fvg_bull = None; continue
                            
            # Re-test Bearish FVG
            if active_fvg_bear and i - active_fvg_bear['created'] <= 20:
                if highs[i] >= active_fvg_bear['low'] and closes[i] <= active_fvg_bear['high']:
                    if not use_filter or sig <= 0.0:
                        stop = active_fvg_bear['ob_high'] * 1.001
                        risk = stop - closes[i]
                        if risk > 0:
                            in_pos = True; pos_type = -1; entry_px = closes[i]; sl_px = stop; tp_px = closes[i] - 2.2 * risk; entry_idx = i; active_fvg_bear = None; continue
                            
        return pd.DataFrame(trades)
        
    return simulate(False), simulate(True)

def calc_metrics(df_trades: pd.DataFrame, name: str):
    if len(df_trades) == 0:
        return {"name": name, "trades": 0, "win_rate": 0.0, "profit_factor": 0.0, "total_return": 0.0, "max_drawdown": 0.0, "expectancy_r": 0.0, "cum": []}
        
    wins = df_trades[df_trades['pnl_r'] > 0]
    losses = df_trades[df_trades['pnl_r'] < 0]
    win_rate = len(wins) / len(df_trades)
    
    gross_gain = wins['pnl_r'].sum()
    gross_loss = np.abs(losses['pnl_r'].sum())
    profit_factor = (gross_gain / gross_loss) if gross_loss > 0 else 99.0
    
    cum_returns = np.cumprod(1 + df_trades['ret'].values)
    total_ret = cum_returns[-1] - 1.0
    
    peaks = np.maximum.accumulate(cum_returns)
    drawdowns = (cum_returns - peaks) / peaks
    max_dd = np.min(drawdowns) if len(drawdowns) > 0 else 0.0
    expectancy = df_trades['pnl_r'].mean()
    
    return {
        "name": name,
        "trades": len(df_trades),
        "win_rate": float(win_rate),
        "profit_factor": float(profit_factor),
        "total_return": float(total_ret),
        "max_drawdown": float(max_dd),
        "expectancy_r": float(expectancy),
        "cum": cum_returns.tolist()
    }

def plot_curves(un_df: pd.DataFrame, gat_df: pd.DataFrame, title: str, save_name: str):
    plt.figure(figsize=(10, 5), dpi=140)
    plt.style.use('dark_background')
    
    if len(un_df) > 0:
        cum_un = np.cumprod(1 + un_df['ret'].values)
        plt.plot(pd.to_datetime(un_df['time']), cum_un, label=f"Ungated Strategy (PF: {calc_metrics(un_df, '')['profit_factor']:.2f}, MaxDD: {calc_metrics(un_df, '')['max_drawdown']:.1%})", color='#888888', linestyle='--', lw=1.6)
        
    if len(gat_df) > 0:
        cum_gat = np.cumprod(1 + gat_df['ret'].values)
        plt.plot(pd.to_datetime(gat_df['time']), cum_gat, label=f"Markov 2.0 Gated (PF: {calc_metrics(gat_df, '')['profit_factor']:.2f}, MaxDD: {calc_metrics(gat_df, '')['max_drawdown']:.1%})", color='#10b981', lw=2.2)
        
    plt.title(f"{title} — Walk-Forward Backtest (1-Year BTCUSDT Perp)", fontsize=12, fontweight='bold', pad=10)
    plt.xlabel("Execution Date", fontsize=9.5)
    plt.ylabel("Equity Multiple ($1 Initial)", fontsize=9.5)
    plt.grid(True, linestyle=':', alpha=0.3)
    plt.legend(loc="upper left", framealpha=0.8, fontsize=9)
    plt.tight_layout()
    
    plt.savefig(RESEARCH_DIR / f"{save_name}.png")
    plt.savefig(ARTIFACT_DIR / f"{save_name}.png")
    plt.close()

def main():
    print("Loading data...")
    df_5m, df_15m, df_1h = load_data()
    
    print("Computing Markov 2.0 Stride Signals...")
    sig_1h = get_markov_filter_series(df_1h, window=20, threshold=0.02)
    sig_15m = get_markov_filter_series(df_15m, window=20, threshold=0.01)
    
    print("Backtesting Strategy 1: Radar Trap (Baseline)...")
    r_un, r_gat = backtest_radar_trap(df_5m, df_1h, sig_1h)
    plot_curves(r_un, r_gat, "Strategy 1: Radar Trap 1.0 (Liquidity Sweep)", "radar_trap_equity")
    
    print("Backtesting Strategy 1 Upgrade: Radar Trap 2.0 (Optimized 72H + 2.0R + Western)...")
    r2_un, r2_gat = backtest_radar_trap_v2(df_5m, df_1h, sig_1h)
    plot_curves(r2_un, r2_gat, "Strategy 1: Radar Trap 2.0 (72H + 2.0R + Western)", "radar_trap_v2_equity")
    
    print("Backtesting Strategy 2: 15M 20 EMA Breakout + HTF Bias...")
    e_un, e_gat = backtest_ema_breakout(df_15m, df_1h, sig_15m)
    plot_curves(e_un, e_gat, "Strategy 2: 15M 20 EMA Breakout + HTF", "ema_breakout_equity")
    
    print("Backtesting Strategy 3: Hardcore SMC...")
    s_un, s_gat = backtest_hardcore_smc(df_15m, sig_15m)
    plot_curves(s_un, s_gat, "Strategy 3: Hardcore SMC (FVG + OB)", "smc_equity")
    
    results = {
        "strategy_1_radar": {
            "ungated": {k: v for k, v in calc_metrics(r_un, "Radar Trap (Ungated)").items() if k != 'cum'},
            "gated": {k: v for k, v in calc_metrics(r_gat, "Radar Trap (Markov 2.0 Gated)").items() if k != 'cum'}
        },
        "strategy_1_radar_v2": {
            "ungated": {k: v for k, v in calc_metrics(r2_un, "Radar Trap 2.0 (Ungated)").items() if k != 'cum'},
            "gated": {k: v for k, v in calc_metrics(r2_gat, "Radar Trap 2.0 (Markov 2.0 Gated)").items() if k != 'cum'}
        },
        "strategy_2_ema": {
            "ungated": {k: v for k, v in calc_metrics(e_un, "15M EMA Breakout (Ungated)").items() if k != 'cum'},
            "gated": {k: v for k, v in calc_metrics(e_gat, "15M EMA Breakout (Markov 2.0 Gated)").items() if k != 'cum'}
        },
        "strategy_3_smc": {
            "ungated": {k: v for k, v in calc_metrics(s_un, "Hardcore SMC (Ungated)").items() if k != 'cum'},
            "gated": {k: v for k, v in calc_metrics(s_gat, "Hardcore SMC (Markov 2.0 Gated)").items() if k != 'cum'}
        }
    }
    
    (RESEARCH_DIR / "strategy_walkforward_results.json").write_text(json.dumps(results, indent=2))
    print("\nSaved charts & results summary to research/ and artifact dir.")


if __name__ == "__main__":
    main()
