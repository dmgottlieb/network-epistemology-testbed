// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../lib/rng.js');
const nets = require('../lib/networks.js');
const Z = require('../models/zollman.js');

function lnChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

test('log-odds update matches Bayes rule with binomial likelihoods', () => {
  const eps = 0.05, n = 20, prior = 0.6;
  for (const k of [0, 7, 10, 13, 20]) {
    const up = Math.exp(lnChoose(n, k) + k * Math.log(0.5 + eps) + (n - k) * Math.log(0.5 - eps));
    const down = Math.exp(lnChoose(n, k) + k * Math.log(0.5 - eps) + (n - k) * Math.log(0.5 + eps));
    const bayes = (prior * up) / (prior * up + (1 - prior) * down);
    const L = Math.log((0.5 + eps) / (0.5 - eps));
    const viaLogOdds = Z.sigmoid(Z.logit(prior) + (2 * k - n) * L);
    assert.ok(Math.abs(bayes - viaLogOdds) < 1e-12, `k=${k}`);
  }
});

test('an agent updates on its own and its neighbours’ results only', () => {
  const g = nets.make('line', 3);
  const run = Z.createRun({ graph: g, eps: 0.1, n: 10, priors: [0.9, 0.2, 0.2], seed: 1 });
  run.step();
  // only agent 0 tested B; agent 2 is not adjacent to 0, so it must not move
  assert.ok(run.lastK[0] >= 0);
  assert.equal(run.lastK[1], -1);
  assert.equal(run.lastK[2], -1);
  assert.equal(run.lastDelta[2], 0);
  assert.ok(Math.abs(run.lastDelta[0] - run.lastDelta[1]) < 1e-12);
});

test('everyone below 0.5 is an absorbing (incorrect) state', () => {
  const g = nets.make('complete', 5);
  const run = Z.createRun({ graph: g, eps: 0.01, n: 100, priors: [0.1, 0.2, 0.3, 0.4, 0.5], seed: 3 });
  assert.equal(run.status, 'incorrect');
  assert.equal(run.step(), false);
});

test('coupled evidence: same seed gives same results across networks', () => {
  const N = 8, seed = 42;
  const a = Z.createRun({ graph: nets.make('complete', N), eps: 0.01, n: 50, seed, priorLo: 0.6, priorHi: 0.9 });
  const b = Z.createRun({ graph: nets.make('cycle', N), eps: 0.01, n: 50, seed, priorLo: 0.6, priorHi: 0.9 });
  assert.deepEqual(Array.from(a.credences()), Array.from(b.credences()));
  a.step();
  b.step();
  assert.deepEqual(Array.from(a.lastK), Array.from(b.lastK)); // all tested B in round 0
});

test('network generators produce the expected edge counts', () => {
  assert.equal(nets.make('complete', 10).edges.length, 45);
  assert.equal(nets.make('cycle', 10).edges.length, 10);
  assert.equal(nets.make('wheel', 10).edges.length, 18);
  assert.equal(nets.make('star', 10).edges.length, 9);
  assert.equal(nets.make('line', 10).edges.length, 9);
  assert.equal(nets.make('ringLattice', 10, { k: 2 }).edges.length, 20);
  assert.equal(nets.make('grid', 9).edges.length, 12);
  assert.equal(nets.make('clusters', 9, { c: 3 }).edges.length, 9 + 3);
  for (const type of Object.keys(nets.TYPES)) {
    const g = nets.make(type, 12, {}, 5);
    assert.equal(nets.layout(g).length, 12, type);
  }
});

test('binomial sampler has the right mean and variance', () => {
  const rand = rng.mulberry32(9);
  for (const [n, p] of [[10, 0.3], [1000, 0.501]]) {
    let s = 0, s2 = 0;
    const R = 40000;
    for (let i = 0; i < R; i++) {
      const k = rng.binomial(rand, n, p);
      s += k;
      s2 += k * k;
    }
    const mean = s / R, v = s2 / R - mean * mean;
    assert.ok(Math.abs(mean - n * p) < 0.02 * n * p + 0.05, `mean ${mean}`);
    assert.ok(Math.abs(v / (n * p * (1 - p)) - 1) < 0.05, `var ${v}`);
  }
});

// Reproduces the headline number Weisberg reports for this model
// (N = 10, eps = 0.001, n = 1000): complete ~ .89, cycle ~ .97.
test('Zollman effect at N=10, eps=0.001, n=1000', () => {
  const runs = 3000;
  const rand = rng.mulberry32(2024);
  const rate = (type) => {
    const g = nets.make(type, 10);
    let ok = 0;
    for (let r = 0; r < runs; r++) {
      const res = Z.simulate(g, 0.001, 1000, Z.randomPriors(10, rand), rand, 20000);
      if (res.outcome === 'correct') ok++;
    }
    return ok / runs;
  };
  const complete = rate('complete');
  const cycle = rate('cycle');
  console.log(`  complete ${complete.toFixed(3)}  cycle ${cycle.toFixed(3)}`);
  assert.ok(Math.abs(complete - 0.89) < 0.03, `complete ${complete}`);
  assert.ok(Math.abs(cycle - 0.97) < 0.02, `cycle ${cycle}`);
  assert.ok(cycle > complete);
});
