// Run with:  node --test tests/
// Checks for the beta-belief, conformity, propaganda and free-rider models
// against numbers reported in the papers.
const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../lib/rng.js');
const nets = require('../lib/networks.js');
const BB = require('../models/beta-bandit.js');
const PR = require('../models/propaganda.js');
const KZ = require('../models/kummerfeld-zollman.js');

test('beta updating adds successes and failures to the pulled arm', () => {
  const g = nets.make('line', 2);
  const run = BB.createRun({ graph: g, probs: [0.5, 0.6], n: 10, k: 0, priorMax: 4, seed: 3 });
  const before = [run.a[0], run.b[0], run.a[1], run.b[1], run.a[2], run.b[2], run.a[3], run.b[3]];
  run.step();
  let added = 0;
  for (let q = 0; q < 4; q++) added += run.a[q] - before[2 * q] + (run.b[q] - before[2 * q + 1]);
  assert.equal(added, 40); // each of 2 agents sees 2 batches of 10 pulls
});

// Zollman (2010) Fig. 3: 7 agents, priors in [0, 4], methods .5 vs .499,
// 1,000 pulls a round, 10,000 rounds: cycle ~0.85, complete ~0.6.
test('Zollman 2010: the cycle beats the complete network', () => {
  const rate = (type) => {
    const rand = rng.mulberry32(21);
    let ok = 0;
    for (let r = 0; r < 150; r++) if (BB.simulate(nets.make(type, 7), [0.499, 0.5], 1000, 0, 4, rand, 10000).learned) ok++;
    return ok / 150;
  };
  const c = rate('cycle'), k = rate('complete');
  console.log(`  cycle ${c.toFixed(3)} complete ${k.toFixed(3)}`);
  assert.ok(Math.abs(c - 0.85) < 0.08 && Math.abs(k - 0.6) < 0.09 && c > k);
});

// Weatherall & O'Connor: with conformity (k = .1, pB = .55, n = 5, N = 10)
// cycles never polarize stably; two cliques joined by one link often do.
test('conformity: no stable polarization on a cycle, frequent on two cliques', () => {
  const count = (type) => {
    const rand = rng.mulberry32(5);
    const o = {};
    for (let r = 0; r < 120; r++) {
      const res = BB.simulate(nets.make(type, 10, { c: 2 }), [0.5, 0.55], 5, 0.1, 4, rand, 4000);
      o[res.kind] = (o[res.kind] || 0) + 1;
    }
    return o;
  };
  const cyc = count('cycle'), clq = count('clusters');
  console.log('  cycle', JSON.stringify(cyc), ' cliques', JSON.stringify(clq));
  assert.ok((cyc.polarized || 0) <= 2);
  assert.ok((clq.polarized || 0) / 120 > 0.25);
});

// Weatherall, O'Connor & Bruner: policy makers listening to one of 20
// scientists end near .87 credence without a propagandist, near 0 with one.
test('propaganda: selective sharing flips the public, not the science', () => {
  const g = nets.make('cycle', 20);
  const mean = (mode) => {
    const rand = rng.mulberry32(9);
    let s = 0, c = 0;
    for (let r = 0; r < 300; r++) {
      const res = PR.simulate(g, { eps: 0.05, n: 10, listen: 1, mode }, rand);
      if (res.outcome === 'correct') { s += res.pmMean; c++; }
    }
    return s / c;
  };
  const none = mean('none'), sel = mean('selective');
  console.log(`  no propagandist ${none.toFixed(3)}  selective sharing ${sel.toFixed(3)}`);
  assert.ok(Math.abs(none - 0.87) < 0.06);
  assert.ok(sel < 0.02);
});

test('propaganda: the same seed gives identical science with and without a propagandist', () => {
  const g = nets.make('complete', 6);
  const a = PR.createRun({ graph: g, eps: 0.05, n: 10, seed: 4, mode: 'none', listen: 3 });
  const b = PR.createRun({ graph: g, eps: 0.05, n: 10, seed: 4, mode: 'selective', listen: 3 });
  for (let t = 0; t < 5; t++) { a.step(); b.step(); }
  assert.deepEqual(Array.from(a.sci.lastK), Array.from(b.sci.lastK));
  assert.ok(b.pmMean() < a.pmMean());
});

// Kummerfeld & Zollman Fig. 2: symmetric Nash epsilon for two agents ~0.24.
test('free-rider game: two-agent best response crosses x = y near 0.24', () => {
  const g = nets.make('complete', 2);
  const EH = [];
  for (let e = 0; e <= 0.5001; e += 0.02) EH.push(+e.toFixed(2));
  const br = (eg) => KZ.bestResponse(EH, Array.from(KZ.heroPayoffs(g, eg, EH, 6000, rng.mulberry32(3))));
  const b20 = br(0.2), b30 = br(0.3);
  // crossing of the line through (0.2, b20) and (0.3, b30) with y = x
  const slope = (b30 - b20) / 0.1;
  const nash = (b20 - slope * 0.2) / (1 - slope);
  console.log(`  BR(.2) ${b20.toFixed(3)} BR(.3) ${b30.toFixed(3)} Nash ${nash.toFixed(3)}`);
  assert.ok(Math.abs(nash - 0.24) < 0.05);
});

test('free-rider episode stepper matches the fast path', () => {
  const g = nets.make('cycle', 6);
  const noise = KZ.makeNoise(6, 50, rng.mulberry32(8));
  const eps = (i) => (i === 0 ? 0.05 : 0.2);
  const fast = KZ.playWithNoise(g, eps, noise, KZ.DEFAULTS);
  const ep = KZ.createEpisode(g, eps, noise);
  while (ep.step());
  assert.deepEqual(Array.from(ep.pulls), Array.from(fast));
});

// Pozzi (2025), 5 agents, 100 problems of 100 rounds: credulous without
// vigilance ~0.64; sceptical with full vigilance ~0.78.
test('trust: reproduces Pozzi’s small-group results', () => {
  const TR = require('../models/trust.js');
  const mean = (opts) => {
    const rand = rng.mulberry32(31);
    let s = 0;
    for (let r = 0; r < 300; r++) { const k = TR.simulate(Object.assign({ N: 5 }, opts), rand); s += k[k.length - 1]; }
    return s / 300;
  };
  const cred = mean({ scenario: 'credulous', V: 0 }), scep = mean({ scenario: 'sceptical', V: 1 });
  console.log(`  credulous V=0 ${cred.toFixed(3)}  sceptical V=1 ${scep.toFixed(3)}`);
  assert.ok(Math.abs(cred - 0.64) < 0.04);
  assert.ok(Math.abs(scep - 0.78) < 0.04);
});

test('trust urn samples in proportion to weights', () => {
  const TR = require('../models/trust.js');
  const u = new TR.Urn(4);
  u.reset();
  u.add(2, 6); // weights 1, 1, 7, 1
  const counts = [0, 0, 0, 0];
  const rand = rng.mulberry32(2);
  for (let i = 0; i < 20000; i++) counts[u.sample(rand())]++;
  assert.ok(Math.abs(counts[2] / 20000 - 0.7) < 0.02 && Math.abs(counts[0] / 20000 - 0.1) < 0.01);
});
