/*
 * One-run functions for the Monte Carlo experiments on diversity.html,
 * conformity.html and propaganda.html, shared with tools/precompute-models.js
 * so the pages and the precomputed presets run identical code.
 * Each takes (params, rand, cache) and returns { outcome, ...numbers } for
 * lib/sweep.js.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const NETS = isNode ? require('../lib/networks.js') : root.NET.networks;
  const BB = isNode ? require('./beta-bandit.js') : root.NET.betaBandit;
  const PR = isNode ? require('./propaganda.js') : root.NET.propaganda;

  function graphFor(type, N, cache, rand, params) {
    const def = NETS.TYPES[type];
    const p = Object.assign(NETS.defaultParams(type), params || {});
    if (def.random) return NETS.make(type, N, p, (rand() * 4294967296) >>> 0);
    const key = type + ':' + N;
    return cache[key] || (cache[key] = NETS.make(type, N, p, 0));
  }

  // Zollman (2010): methods 0.5 - gap and 0.5, beta priors on both.
  function diversity(p, rand, cache) {
    const g = graphFor(p.net, p.N, cache, rand);
    const run = BB.createRun({ graph: g, probs: [0.5 - p.gap, 0.5], n: p.n, k: 0, priorMax: p.priorMax, rand, maxRounds: p.rounds, recordHistory: false });
    while (run.step());
    const o = run.outcome();
    let allWorse = true;
    for (let i = 0; i < g.n; i++) if (run.believed(i) === run.best) { allWorse = false; break; }
    return { outcome: o.learned ? 'learned' : allWorse ? 'wrong' : 'split' };
  }

  // Weatherall & O'Connor: conformity k, `arms` arms with one better arm.
  const CLUMPY = { clusters: { c: 2 }, randomConnected: { q: 0.5 }, smallWorld: { k: 2, beta: 0.1 } };
  function conformity(p, rand, cache) {
    const g = graphFor(p.net, p.N, cache, rand, CLUMPY[p.net]);
    const probs = Array.from({ length: Math.max(2, p.arms) - 1 }, () => 0.5).concat([p.pB]);
    const run = BB.createRun({ graph: g, probs, n: p.n, k: p.k, priorMax: 4, rand, maxRounds: p.rounds, recordHistory: false });
    while (run.step());
    return { outcome: run.outcome().kind };
  }

  // Weatherall, O'Connor & Bruner: mean policy-maker credence at a correct
  // scientific consensus.
  function propaganda(p, rand, cache) {
    const g = graphFor(p.net, p.K, cache, rand);
    const listen = Math.max(1, Math.min(p.K, Math.round(p.listenShare * p.K)));
    const res = PR.simulate(g, {
      eps: p.eps, n: p.n, listen, mode: p.mode, resources: p.resources, studyN: p.studyN,
      doubleCount: p.doubleCount !== 'no', policyMakers: 10, maxRounds: 10000,
    }, rand);
    return { outcome: res.outcome, pm: res.outcome === 'correct' ? res.pmMean : null, rounds: res.rounds };
  }

  const api = { diversity, conformity, propaganda, graphFor };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.experiments = api;
  }
})(typeof self !== 'undefined' ? self : this);
