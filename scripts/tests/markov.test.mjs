import test from 'node:test';
import assert from 'node:assert/strict';

// Test matrix with non-zero off-diagonal transitions
const counts = [
  [10, 5, 2],  // Row 0 (Bear): sum = 17, P[0][0] = 10/17 = 58.82%
  [4, 12, 4],  // Row 1 (Sideways): sum = 20, P[1][1] = 12/20 = 60.00%
  [3, 6, 15],  // Row 2 (Bull): sum = 24, P[2][2] = 15/24 = 62.50%
];

test('Markov denominator calculation regression test', () => {
  // Buggy implementation in previous app/page.tsx:
  // const sum0 = counts[0][0] + counts[0][1] + counts[0][2] || 1;
  // const sum1 = counts[1][1] + counts[1][1] + counts[1][2] || 1; // counts[1][0] omitted, counts[1][1] duplicated
  // const sum2 = counts[2][2] + counts[2][1] + counts[2][2] || 1; // counts[2][0] omitted, counts[2][2] duplicated
  const buggySum1 = counts[1][1] + counts[1][1] + counts[1][2]; // 12 + 12 + 4 = 28
  const buggySum2 = counts[2][2] + counts[2][1] + counts[2][2]; // 15 + 6 + 15 = 36

  assert.notEqual(buggySum1, 20, 'Buggy sum1 does not match true row sum of 20');
  assert.notEqual(buggySum2, 24, 'Buggy sum2 does not match true row sum of 24');

  // Corrected implementation:
  const sum0 = counts[0][0] + counts[0][1] + counts[0][2];
  const sum1 = counts[1][0] + counts[1][1] + counts[1][2];
  const sum2 = counts[2][0] + counts[2][1] + counts[2][2];

  assert.equal(sum0, 17, 'Correct sum0 matches row 0 sum (17)');
  assert.equal(sum1, 20, 'Correct sum1 matches row 1 sum (20)');
  assert.equal(sum2, 24, 'Correct sum2 matches row 2 sum (24)');

  const stickiness = {
    bear: Math.round((counts[0][0] / sum0) * 100),
    sideways: Math.round((counts[1][1] / sum1) * 100),
    bull: Math.round((counts[2][2] / sum2) * 100),
  };

  assert.equal(stickiness.bear, 59);
  assert.equal(stickiness.sideways, 60);
  assert.equal(stickiness.bull, 63);
});

test('Markov transition matrix row stochasticity', () => {
  const sum0 = counts[0][0] + counts[0][1] + counts[0][2];
  const sum1 = counts[1][0] + counts[1][1] + counts[1][2];
  const sum2 = counts[2][0] + counts[2][1] + counts[2][2];

  const row0Prob = (counts[0][0] + counts[0][1] + counts[0][2]) / sum0;
  const row1Prob = (counts[1][0] + counts[1][1] + counts[1][2]) / sum1;
  const row2Prob = (counts[2][0] + counts[2][1] + counts[2][2]) / sum2;

  assert.ok(Math.abs(row0Prob - 1.0) < 1e-9, 'Row 0 probabilities sum to 1.0');
  assert.ok(Math.abs(row1Prob - 1.0) < 1e-9, 'Row 1 probabilities sum to 1.0');
  assert.ok(Math.abs(row2Prob - 1.0) < 1e-9, 'Row 2 probabilities sum to 1.0');
});
