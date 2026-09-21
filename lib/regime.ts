import { Candle, RegimeState } from '../types/market';
import { RegimeSpec, BaselineTimeframe } from '../types/research';
import { getIstWeekdayAndHour } from './formatters';

const PROBS = [10, 25, 50, 75, 90];

export interface RawFeatures {
  rangeBp: number;
  persistence: number;
  direction: number;
}

/**
 * Calculates True Range and directional persistence matching Python's add_features() exactly.
 */
export function calculateFeatures(candles: Candle[], lookback: number): RawFeatures | null {
  if (candles.length <= lookback) return null;

  const window = candles.slice(-(lookback + 1));
  const current = window[window.length - 1];

  let trueRangeSum = 0;
  let absoluteMoveSum = 0;

  for (let i = 1; i <= lookback; i++) {
    const bar = window[i];
    const prevClose = window[i - 1].c;

    const tr = Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prevClose),
      Math.abs(bar.l - prevClose)
    );
    trueRangeSum += tr;
    absoluteMoveSum += Math.abs(bar.c - prevClose);
  }

  const rangeBp = (trueRangeSum / current.c) * 10000;
  const netMove = Math.abs(current.c - window[0].c);
  const persistence = absoluteMoveSum > 0 ? netMove / absoluteMoveSum : 0;
  const direction = Math.sign(current.c - window[0].c);

  return {
    rangeBp,
    persistence,
    direction,
  };
}

/**
 * Robust piecewise linear quantile interpolation matching scripts/analyze.py:local_percentile.
 */
export function rankPercentile(value: number, quantiles: number[]): number {
  if (!quantiles || quantiles.length === 0) return 50.0;

  const points: [number, number][] = [];
  for (let i = 0; i < quantiles.length; i++) {
    const x = quantiles[i];
    const p = PROBS[i];
    if (!Number.isFinite(x)) continue;
    if (points.length > 0 && points[points.length - 1][0] === x) {
      points[points.length - 1] = [x, p];
    } else {
      points.push([x, p]);
    }
  }

  if (points.length === 0) return 50.0;

  const first = points[0];
  const last = points[points.length - 1];

  if (value <= first[0]) {
    const denom = Math.max(first[0], 1e-6);
    return Math.max(0.0, (value / denom) * first[1]);
  }

  if (value >= last[0]) {
    const denom = Math.max(last[0], 1e-6);
    const overshoot = (value - last[0]) / denom;
    return Math.min(100.0, last[1] + overshoot * (100.0 - last[1]));
  }

  for (let i = 0; i < points.length; i++) {
    const [x, p] = points[i];
    if (value === x) return p;
    if (i > 0 && value < x) {
      const [leftX, leftP] = points[i - 1];
      return leftP + ((value - leftX) / (x - leftX)) * (p - leftP);
    }
  }

  return last[1];
}

/**
 * Score candle features against the fitted baseline for the candle's IST hour.
 */
export function scoreFeatures(
  features: RawFeatures,
  timestamp: number,
  baseline: BaselineTimeframe
): { activityPercentile: number; persistencePercentile: number } {
  const { weekday, hour } = getIstWeekdayAndHour(timestamp);
  const bucketKey = `${weekday}-${hour}`;
  const bucket = baseline.hourBaselines[bucketKey] || baseline.hourBaselines[`0-${hour}`];

  if (!bucket) {
    return { activityPercentile: 50, persistencePercentile: 50 };
  }

  const activityPercentile = rankPercentile(features.rangeBp, bucket.range);
  const persistencePercentile = rankPercentile(features.persistence, bucket.persistence);

  return {
    activityPercentile,
    persistencePercentile,
  };
}

/**
 * Canonical classification function consuming RegimeSpec.
 * Single source of truth across Python and TypeScript.
 */
export function classifyRegime(
  activityPercentile: number,
  persistencePercentile: number,
  spec: RegimeSpec
): RegimeState {
  const actHigh = spec.activityHigh ?? 50;
  const persHigh = spec.persistenceHigh ?? 50;
  const extPers = spec.trendPersistenceExtended ?? 65;
  const floorAct = spec.trendActivityFloor ?? 30;

  const isTrend =
    (activityPercentile >= actHigh && persistencePercentile >= persHigh) ||
    (persistencePercentile >= extPers && activityPercentile >= floorAct);

  if (isTrend) return 'Trend';
  if (activityPercentile >= actHigh && persistencePercentile < persHigh) return 'Chop';
  if (persistencePercentile >= persHigh && activityPercentile < actHigh) return 'Grind';
  return 'Dead';
}

export function getRegimeDescription(regime: RegimeState): string {
  switch (regime) {
    case 'Trend':
      return 'High activity and clean directional movement.';
    case 'Chop':
      return 'High activity but poor directional follow-through.';
    case 'Grind':
      return 'Directional movement with relatively low activity.';
    case 'Dead':
      return 'Low activity and weak directional follow-through.';
  }
}

export function getRegimeColors(regime: RegimeState): {
  color: string;
  bg: string;
  border: string;
} {
  switch (regime) {
    case 'Trend':
      return {
        color: '#10b981',
        bg: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.3)',
      };
    case 'Chop':
      return {
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.3)',
      };
    case 'Grind':
      return {
        color: '#38bdf8',
        bg: 'rgba(56, 189, 248, 0.12)',
        border: 'rgba(56, 189, 248, 0.3)',
      };
    case 'Dead':
      return {
        color: '#9ca3af',
        bg: 'rgba(156, 163, 175, 0.1)',
        border: 'rgba(156, 163, 175, 0.25)',
      };
  }
}
