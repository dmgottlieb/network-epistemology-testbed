#!/usr/bin/env node
/*
 * Precompute the experiment presets for diversity.html, conformity.html and
 * propaganda.html.
 *   node tools/precompute-models.js [diversity|conformity|propaganda]
 * writes data/<page>-presets.js
 */
const fs = require('fs');
const path = require('path');
const rng = require('../lib/rng.js');
const NETS = require('../lib/networks.js');
const SW = require('../lib/sweep.js');
const EX = require('../models/experiments.js');
const BB = require('../models/beta-bandit.js');

const R = (env, def) => +process.env[env] || def;

const PAGES = {
  diversity: {
    fn: EX.diversity,
    base: { N: 7, net: 'cycle', priorMax: 4, gap: 0.001, n: 1000, rounds: 10000 },
    presets: {
      fig3: { title: 'Sparse networks learn better (Fig. 3)', metric: 'learned', vary: 'N', xs: [3, 4, 5, 6, 7, 8, 9, 10, 11], seriesBy: 'net', series: ['cycle', 'wheel', 'complete'], fixed: {}, runs: R('DIV_RUNS', 600),
        note: 'Priors in [0, 4], methods succeed 50% and 49.9% of the time, 1,000 pulls a round, judged at round 10,000. Zollman’s Fig. 3: cycle rises from about 0.65 (4 agents) to 0.94 (11); complete stays near 0.55–0.61.' },
      fig6short: { title: 'Dogmatism with a shorter horizon', metric: 'learned', vary: 'priorMax', xs: [4, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000], seriesBy: 'net', series: ['cycle', 'wheel', 'complete'], fixed: { N: 7, rounds: 3000 }, runs: R('DIV_RUNS', 600),
        note: 'The same as Fig. 6 but judged at round 3,000. Now dogmatic cycles run out of time and the order reverses: complete best, cycle worst, as Zollman reports. How strong the reversal is depends on the horizon, which the paper leaves implicit.' },
      fig6: { title: 'Dogmatism helps the complete network (Fig. 6)', metric: 'learned', vary: 'priorMax', xs: [4, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000], seriesBy: 'net', series: ['cycle', 'wheel', 'complete'], fixed: { N: 7 }, runs: R('DIV_RUNS', 600),
        note: '7 agents, judged at round 10,000. Dogmatism lifts the complete network from about 0.57 to 0.99, as in Zollman’s Fig. 6. His cycle then falls to about 0.77 at 10,000; ours does not, because our dogmatists still overcome their priors in time. See the shorter-horizon preset.' },
    },
  },
  conformity: {
    fn: EX.conformity,
    base: { N: 10, net: 'randomConnected', k: 0.1, pB: 0.55, n: 5, arms: 2, rounds: 10000 },
    presets: {
      fig5: { title: 'More conformity, worse outcomes (Fig. 5)', metric: 'rightAction', vary: 'k', xs: [0, 0.0005, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1], seriesBy: 'net', series: ['randomConnected'], fixed: {}, runs: R('CONF_RUNS', 600),
        note: 'Random connected networks of 10, pB = .55, n = 5. The paper: 96% correct at k = .0005, 55% at k = .1.' },
      networks: { title: 'Network structure under conformity (Figs. 8–9)', metric: 'rightAction', vary: 'net', xs: ['randomConnected', 'clusters', 'complete', 'cycle', 'wheel'], seriesBy: 'k', series: [0.0005, 0.1], fixed: {}, runs: R('CONF_RUNS', 600),
        note: 'At k = .1 the paper reports the cycle taking the better action 87% of the time and the wheel 57%; two cliques polarize often (25–50%).' },
      arms: { title: 'More options, worse (Fig. 6)', metric: 'rightAction', vary: 'arms', xs: [2, 3, 4, 5], seriesBy: 'k', series: [0, 0.5], fixed: {}, runs: R('CONF_RUNS', 600),
        note: 'One better arm (pB = .55) among arms paying .5. The paper: with k = .5 about 34%, 25% and 19% correct for 3, 4 and 5 arms, roughly chance; with k = 0 above 88% even with five.' },
      payoffs: { title: 'When the world pushes back (Fig. 7)', metric: 'rightAction', vary: 'pB', xs: [0.51, 0.55, 0.6, 0.7], seriesBy: 'k', series: [0.01, 0.1, 0.5], fixed: { net: 'complete' }, runs: R('CONF_RUNS', 600),
        note: 'Complete networks of 10. The bigger the payoff difference, the less conformity matters.' },
    },
  },
  propaganda: {
    fn: EX.propaganda,
    base: { K: 20, net: 'cycle', eps: 0.05, n: 10, listenShare: 0.5, mode: 'selective', resources: 50, studyN: 10, doubleCount: 'yes' },
    presets: {
      fig2: { title: 'Listening to more scientists (Fig. 2)', metric: 'pm', vary: 'listenShare', xs: [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1], seriesBy: 'mode', series: ['none', 'selective'], fixed: {}, runs: R('PROP_RUNS', 1000),
        note: 'Cycle of 20 scientists, n = 10, pB = .55. Mean policy-maker credence in B when the scientists reach a correct consensus.' },
      fig3: { title: 'Clearer evidence (Fig. 3)', metric: 'pm', vary: 'eps', xs: [0.01, 0.05, 0.075, 0.1, 0.2], seriesBy: 'mode', series: ['none', 'selective'], fixed: { listenShare: 0.5 }, runs: R('PROP_RUNS', 1000),
        note: 'Cycle of 20, policy makers hear half the scientists, n = 10.' },
      fig4: { title: 'Bigger studies (Fig. 4)', metric: 'pm', vary: 'n', xs: [1, 2, 5, 10, 20, 50, 100, 500, 1000], seriesBy: 'mode', series: ['none', 'selective'], fixed: { K: 10, net: 'complete', listenShare: 0.9 }, runs: R('PROP_RUNS', 1000),
        note: 'Complete network of 10, policy makers hear 90%, pB = .55. Paper: roughly 0 at n = 1, 0.43 at n = 10, 0.88 at n = 50, 1 by n = 500.' },
      fig5: { title: 'Slow science helps the propagandist (Fig. 5)', metric: 'pm', vary: 'listenShare', xs: [0.1, 0.2, 0.4, 0.6, 0.8, 1], seriesBy: 'net', series: ['cycle', 'complete'], fixed: { eps: 0.05, n: 5 }, runs: R('PROP_RUNS', 1000),
        note: 'Hard problem (pB = .55, n = 5): the faster complete network gives the propagandist less time. Try pB = .7 and n = 20 to see the cycle win instead.' },
      fig6: { title: 'A funded propagandist (Fig. 6)', metric: 'pm', vary: 'resources', xs: [10, 20, 50, 100], seriesBy: 'net', series: ['complete', 'cycle'], fixed: { K: 10, mode: 'production', listenShare: 0.5, studyN: 10 }, runs: R('PROP_RUNS', 1000),
        note: 'The propagandist runs its own honest studies of size 10 and publishes only those favouring A. Paper: complete falls from 0.67 to 0.1, cycle from 0.95 to 0.02 as resources go from 10 to 100 pulls.' },
      fig7: { title: 'Many small studies (Fig. 7)', metric: 'pm', vary: 'studyN', xs: [1, 2, 5, 10, 20, 50], seriesBy: 'net', series: ['complete', 'cycle'], fixed: { K: 10, mode: 'production', listenShare: 1, resources: 50 }, runs: R('PROP_RUNS', 1000),
        note: 'Same 50 pulls a round, split into studies of different size. Smaller studies give more spurious results to publish.' },
      journalist: { title: '“Fair” reporting (Fig. 9)', metric: 'pm', vary: 'n', xs: [5, 10, 20], seriesBy: 'mode', series: ['all', 'random', 'fair'], fixed: { K: 10, net: 'complete', eps: 0.1 }, runs: R('PROP_RUNS', 1000),
        note: 'Policy makers hear science only through a journalist. Sharing one result for each side every round slows them down compared with two random results or everything.' },
    },
  },
};

