// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../lib/rng.js');
const nets = require('../lib/networks.js');
const Z = require('../models/zollman.js');
const P = require('../models/polarization.js');

test('with m = 0 the polarization model is the Zollman model, run for run', () => {
  const g = nets.make('complete', 8);
  for (let seed = 1; seed < 30; seed++) {
    const a = Z.createRun({ graph: g, eps: 0.05, n: 20, seed, recordHistory: false });
    while (a.step());
    const b = P.createRun({ graph: g, eps: 0.05, n: 20, m: 0, seed, recordHistory: false });
    while (b.step());
    assert.equal(a.status, b.status);
    assert.equal(a.round, b.round);
    assert.ok(Math.abs(a.credence(2) - b.credence(2)) < 1e-6);
  }
});

test('ignore version is a blend of the Bayesian posterior and the prior', () => {
  const n = 20, k = 14, p = 0.6, c = 0.3, d = 0.4, m = 1.5;
  const pEH = P.binomPmf(n, k, p), pEnH = P.binomPmf(n, k, 1 - p);
  const post = (c * pEH) / (c * pEH + (1 - c) * pEnH);
  const w = Math.min(1, d * m);
  assert.ok(Math.abs(P.jeffrey(c, pEH, pEnH, d, m, false) - ((1 - w) * post + w * c)) < 1e-12);
  // d m >= 1: ignored entirely; anti-updating moves against the evidence
  assert.ok(Math.abs(P.jeffrey(c, pEH, pEnH, 0.9, 2, false) - c) < 1e-12);
  assert.ok(P.jeffrey(c, pEH, pEnH, 0.9, 2, true) < c);
});

test('stable polarization is classified as in the paper', () => {
  assert.equal(P.classify([0.995, 0.999, 0.2, 0.1], 2, 0.99), 'polarized'); // gaps >= 0.5
  assert.equal(P.classify([0.995, 0.999, 0.6, 0.1], 2, 0.99), 'running'); // 0.6 still tests B
  assert.equal(P.classify([0.995, 0.999, 0.45, 0.1], 1.5, 0.99), 'running'); // 0.45 within reach at m = 1.5
  assert.equal(P.classify([0.3, 0.2], 2, 0.99), 'incorrect');
});

// O'Connor & Weatherall Fig. 2 (n = 50, pB = .7, complete network):
// about 60% of runs polarize at m = 1.5 and about 90% at m = 2 for 10 agents.
test('reproduces the polarization rates of O&W Figure 2', () => {
  const g = nets.make('complete', 10);
  const rate = (m, order) => {
    const rand = rng.mulberry32(77);
    let pol = 0;
    const runs = 1500;
    for (let r = 0; r < runs; r++) {
      if (P.simulate(g, 0.2, 50, m, false, order, Z.randomPriors(10, rand), rand, 20000).outcome === 'polarized') pol++;
    }
    return pol / runs;
  };
  const a = rate(1.5, 'sequential'), b = rate(2, 'sequential'), c = rate(1.5, 'simultaneous');
  console.log(`  m=1.5 ${a.toFixed(3)}  m=2 ${b.toFixed(3)}  simultaneous m=1.5 ${c.toFixed(3)}`);
  assert.ok(Math.abs(a - 0.64) < 0.06, `m=1.5 ${a}`);
  assert.ok(Math.abs(b - 0.92) < 0.04, `m=2 ${b}`);
  assert.ok(c < a - 0.3, 'simultaneous updating polarizes much less');
});

test('exploration: x = 0 changes nothing; x > 0 removes the absorbing trap', () => {
  const g = nets.make('complete', 6);
  const a = Z.createRun({ graph: g, eps: 0.01, n: 50, seed: 5, recordHistory: false });
  const b = Z.createRun({ graph: g, eps: 0.01, n: 50, seed: 5, explore: 0, recordHistory: false });
  while (a.step());
  while (b.step());
  assert.equal(a.round, b.round);
  const trapped = Z.createRun({ graph: g, eps: 0.05, n: 100, priors: [0.1, 0.2, 0.3, 0.2, 0.1, 0.4], seed: 9, explore: 0.2, maxRounds: 5000 });
  assert.equal(trapped.status, 'running');
  while (trapped.step());
  assert.equal(trapped.status, 'correct');
  assert.ok(trapped.everTrapped && trapped.explorations > 0);
});
