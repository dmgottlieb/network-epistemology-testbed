/*
 * Parameter sweeps for the polarization model, shared by the page and by
 * tools/precompute-polarization.js so both compute results the same way.
 *
 * A sweep config:
 *   { vary: 'm' | 'N' | 'eps' | 'n', xs: [...],
 *     seriesBy: 'N' | 'm' | 'eps' | 'n' | 'network' | 'order' | 'rule', series: [...],
 *     fixed: { N, eps, n, m, network, order, rule }, runs, cap }
 * Each (x, series value) point runs `runs` independent communities with
 * priors drawn uniformly from [0, 1].
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;
  const NETS = isNode ? require('../lib/networks.js') : root.NET.networks;
  const P = isNode ? require('./polarization.js') : root.NET.polarization;

  const VARIABLES = {
    m: { name: 'm', label: 'Mistrust multiplier, m', numeric: true },
    N: { name: 'N', label: 'Number of agents, N', numeric: true },
    eps: { name: 'ε', label: 'Advantage of B, ε (pB = 0.5 + ε)', numeric: true },
    n: { name: 'n', label: 'Trials per round, n', numeric: true },
    network: { name: 'network', label: 'Network' },
    order: { name: 'update order', label: 'Update order' },
    rule: { name: 'rule', label: 'Distrusted evidence is' },
  };

  function emptyAcc() {
    return { runs: 0, correct: 0, incorrect: 0, polarized: 0, timeout: 0, roundsCorrect: 0, roundsSettled: 0, settled: 0, leftBehind: 0 };
  }

  function paramsFor(cfg, x, s) {
    const p = Object.assign({}, cfg.fixed);
    p[cfg.vary] = x;
    if (cfg.seriesBy) p[cfg.seriesBy] = s;
    p.N = Math.round(p.N);
    p.n = Math.round(p.n);
    return p;
  }

  function graphFor(p, rand) {
    const random = NETS.TYPES[p.network].random;
    return NETS.make(p.network, p.N, NETS.defaultParams(p.network), random ? (rand() * 4294967296) >>> 0 : 0);
  }

  function runOne(p, graph, rand, cap) {
    return P.simulate(graph, p.eps, p.n, p.m, p.rule === 'anti', p.order, randomPriors(p.N, rand), rand, cap);
  }

  function randomPriors(N, rand) {
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = Math.min(1 - 1e-12, Math.max(1e-12, rand()));
    return out;
  }

  function add(acc, res) {
    acc.runs++;
    acc[res.outcome]++;
    if (res.outcome === 'correct') acc.roundsCorrect += res.rounds;
    if (res.outcome !== 'timeout') { acc.settled++; acc.roundsSettled += res.rounds; }
    acc.leftBehind += 1 - res.shareRight;
  }

  /*
   * Iterator over the sweep's points, so callers can run it in time slices.
   * next(budgetMs) runs for up to budgetMs and returns true when finished.
   */
  function createSweep(cfg, seed) {
    const series = cfg.seriesBy ? cfg.series : [null];
    const acc = {};
    for (const s of series) acc[String(s)] = cfg.xs.map(emptyAcc);
    const tasks = [];
    cfg.xs.forEach((x, xi) => series.forEach((s) => tasks.push({ x, xi, s })));
    let ti = 0, done = 0;
    const total = tasks.length * cfg.runs;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    return {
      acc, total,
      get done() { return done; },
      next(budgetMs) {
        const t0 = now();
        while (ti < tasks.length && now() - t0 < budgetMs) {
          const task = tasks[ti];
          if (!task.rand) {
            task.p = paramsFor(cfg, task.x, task.s);
            task.rand = rng.mulberry32(rng.mix(seed, ti, 0x706f6c));
            task.random = NETS.TYPES[task.p.network].random;
            if (!task.random) task.graph = graphFor(task.p, task.rand);
          }
          const g = task.graph || graphFor(task.p, task.rand);
          const a = acc[String(task.s)][task.xi];
          add(a, runOne(task.p, g, task.rand, cfg.cap));
          done++;
          if (a.runs >= cfg.runs) ti++;
        }
        return ti >= tasks.length;
      },
    };
  }

  const api = { VARIABLES, createSweep, paramsFor, emptyAcc };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.polarizationSweep = api;
  }
})(typeof self !== 'undefined' ? self : this);
