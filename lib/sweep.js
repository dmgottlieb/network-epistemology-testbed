/*
 * Generic parameter sweep, shared by model pages and their precompute
 * scripts so that both compute results the same way.
 *
 * cfg: { vary, xs, seriesBy, series, fixed, runs }
 * runOne(params, rand, cache) returns an object: an optional `outcome`
 * string, which is counted, and numeric fields, which are averaged.
 * `cache` is a per-point object the model can use, e.g. to reuse a graph.
 *
 * Each point's accumulator: { runs, n: {outcome: count}, s: {field: sum},
 * c: {field: count of non-null values} }.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('./rng.js') : root.NET.rng;

  function emptyAcc() { return { runs: 0, n: {}, s: {}, c: {} }; }

  function add(acc, res) {
    acc.runs++;
    if (res.outcome != null) acc.n[res.outcome] = (acc.n[res.outcome] || 0) + 1;
    for (const k in res) {
      if (k === 'outcome') continue;
      const v = res[k];
      if (typeof v !== 'number' || !isFinite(v)) continue;
      acc.s[k] = (acc.s[k] || 0) + v;
      acc.c[k] = (acc.c[k] || 0) + 1;
    }
  }

  const rate = (acc, outcome) => (acc.runs ? (acc.n[outcome] || 0) / acc.runs : null);
  const mean = (acc, field) => (acc.c[field] ? acc.s[field] / acc.c[field] : null);

  function paramsFor(cfg, x, s) {
    const p = Object.assign({}, cfg.fixed);
    p[cfg.vary] = x;
    if (cfg.seriesBy) p[cfg.seriesBy] = s;
    return p;
  }

  function createSweep(cfg, seed, runOne) {
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
            task.rand = rng.mulberry32(rng.mix(seed, ti, 0x73776570));
            task.cache = {};
          }
          const a = acc[String(task.s)][task.xi];
          add(a, runOne(task.p, task.rand, task.cache));
          done++;
          if (a.runs >= cfg.runs) ti++;
        }
        return ti >= tasks.length;
      },
    };
  }

  function runAll(cfg, seed, runOne) {
    const sw = createSweep(cfg, seed, runOne);
    while (!sw.next(1e9));
    return sw.acc;
  }

  function wilson(k, n) {
    if (!n) return [null, null];
    const z = 1.96, p = k / n, z2 = z * z;
    const c = (p + z2 / (2 * n)) / (1 + z2 / n);
    const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  const api = { createSweep, runAll, emptyAcc, add, rate, mean, wilson, paramsFor };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.sweep = api;
  }
})(typeof self !== 'undefined' ? self : this);
