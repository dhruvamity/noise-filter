#!/usr/bin/env python3
"""
Institutional 7×24 IST Trading Schedule & Momentum Heatmap for XAU/USD (Spot Gold)
===================================================================================
Analyzes historical 5M and 1H candles of Spot Gold mapped to Indian Standard Time (IST, UTC+05:30):
- Quantifies Chop Probability % vs Directional Momentum % across 168 day/hour cells
- Backtests Institutional Radar Trap 2.0 on Gold across all sessions
- Characterizes:
    * London Open Ignition (12:30 PM – 02:30 PM IST)
    * London/NY Overlap (06:30 PM – 08:30 PM IST)
    * US Cash Session Peak (07:00 PM – 11:30 PM IST)
    * Asian Session Tokyo Drift (05:30 AM – 11:30 AM IST)
    * Daily Maintenance Break (02:30 AM – 03:30 AM IST)
- Generates high-res visual heatmaps in research/ and public/
- Exports data/xau/ist_schedule_analysis.json and public/xau_ist_schedule.json
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
DATA_DIR = ROOT / "data" / "xau"
RESEARCH_DIR = ROOT / "research"
PUBLIC_DIR = ROOT / "public"
BRAIN_DIR = Path("/Users/dhruv/.gemini/antigravity-ide/brain/13e1b56c-f5a3-40a8-a642-696b930e56ec")

DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def compute_markov_signals(prices: np.ndarray, window: int = 20, threshold: float = 0.0035) -> np.ndarray:
    """Computes continuous Markov regime signal P(Bull) - P(Bear)."""
    n = len(prices)
    signals = np.zeros(n)
    if n < window * 2:
        return signals

    ret_w = np.zeros(n)
    ret_w[window:] = (prices[window:] / prices[:-window]) - 1.0

    states = np.ones(n, dtype=int)
    states[ret_w >= threshold] = 2
    states[ret_w <= -threshold] = 0

    for i in range(window * 3, n):
        sub_states = states[max(0, i - 150):i]
        trans = np.ones((3, 3))
        for s1, s2 in zip(sub_states[:-1], sub_states[1:]):
            trans[s1, s2] += 1
        probs = trans / trans.sum(axis=1, keepdims=True)
        curr_s = states[i]
        signals[i] = probs[curr_s, 2] - probs[curr_s, 0]

    return signals


def backtest_radar_trap_detailed(df_5m: pd.DataFrame, df_1h: pd.DataFrame):
    """Executes Radar Trap 2.0 on Gold and tags each trade with DOW and Hour in IST."""
    print("Simulating Institutional Radar Trap 2.0 on Gold across IST schedule...")

    df_1h = df_1h.sort_values("open_time").reset_index(drop=True)
    df_1h["rh"] = df_1h["high"].rolling(100).max().shift(1)
    df_1h["rl"] = df_1h["low"].rolling(100).min().shift(1)
    df_1h["rng"] = df_1h["rh"] - df_1h["rl"]
    df_1h["zh"] = df_1h["rh"] - (df_1h["rng"] * 0.20)
    df_1h["zl"] = df_1h["rl"] + (df_1h["rng"] * 0.20)

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
    dows = m5["dow_ist"].values
    hours = m5["hour_ist"].values
    r_highs = m5["rh"].values
    r_lows = m5["rl"].values
    z_highs = m5["zh"].values
    z_lows = m5["zl"].values

    sigs = compute_markov_signals(closes, window=20, threshold=0.0035)

    n = len(m5)
    trades = []
    in_pos = False
    pos_type = 0
    entry_px, sl_px, tp_px = 0.0, 0.0, 0.0
    entry_idx = 0
    entry_dow, entry_hour = 0, 0
    entry_time = None
    last_exit = -999
    target_r = 2.0

    for i in range(100, n):
        c_c, c_h, c_l, c_o = closes[i], highs[i], lows[i], opens[i]

        if in_pos:
            if pos_type == 1:
                if c_l <= sl_px:
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': -1.0, 'ret': (sl_px / entry_px) - 1.0, 'type': 'LONG', 'bars': i - entry_idx, 'entry_time': str(entry_time)})
                    in_pos = False; last_exit = i; continue
                elif c_h >= tp_px:
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': target_r, 'ret': (tp_px / entry_px) - 1.0, 'type': 'LONG', 'bars': i - entry_idx, 'entry_time': str(entry_time)})
                    in_pos = False; last_exit = i; continue
            elif pos_type == -1:
                if c_h >= sl_px:
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': -1.0, 'ret': 1.0 - (sl_px / entry_px), 'type': 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time)})
                    in_pos = False; last_exit = i; continue
                elif c_l <= tp_px:
                    trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': target_r, 'ret': 1.0 - (tp_px / entry_px), 'type': 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time)})
                    in_pos = False; last_exit = i; continue

            if i - entry_idx >= 48:
                r = (c_c - entry_px) / (entry_px - sl_px) if pos_type == 1 else (entry_px - c_c) / (sl_px - entry_px)
                ret = (c_c / entry_px) - 1.0 if pos_type == 1 else 1.0 - (c_c / entry_px)
                trades.append({'dow_ist': entry_dow, 'hour_ist': entry_hour, 'pnl_r': r, 'ret': ret, 'type': 'LONG' if pos_type == 1 else 'SHORT', 'bars': i - entry_idx, 'entry_time': str(entry_time)})
                in_pos = False; last_exit = i; continue
            continue

        if i - last_exit < 6:
            continue

        rh, rl = r_highs[i], r_lows[i]
        zh, zl = z_highs[i], z_lows[i]
        s = sigs[i]

        # SHORT SETUP (Buyer Trap at 1H Resistance)
        if c_c >= zh and c_h > rh and c_c < rh and c_c < c_o:
            if s > 0.05:
                continue
            stop = c_h + 0.50
            target = max(rl, c_c - target_r * (stop - c_c))
            risk = stop - c_c
            if risk > 0 and ((c_c - target) / risk) >= 1.2:
                in_pos = True; pos_type = -1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; entry_dow = dows[i]; entry_hour = hours[i]; entry_time = dts[i]; continue

        # LONG SETUP (Seller Trap at 1H Support)
        if c_c <= zl and c_l < rl and c_c > rl and c_c > c_o:
            if s < -0.05:
                continue
            stop = c_l - 0.50
            target = min(rh, c_c + target_r * (c_c - stop))
            risk = c_c - stop
            if risk > 0 and ((target - c_c) / risk) >= 1.2:
                in_pos = True; pos_type = 1; entry_px = c_c; sl_px = stop; tp_px = target; entry_idx = i; entry_dow = dows[i]; entry_hour = hours[i]; entry_time = dts[i]; continue

    return pd.DataFrame(trades)


def main():
    print("==================================================================")
    print("XAU/USD (GOLD) 7x24 IST TRADING SCHEDULE & MOMENTUM AUDIT")
    print("==================================================================")

    df_5m = pd.read_parquet(XAU_RAW / "5m" / "klines.parquet")
    df_1h = pd.read_parquet(XAU_RAW / "1h" / "klines.parquet")

    df_5m["datetime"] = pd.to_datetime(df_5m["open_time"], unit="ms", utc=True)
    df_5m["dt_ist"] = df_5m["datetime"] + pd.Timedelta(hours=5, minutes=30)
    df_5m["dow_ist"] = df_5m["dt_ist"].dt.dayofweek
    df_5m["hour_ist"] = df_5m["dt_ist"].dt.hour

    df_1h["datetime"] = pd.to_datetime(df_1h["open_time"], unit="ms", utc=True)
    df_1h["dt_ist"] = df_1h["datetime"] + pd.Timedelta(hours=5, minutes=30)
    df_1h["dow_ist"] = df_1h["dt_ist"].dt.dayofweek
    df_1h["hour_ist"] = df_1h["dt_ist"].dt.hour

    # Calculate True Range and Candle Body Ratio
    prev_close = df_5m["close"].shift(1)
    tr = np.maximum(df_5m["high"] - df_5m["low"], np.maximum((df_5m["high"] - prev_close).abs(), (df_5m["low"] - prev_close).abs()))
    df_5m["tr_bp"] = (tr / df_5m["close"]) * 10000.0
    candle_span = df_5m["high"] - df_5m["low"]
    df_5m["body_ratio"] = (df_5m["close"] - df_5m["open"]).abs() / np.maximum(candle_span, 1e-8)

    # Calculate forward 12-bar (1 hour) max favorable excursion (MFE)
    highs = df_5m["high"].values
    lows = df_5m["low"].values
    closes = df_5m["close"].values
    n = len(df_5m)
    fwd_mfe = np.zeros(n)
    for i in range(n - 12):
        fh = np.max(highs[i + 1:i + 13])
        c = closes[i]
        fwd_mfe[i] = max(0.0, (fh - c) / c * 10000.0)
    df_5m["fwd_mfe_bp"] = fwd_mfe

    tr_p25 = df_5m["tr_bp"].quantile(0.25)
    tr_p50 = df_5m["tr_bp"].quantile(0.50)
    df_5m["is_chop"] = (df_5m["tr_bp"] < tr_p25) | (df_5m["body_ratio"] < 0.20)
    df_5m["is_momentum"] = (df_5m["tr_bp"] > tr_p50) & (df_5m["body_ratio"] > 0.50) & (df_5m["fwd_mfe_bp"] > 20.0)

    # Aggregate 7x24 Grid
    regime_grid = df_5m.groupby(["dow_ist", "hour_ist"]).agg(
        total_bars=("close", "count"),
        avg_range_bp=("tr_bp", "mean"),
        chop_pct=("is_chop", lambda x: x.mean() * 100.0),
        momo_pct=("is_momentum", lambda x: x.mean() * 100.0)
    ).reset_index()

    # Backtest Radar Trap 2.0
    trades_df = backtest_radar_trap_detailed(df_5m, df_1h)
    print(f"Executed {len(trades_df):,} total Radar Trap trades on XAU/USD.\n")

    # Build Day of Week Summary
    dow_records = []
    for d in range(7):
        sub = trades_df[trades_df["dow_ist"] == d]
        reg_d = df_5m[df_5m["dow_ist"] == d]
        chop_d = float(reg_d["is_chop"].mean() * 100.0) if len(reg_d) > 0 else 0.0
        momo_d = float(reg_d["is_momentum"].mean() * 100.0) if len(reg_d) > 0 else 0.0
        avg_r_d = float(reg_d["tr_bp"].mean()) if len(reg_d) > 0 else 0.0

        n_t = len(sub)
        if n_t > 0:
            wins = sub[sub["pnl_r"] > 0]
            losses = sub[sub["pnl_r"] < 0]
            wr = len(wins) / n_t * 100.0
            gains = wins["pnl_r"].sum()
            loss_sum = np.abs(losses["pnl_r"].sum())
            pf = gains / loss_sum if loss_sum > 0 else 99.0
            exp_r = float(sub["pnl_r"].mean())
            tot_ret = float(((1 + sub["ret"]).prod() - 1.0) * 100.0)
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

    # Build Hourly Summary (24 Hours in IST)
    hourly_records = []
    for h in range(24):
        sub = trades_df[trades_df["hour_ist"] == h]
        reg_h = df_5m[df_5m["hour_ist"] == h]
        chop_h = float(reg_h["is_chop"].mean() * 100.0) if len(reg_h) > 0 else 0.0
        momo_h = float(reg_h["is_momentum"].mean() * 100.0) if len(reg_h) > 0 else 0.0
        avg_r_h = float(reg_h["tr_bp"].mean()) if len(reg_h) > 0 else 0.0

        n_t = len(sub)
        if n_t > 0:
            wins = sub[sub["pnl_r"] > 0]
            losses = sub[sub["pnl_r"] < 0]
            wr = len(wins) / n_t * 100.0
            gains = wins["pnl_r"].sum()
            loss_sum = np.abs(losses["pnl_r"].sum())
            pf = gains / loss_sum if loss_sum > 0 else 99.0
            exp_r = float(sub["pnl_r"].mean())
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

    # Build 7x24 Matrix
    cell_matrix = []
    chop_grid_2d = np.zeros((7, 24))
    momo_grid_2d = np.zeros((7, 24))
    exp_grid_2d = np.zeros((7, 24))

    for d in range(7):
        for h in range(24):
            sub = trades_df[(trades_df["dow_ist"] == d) & (trades_df["hour_ist"] == h)]
            reg_sub = regime_grid[(regime_grid["dow_ist"] == d) & (regime_grid["hour_ist"] == h)]
            chop_p = float(reg_sub["chop_pct"].values[0]) if len(reg_sub) > 0 else 50.0
            momo_p = float(reg_sub["momo_pct"].values[0]) if len(reg_sub) > 0 else 25.0
            avg_r = float(reg_sub["avg_range_bp"].values[0]) if len(reg_sub) > 0 else 0.0

            n_t = len(sub)
            if n_t > 0:
                wins = sub[sub["pnl_r"] > 0]
                losses = sub[sub["pnl_r"] < 0]
                wr = len(wins) / n_t * 100.0
                gains = wins["pnl_r"].sum()
                loss_sum = np.abs(losses["pnl_r"].sum())
                pf = gains / loss_sum if loss_sum > 0 else 99.0
                exp_r = float(sub["pnl_r"].mean())
            else:
                wr, pf, exp_r = 0.0, 0.0, 0.0

            chop_grid_2d[d, h] = chop_p
            momo_grid_2d[d, h] = momo_p
            exp_grid_2d[d, h] = exp_r

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

    # Print DOW Summary
    print("------------------------------------------------------------------")
    print("XAU/USD DAY-OF-THE-WEEK PERFORMANCE SUMMARY (IST)")
    print("------------------------------------------------------------------")
    for r in dow_records:
        print(f"{r['dow_name']:10s} | Trades: {r['trades']:3d} | WR: {r['win_rate']:5.1f}% | PF: {r['pf']:5.2f} | Exp: {r['exp_r']:+5.2f}R | Chop: {r['chop_pct']:4.1f}% | Momo: {r['momo_pct']:4.1f}%")

    # Plot 7x24 Regime Heatmap
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 11), sharex=True)

    im1 = ax1.imshow(chop_grid_2d, cmap="YlOrRd", aspect="auto")
    ax1.set_title("XAU/USD (Gold) 7×24 Chop & Compression Probability % (IST)", fontsize=13, fontweight='bold', pad=10)
    ax1.set_yticks(range(7))
    ax1.set_yticklabels(DAYS_OF_WEEK, fontsize=10)
    cbar1 = plt.colorbar(im1, ax=ax1, fraction=0.018, pad=0.02)
    cbar1.set_label("Chop Probability %", fontsize=10)

    for d in range(7):
        for h in range(24):
            val = chop_grid_2d[d, h]
            if val > 0:
                ax1.text(h, d, f"{val:.0f}%", ha="center", va="center", color="white" if val > 45 else "black", fontsize=8)

    im2 = ax2.imshow(momo_grid_2d, cmap="YlGnBu", aspect="auto")
    ax2.set_title("XAU/USD (Gold) 7×24 Directional Momentum & Range Expansion % (IST)", fontsize=13, fontweight='bold', pad=10)
    ax2.set_yticks(range(7))
    ax2.set_yticklabels(DAYS_OF_WEEK, fontsize=10)
    ax2.set_xticks(range(24))
    ax2.set_xticklabels([f"{h}h" for h in range(24)], fontsize=10)
    ax2.set_xlabel("Hour of Day in Indian Standard Time (IST, UTC+05:30)", fontsize=11, labelpad=8)
    cbar2 = plt.colorbar(im2, ax=ax2, fraction=0.018, pad=0.02)
    cbar2.set_label("Momentum %", fontsize=10)

    for d in range(7):
        for h in range(24):
            val = momo_grid_2d[d, h]
            if val > 0:
                ax2.text(h, d, f"{val:.0f}%", ha="center", va="center", color="white" if val > 20 else "black", fontsize=8)

    plt.tight_layout()
    chart1_path = RESEARCH_DIR / "xau_ist_regime_heatmap.png"
    plt.savefig(chart1_path, dpi=180)
    plt.savefig(PUBLIC_DIR / "xau_ist_regime_heatmap.png", dpi=180)
    if BRAIN_DIR.exists():
        plt.savefig(BRAIN_DIR / "xau_ist_regime_heatmap.png", dpi=180)
    plt.close()

    # Plot Strategy Expectancy Profile
    fig, (ax3, ax4) = plt.subplots(2, 1, figsize=(16, 11))

    im3 = ax3.imshow(exp_grid_2d, cmap="RdYlGn", aspect="auto", vmin=-0.6, vmax=0.6)
    ax3.set_title("XAU/USD Institutional Radar Trap Expectancy (R per trade) by 7×24 IST Cell", fontsize=13, fontweight='bold', pad=10)
    ax3.set_yticks(range(7))
    ax3.set_yticklabels(DAYS_OF_WEEK, fontsize=10)
    ax3.set_xticks(range(24))
    ax3.set_xticklabels([f"{h}h" for h in range(24)], fontsize=10)
    cbar3 = plt.colorbar(im3, ax=ax3, fraction=0.018, pad=0.02)
    cbar3.set_label("Expectancy (R)", fontsize=10)

    # Plot DOW Expectancy Bar Chart
    d_names = [d["dow_name"] for d in dow_records]
    d_exps = [d["exp_r"] for d in dow_records]
    colors = ['#10b981' if e > 0 else '#ef4444' for e in d_exps]
    ax4.bar(d_names, d_exps, color=colors, alpha=0.85, edgecolor='black', width=0.55)
    ax4.axhline(0, color='black', lw=1, ls='--')
    ax4.set_title("XAU/USD Strategy Expectancy (R) by Day of the Week (IST)", fontsize=13, fontweight='bold', pad=10)
    ax4.set_ylabel("Expectancy (R)", fontsize=11)
    ax4.grid(True, alpha=0.25)
    for i, e in enumerate(d_exps):
        ax4.text(i, e + (0.02 if e >= 0 else -0.05), f"{e:+.2f}R", ha='center', fontweight='bold', fontsize=10)

    plt.tight_layout()
    chart2_path = RESEARCH_DIR / "xau_ist_strategy_expectancy_heatmap.png"
    plt.savefig(chart2_path, dpi=180)
    plt.savefig(PUBLIC_DIR / "xau_ist_strategy_expectancy_heatmap.png", dpi=180)
    if BRAIN_DIR.exists():
        plt.savefig(BRAIN_DIR / "xau_ist_strategy_expectancy_heatmap.png", dpi=180)
    plt.close()

    # Export JSON Analysis
    export_data = {
        'asset': 'XAUUSD (Spot Gold vs US Dollar)',
        'timezone': 'IST (UTC+05:30)',
        'total_trades': len(trades_df),
        'dow_summary': dow_records,
        'hourly_summary': hourly_records,
        'cell_matrix': cell_matrix
    }

    out_file = DATA_DIR / "ist_schedule_analysis.json"
    with open(out_file, "w") as f:
        json.dump(export_data, f, indent=2)

    with open(PUBLIC_DIR / "xau_ist_schedule.json", "w") as f:
        json.dump(export_data, f, indent=2)

    print(f"\n[SAVED] 7x24 IST Schedule Analysis -> {out_file}")
    print(f"[SAVED] Heatmap Charts -> {chart1_path} and {chart2_path}")


if __name__ == "__main__":
    main()