PAGES.trust = {
  fn: EX.trust,
  base: { N: 100, scenario: 'credulous', V: 1, turnover: 0, problems: 100, rounds: 100 },
  presets: {
    credulous: { title: 'Credulous agents', metric: 'last', vary: 'V', xs: [0, 0.25, 0.5, 0.75, 1], seriesBy: 'N', series: [5, 50, 100], fixed: {}, runs: R('TRUST_RUNS', 150),
      note: 'Agents always reinforce a source that was right; vigilance V is how often they refuse to reinforce one that was wrong. Pozzi: 0.64 (5 agents) and 0.24 (100) with no vigilance; 0.85 for 100 with full vigilance.' },
    sceptical: { title: 'Sceptical agents', metric: 'last', vary: 'V', xs: [0, 0.25, 0.5, 0.75, 1], seriesBy: 'N', series: [5, 50, 100], fixed: { scenario: 'sceptical' }, runs: R('TRUST_RUNS', 150),
      note: 'Agents never reinforce a source that was wrong; vigilance V is how often they do reinforce one that was right. Pozzi: 0.52 (5) and 0.61 (100) with V = 0; 0.78 and 0.86 with V = 1.' },
    turnover: { title: 'With turnover', metric: 'last', vary: 'V', xs: [0, 0.25, 0.5, 0.75, 1], seriesBy: 'scenario', series: ['credulous', 'sceptical'], fixed: { turnover: 0.05 }, runs: R('TRUST_RUNS', 150),
      note: '100 agents; before each problem every agent is replaced with probability 0.05. Pozzi: in sceptical networks partial vigilance (0.79 at V = 0.5) does about as well as full (0.74).' },
  },
};
const TR = require('../models/trust.js');

