// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const rng = require('../lib/rng.js');
const nets = require('../lib/networks.js');
const KZ = require('../models/kummerfeld-zollman.js');

// Kummerfeld & Zollman (2016) Fig. 6, 8 agents, 50 rounds:
// complete ~0.41 at eps = 0 and ~0.65 at eps = 0.18; ring ~0.54 at eps = 0.
test('reproduces the endpoints of Kummerfeld & Zollman Figure 6', () => {
  const perf = (type, eps) => KZ.performance(nets.make(type, 8), eps, 15000, rng.mulberry32(42)).mean;
  const c0 = perf('complete', 0), c18 = perf('complete', 0.18), r0 = perf('cycle', 0), r48 = perf('cycle', 0.48);
  console.log(`  complete eps0 ${c0.toFixed(3)} eps.18 ${c18.toFixed(3)}  ring eps0 ${r0.toFixed(3)} eps.48 ${r48.toFixed(3)}`);
  assert.ok(Math.abs(c0 - 0.41) < 0.025, `complete eps 0: ${c0}`);
  assert.ok(Math.abs(c18 - 0.655) < 0.02, `complete eps .18: ${c18}`);
  assert.ok(Math.abs(r0 - 0.54) < 0.025, `ring eps 0: ${r0}`);
  assert.ok(Math.abs(r48 - 0.52) < 0.02, `ring eps .48: ${r48}`);
  assert.ok(r0 > c0 && c18 > perf('cycle', 0.18), 'ring wins at low eps, complete at high eps');
});
