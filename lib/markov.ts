import { Candle, Interval } from '../types/market';

export type MarkovStateName = 'BULL' | 'BEAR' | 'SIDEWAYS';
export type MarkovGate = 'LONG_PERMITTED' | 'SHORT_PERMITTED' | 'CHOP_VETO';

export interface MarkovInfo {
  timeframe: Interval;
  currentState: MarkovStateName;
  strideSignal: number;
  transitionMatrix: number[][]; // Row-normalized probabilities
  transitionCounts: number[][]; // Raw counts 3x3
  stickiness: {
    bear: number;
    sideways: number;
    bull: number;
  };
  gate: MarkovGate;
  pBull: number;
  pBear: number;
  pSideways: number;
}

const MARKOV_THRESHOLDS: Record<Interval, number> = {
  '5m': 0.0065,  // 0.65%
  '15m': 0.0105, // 1.05%
  '1h': 0.0210,  // 2.10%
};

/**
 * Computes empirical 3-state Markov transition dynamics with non-overlapping stride sampling.
 * Corrected mathematical definition:
 * Row sum i = Sum_{j=0..2} counts[i][j]
 * Stickiness_i = counts[i][i] / row_sum_i
 */
export function computeMarkov(
  candles: Candle[],
  interval: Interval,
  window = 20
): MarkovInfo | null {
  if (candles.length < window + 2) return null;

  const thresh = MARKOV_THRESHOLDS[interval] ?? 0.01;
  const states: number[] = [];

  for (let i = window; i < candles.length; i++) {
    const cNow = candles[i].c;
    const cPrev = candles[i - window].c;
    const ret = (cNow - cPrev) / cPrev;
    if (ret >= thresh) states.push(2);       // BULL
    else if (ret <= -thresh) states.push(0); // BEAR
    else states.push(1);                     // SIDEWAYS
  }

  if (states.length === 0) return null;

  const counts = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  // Non-overlapping stride transitions
  for (let i = 0; i < states.length - window; i += window) {
    const s1 = states[i];
    const s2 = states[i + window];
    counts[s1][s2]++;
  }

  const curr = states[states.length - 1];
  const currName: MarkovStateName = curr === 2 ? 'BULL' : curr === 0 ? 'BEAR' : 'SIDEWAYS';

  const rowSum = counts[curr][0] + counts[curr][1] + counts[curr][2];
  const pBull = rowSum > 0 ? counts[curr][2] / rowSum : 0.333;
  const pBear = rowSum > 0 ? counts[curr][0] / rowSum : 0.333;
  const pSideways = rowSum > 0 ? counts[curr][1] / rowSum : 0.333;
  const strideSignal = pBull - pBear;

  // Mathematically correct row sums: Sum of row i = counts[i][0] + counts[i][1] + counts[i][2]
  const sum0 = counts[0][0] + counts[0][1] + counts[0][2] || 1;
  const sum1 = counts[1][0] + counts[1][1] + counts[1][2] || 1;
  const sum2 = counts[2][0] + counts[2][1] + counts[2][2] || 1;

  const stickiness = {
    bear: Math.round((counts[0][0] / sum0) * 100),
    sideways: Math.round((counts[1][1] / sum1) * 100),
    bull: Math.round((counts[2][2] / sum2) * 100),
  };

  const transitionMatrix = [
    [counts[0][0] / sum0, counts[0][1] / sum0, counts[0][2] / sum0],
    [counts[1][0] / sum1, counts[1][1] / sum1, counts[1][2] / sum1],
    [counts[2][0] / sum2, counts[2][1] / sum2, counts[2][2] / sum2],
  ];

  let gate: MarkovGate = 'CHOP_VETO';
  if (strideSignal > 0.03) gate = 'LONG_PERMITTED';
  else if (strideSignal < -0.03) gate = 'SHORT_PERMITTED';

  return {
    timeframe: interval,
    currentState: currName,
    strideSignal,
    transitionMatrix,
    transitionCounts: counts,
    stickiness,
    gate,
    pBull,
    pBear,
    pSideways,
  };
}
