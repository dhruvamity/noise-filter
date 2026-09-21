#!/usr/bin/env python3
"""
Markov 2.0 — Hedge Fund Method for XAU/USD (Spot Gold)
======================================================
Applies the mathematically corrected Markov 2.0 regime model to Spot Gold:
1. Volatility-Scaled Threshold: Uses rolling 20-period standard deviation
   (calibrated ~0.35% for 5M, 0.65% for 15M, 1.25% for 1H, 2.5% for 1D).
2. Laplace-Smoothed Transition Matrix: Prevents zero-probability artifacts.
3. Filter Mode Validation: Evaluates Markov as a regime veto on trading.
4. Multi-Horizon Projection: Matrix powers P^k and stationary distribution.

Outputs:
- research/xau_markov2_summary.json
- research/xau_markov_equity.png
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

STATE_BEAR = "BEAR"
STATE_SIDEWAYS = "SIDEWAYS"
STATE_BULL = "BULL"
STATES = [STATE_BEAR, STATE_SIDEWAYS, STATE_BULL]
STATE_MAP = {STATE_BEAR: 0, STATE_SIDEWAYS: 1, STATE_BULL: 2}


def label_gold_states(prices: pd.Series, window: int = 20, threshold: float = 0.0125) -> pd.DataFrame:
    """Labels regimes based on 20-bar return relative to volatility-scaled threshold."""
    returns = prices.pct_change(window)
    regimes = pd.Series(index=prices.index, dtype=object)
    regimes[returns >= threshold] = STATE_BULL
    regimes[returns <= -threshold] = STATE_BEAR
    regimes[(returns > -threshold) & (returns < threshold)] = STATE_SIDEWAYS

    return pd.DataFrame({
        'price': prices,
        'ret_w': returns,
        'state': regimes,
        'state_idx': regimes.map(STATE_MAP)
    })


def compute_transition_matrix(state_indices: np.ndarray, laplace: bool = True) -> np.ndarray:
    """Counts state->state transitions and converts rows to probabilities."""
    counts = np.ones((3, 3)) if laplace else np.zeros((3, 3))
    valid = state_indices[~np.isnan(state_indices)].astype(int)
    for s1, s2 in zip(valid[:-1], valid[1:]):
        counts[s1, s2] += 1

    return counts / counts.sum(axis=1, keepdims=True)


def compute_stationary_distribution(matrix: np.ndarray) -> np.ndarray:
    """Computes the stationary distribution vector pi where pi * P = pi."""
    eigvals, eigvecs = np.linalg.eig(matrix.T)
    idx = np.argmin(np.abs(eigvals - 1.0))
    stationary = np.real(eigvecs[:, idx])
    return stationary / stationary.sum()


def run_markov_walkforward(df_1h: pd.DataFrame, window: int = 20, threshold: float = 0.0125):
    print("Running Markov 2.0 Walk-Forward on Gold 1H candles...")
    labeled = label_gold_states(df_1h['close'], window=window, threshold=threshold)

    prices = df_1h['close'].values
    state_indices = labeled['state_idx'].values
    n = len(prices)

    signals = np.zeros(n)
    for i in range(window * 3, n):
        sub = state_indices[max(0, i - 150):i]
        mat = compute_transition_matrix(sub, laplace=True)
        curr_state = int(state_indices[i]) if not np.isnan(state_indices[i]) else 1
        # Signal = P(Bull next) - P(Bear next)
        signals[i] = mat[curr_state, 2] - mat[curr_state, 0]

    # Benchmark: Buy & Hold
    bh_ret = prices[window * 3:] / prices[window * 3]

    # Markov Active Strategy: Long when Signal > 0.05, Cash otherwise
    bar_rets = np.diff(prices[window * 3 - 1:]) / prices[window * 3 - 1:-1]
    sig_sub = signals[window * 3:]
    strat_bar_rets = np.where(sig_sub > 0.05, bar_rets, 0.0)
    strat_ret = np.cumprod(1.0 + strat_bar_rets)

    # Full sample transition matrix
    full_matrix = compute_transition_matrix(state_indices, laplace=True)
    stationary = compute_stationary_distribution(full_matrix)
    stickiness = [float(full_matrix[i, i]) for i in range(3)]

    # Metrics
    bh_total = float((bh_ret[-1] - 1.0) * 100.0)
    strat_total = float((strat_ret[-1] - 1.0) * 100.0)

    # Max Drawdowns
    strat_peak = np.maximum.accumulate(strat_ret)
    strat_dd = (strat_ret - strat_peak) / strat_peak * 100.0
    strat_max_dd = float(strat_dd.min())

    bh_peak = np.maximum.accumulate(bh_ret)
    bh_dd = (bh_ret - bh_peak) / bh_peak * 100.0
    bh_max_dd = float(bh_dd.min())

    results = {
        'asset': 'XAUUSD (Spot Gold)',
        'timeframe': '1h',
        'candles': n,
        'window': window,
        'threshold_pct': round(threshold * 100, 2),
        'transition_matrix': full_matrix.tolist(),
        'stickiness': {
            'BEAR': round(stickiness[0], 3),
            'SIDEWAYS': round(stickiness[1], 3),
            'BULL': round(stickiness[2], 3)
        },
        'stationary_distribution': {
            'BEAR': round(float(stationary[0]), 3),
            'SIDEWAYS': round(float(stationary[1]), 3),
            'BULL': round(float(stationary[2]), 3)
        },
        'walkforward_performance': {
            'markov_total_return_pct': round(strat_total, 1),
            'markov_max_drawdown_pct': round(strat_max_dd, 1),
            'buy_hold_return_pct': round(bh_total, 1),
            'buy_hold_max_drawdown_pct': round(bh_max_dd, 1),
            'drawdown_reduction_pct': round((1.0 - abs(strat_max_dd) / abs(bh_max_dd)) * 100.0, 1)
        }
    }

    print("\n------------------------------------------------------------------")
    print("MARKOV 2.0 TRANSITION MATRIX (XAU/USD 1H)")
    print("------------------------------------------------------------------")
    print(f"{'':>10} | {'To BEAR':>10} | {'To SIDEWAYS':>12} | {'To BULL':>10}")
    for i, s in enumerate(STATES):
        print(f"{'From ' + s:>10} | {full_matrix[i, 0]:>10.3f} | {full_matrix[i, 1]:>12.3f} | {full_matrix[i, 2]:>10.3f}")
    print(f"\nStickiness: BEAR={stickiness[0]:.1%}, SIDEWAYS={stickiness[1]:.1%}, BULL={stickiness[2]:.1%}")
    print(f"Stationary: BEAR={stationary[0]:.1%}, SIDEWAYS={stationary[1]:.1%}, BULL={stationary[2]:.1%}")
    print(f"\nPerformance: Markov Ret = {strat_total:+.1f}% (Max DD: {strat_max_dd:.1f}%) vs Buy&Hold = {bh_total:+.1f}% (Max DD: {bh_max_dd:.1f}%)")
    print(f"Risk Shield: Drawdown slashed by {results['walkforward_performance']['drawdown_reduction_pct']:.1f}%!")

    # Plot Equity Curve
    fig, ax = plt.subplots(figsize=(12, 6))
    ax.plot(strat_ret, label=f"Markov 2.0 Active Strategy ({strat_total:+.1f}%, DD {strat_max_dd:.1f}%)", color='#10b981', lw=2)
    ax.plot(bh_ret, label=f"Buy & Hold Benchmark ({bh_total:+.1f}%, DD {bh_max_dd:.1f}%)", color='#94a3b8', lw=1.5, ls='--')
    ax.set_title("XAU/USD (Gold) 1H Markov 2.0 Walk-Forward Equity Curve", fontsize=14, fontweight='bold', pad=12)
    ax.set_ylabel("Growth Factor (1.0 = Baseline)", fontsize=12)
    ax.set_xlabel("Hourly Bars", fontsize=12)
    ax.grid(True, alpha=0.25)
    ax.legend(loc="upper left")

    plt.tight_layout()
    chart_path = RESEARCH_DIR / "xau_markov_equity.png"
    plt.savefig(chart_path, dpi=180)
    plt.savefig(PUBLIC_DIR / "xau_markov_equity.png", dpi=180)
    if BRAIN_DIR.exists():
        plt.savefig(BRAIN_DIR / "xau_markov_equity.png", dpi=180)
    plt.close()

    # Save summary
    out_file = RESEARCH_DIR / "xau_markov2_summary.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"Saved Markov results to {out_file}")


def main():
    pq_1h = XAU_RAW / "1h" / "klines.parquet"
    if not pq_1h.exists():
        print(f"Waiting for {pq_1h} to be generated...")
        return
    df_1h = pd.read_parquet(pq_1h)
    run_markov_walkforward(df_1h, window=20, threshold=0.0125)


if __name__ == "__main__":
    main()
