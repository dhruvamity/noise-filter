import test from 'node:test';
import assert from 'node:assert/strict';

// Test percentile ranking logic
function rankPercentile(value, quantiles) {
  const PROBS = [10, 25, 50, 75, 90];
  if (!quantiles || quantiles.length === 0) return 50.0;

  const points = [];
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

function classifyRegime(act, pers, spec) {
  const isTrend =
    (act >= spec.activityHigh && pers >= spec.persistenceHigh) ||
    (pers >= spec.trendPersistenceExtended && act >= spec.trendActivityFloor);

  if (isTrend) return 'Trend';
  if (act >= spec.activityHigh && pers < spec.persistenceHigh) return 'Chop';
  if (pers >= spec.persistenceHigh && act < spec.activityHigh) return 'Grind';
  return 'Dead';
}

const SPEC = {
  version: 3,
  activityHigh: 50,
  persistenceHigh: 50,
  trendPersistenceExtended: 65,
  trendActivityFloor: 30,
};

test('Percentile interpolation matches quantiles', () => {
  const quantiles = [10, 20, 50, 80, 100];
  assert.equal(rankPercentile(10, quantiles), 10);
  assert.equal(rankPercentile(20, quantiles), 25);
  assert.equal(rankPercentile(50, quantiles), 50);
  assert.equal(rankPercentile(80, quantiles), 75);
  assert.equal(rankPercentile(100, quantiles), 90);

  // Interpolated midpoint between 20 and 50
  const mid = rankPercentile(35, quantiles);
  assert.equal(mid, 37.5);

  // Lower boundary
  assert.ok(rankPercentile(0, quantiles) >= 0);

  // Upper overshoot bounded at 100
  assert.equal(rankPercentile(500, quantiles), 100);
});

test('Regime classification matches RegimeSpec', () => {
  // Standard Trend: act >= 50, pers >= 50
  assert.equal(classifyRegime(70, 70, SPEC), 'Trend');

  // Extended Trend: pers >= 65, act >= 30
  assert.equal(classifyRegime(35, 70, SPEC), 'Trend');

  // Chop: act >= 50, pers < 50
  assert.equal(classifyRegime(70, 40, SPEC), 'Chop');

  // Grind: pers >= 50, act < 50 (and pers < 65 if act < 30)
  assert.equal(classifyRegime(40, 55, SPEC), 'Grind');
  assert.equal(classifyRegime(25, 55, SPEC), 'Grind');

  // Dead: act < 50, pers < 50
  assert.equal(classifyRegime(30, 30, SPEC), 'Dead');
  assert.equal(classifyRegime(10, 20, SPEC), 'Dead');
});