const only = process.argv[2];
const onlyPreset = process.argv[3];
for (const [page, def] of Object.entries(PAGES)) {
  if (only && only !== page) continue;
  const t0 = Date.now();
  const file = path.join(__dirname, '..', 'data', `${page}-presets.js`);
  let out = {};
  if (onlyPreset && fs.existsSync(file)) { global.self = {}; require(file); out = global.self.NET[`${page}Presets`]; }
  for (const [key, p] of Object.entries(def.presets)) {
    if (onlyPreset && key !== onlyPreset) continue;
    const cfg = Object.assign({}, p, { fixed: Object.assign({}, def.base, p.fixed) });
    out[key] = Object.assign({}, cfg, { acc: SW.runAll(cfg, 20261106 + key.length, def.fn) });
    console.error(`${page} ${key}: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (page === 'trust' && !onlyPreset) {
    // Pozzi Figs. 1-2: knowledge over successive problems, 100 agents
    const curves = {};
    for (const sc of ['credulous', 'sceptical']) for (const V of [0, 0.5, 1]) {
      const sum = new Float64Array(100);
      const rand = rng.mulberry32(rng.mix(sc.length, V * 10));
      const runs = R('CURVE_RUNS', 100);
      for (let r = 0; r < runs; r++) TR.simulate({ N: 100, scenario: sc, V }, rand).forEach((v, i) => (sum[i] += v));
      curves[`${sc}-${V}`] = Array.from(sum, (v) => +(v / runs).toFixed(4));
    }
    out._curves = curves;
    console.error(`${page} curves: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (page === 'diversity' && !onlyPreset) {
    // Zollman Fig. 7: diversity of actions over the first rounds
    const curves = {};
    for (const net of ['cycle', 'wheel', 'complete']) for (const [tag, max] of [['low', 4], ['high', 7000]]) {
      const v = BB.diversityCurve(NETS.make(net, 7), [0.499, 0.5], 1000, max, rng.mulberry32(rng.mix(net.length, max)), 300, R('CURVE_RUNS', 1000));
      curves[`${tag}-${net}`] = Array.from(v, (x) => +x.toFixed(4));
    }
    out._diversity = curves;
    console.error(`${page} curves: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  fs.writeFileSync(file,
    `/* Generated by tools/precompute-models.js. Do not edit by hand. */\n(function (root) {\n  root.NET = root.NET || {};\n  root.NET.${page}Presets = ` +
    JSON.stringify(out) + ';\n})(typeof self !== "undefined" ? self : this);\n');
}
console.error('done');
