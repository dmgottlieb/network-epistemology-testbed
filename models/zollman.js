/*
 * The Bala–Goyal / Zollman two-armed bandit model of an epistemic community,
 * in the form used by Zollman (2007) and Rosenstock, Bruner & O'Connor (2017).
 *
 *   - Action A succeeds with known probability 0.5.
 *   - Action B succeeds with probability 0.5 + eps (so B really is better),
 *     but agents only know it is either 0.5 + eps or 0.5 - eps.
 *   - Each agent holds a credence c that B is the better action.
 *   - Each round, agents with c > 0.5 perform B n times; the rest perform A,
 *     which teaches nobody anything (its rate is already known).
 *   - Every agent then updates by Bayes' rule on its own result and the
 *     results of its network neighbours.
 *   - A run ends when every agent has c > 0.99 (correct consensus), or when
 *     every agent has c <= 0.5 (nobody tests B again: incorrect consensus),
 *     or at a round cap.
 *
 * Beliefs are stored as log-odds, which turns the update into addition:
 *   with k successes in n trials of B, the likelihood ratio is
 *   ((0.5+eps)/(0.5-eps))^k * ((0.5-eps)/(0.5+eps))^(n-k)
 *   so  logit(c) += (2k - n) * ln((0.5+eps)/(0.5-eps)).
 * The binomial coefficient cancels, and the order in which results arrive
 * does not matter.
 */
(function (root) {
  'use strict';

  const rng =
    typeof module !== 'undefined' && module.exports ? require('../lib/rng.js') : root.NET.rng;

  const PRIOR_TAG = 0x70726972; // "prir"
  const EVID_TAG = 0x65766964; // "evid"

  const logit = (c) => Math.log(c / (1 - c));
  const sigmoid = (l) => 1 / (1 + Math.exp(-l));

  function clampCredence(c) {
    return Math.min(1 - 1e-12, Math.max(1e-12, c));
  }

  // Agent i's prior depends only on (seed, i), so two networks run with the
  // same seed start from identical beliefs.
  function samplePriors(N, seed, lo, hi) {
    lo = lo ?? 0;
    hi = hi ?? 1;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const r = rng.mulberry32(rng.mix(seed, i, PRIOR_TAG))();
      out[i] = clampCredence(lo + (hi - lo) * r);
    }
    return out;
  }

  function checkStatus(l, cut) {
    let allAbove = true;
    let anyTesting = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] > 0) anyTesting = true;
      if (!(l[i] > cut)) allAbove = false;
    }
    if (!anyTesting) return 'incorrect';
    if (allAbove) return 'correct';
    return 'running';
  }

  /*
   * An interactive run that keeps per-round detail for visualisation.
   * With the same seed, agent i's experimental result in round t is the same
   * across networks whenever agent i tests B in round t in both of them
   * ("coupled" evidence), so side-by-side runs differ only through the network.
   */
  function createRun(opts) {
    const graph = opts.graph;
    const N = graph.n;
    const eps = Math.min(0.499, Math.max(1e-6, opts.eps));
    const n = Math.max(1, Math.round(opts.n));
    const seed = opts.seed >>> 0;
    const pTrue = 0.5 + eps;
    const L = Math.log((0.5 + eps) / (0.5 - eps));
    const threshold = opts.threshold ?? 0.99;
    const cut = logit(threshold);
    const maxRounds = opts.maxRounds ?? 10000;
    const record = opts.recordHistory !== false;

    const priors = opts.priors || samplePriors(N, seed, opts.priorLo, opts.priorHi);
    const l = new Float64Array(N);
    for (let i = 0; i < N; i++) l[i] = logit(clampCredence(priors[i]));

    const run = {
      graph, eps, n, seed, threshold, maxRounds, L,
      logodds: l,
      round: 0,
      status: 'running',
      // results of the most recent round: successes, or -1 if the agent did A
      lastK: new Int32Array(N).fill(-1),
      // how much each agent's log-odds moved in the most recent round
      lastDelta: new Float64Array(N),
      history: [],
      testingHistory: [],
      credence(i) {
        return sigmoid(l[i]);
      },
      credences() {
        const out = new Float64Array(N);
        for (let i = 0; i < N; i++) out[i] = sigmoid(l[i]);
        return out;
      },
      step,
    };

    function snapshot() {
      if (!record) return;
      const c = new Float32Array(N);
      let testing = 0;
      for (let i = 0; i < N; i++) {
        c[i] = sigmoid(l[i]);
        if (l[i] > 0) testing++;
      }
      run.history.push(c);
      run.testingHistory.push(testing);
    }

    run.status = checkStatus(l, cut);
    snapshot();

    const e = new Float64Array(N);
    function step() {
      if (run.status !== 'running') return false;
      const t = run.round;
      for (let i = 0; i < N; i++) {
        if (l[i] > 0) {
          const rand = rng.mulberry32(rng.mix(seed, i, t, EVID_TAG));
          const k = rng.binomial(rand, n, pTrue);
          run.lastK[i] = k;
          e[i] = 2 * k - n;
        } else {
          run.lastK[i] = -1;
          e[i] = 0;
        }
      }
      const { offsets, nbrs } = graph;
      for (let i = 0; i < N; i++) {
        let s = e[i];
        for (let q = offsets[i]; q < offsets[i + 1]; q++) s += e[nbrs[q]];
        const d = s * L;
        run.lastDelta[i] = d;
        l[i] += d;
      }
      run.round = t + 1;
      run.status = checkStatus(l, cut);
      if (run.status === 'running' && run.round >= maxRounds) run.status = 'timeout';
      snapshot();
      return true;
    }

    return run;
  }

  /*
   * Fast path for Monte Carlo sweeps: one random stream, no history.
   * Returns { outcome: 'correct' | 'incorrect' | 'timeout', rounds }.
   */
  function simulate(graph, eps, n, priors, rand, maxRounds, threshold) {
    const N = graph.n;
    eps = Math.min(0.499, Math.max(1e-6, eps));
    const pTrue = 0.5 + eps;
    const L = Math.log((0.5 + eps) / (0.5 - eps));
    const cut = logit(threshold ?? 0.99);
    maxRounds = maxRounds ?? 10000;
    const l = new Float64Array(N);
    for (let i = 0; i < N; i++) l[i] = logit(clampCredence(priors[i]));
    const e = new Float64Array(N);
    const { offsets, nbrs } = graph;

    let status = checkStatus(l, cut);
    let round = 0;
    while (status === 'running' && round < maxRounds) {
      for (let i = 0; i < N; i++) e[i] = l[i] > 0 ? 2 * rng.binomial(rand, n, pTrue) - n : 0;
      for (let i = 0; i < N; i++) {
        let s = e[i];
        for (let q = offsets[i]; q < offsets[i + 1]; q++) s += e[nbrs[q]];
        l[i] += s * L;
      }
      round++;
      status = checkStatus(l, cut);
    }
    return { outcome: status === 'running' ? 'timeout' : status, rounds: round };
  }

  function randomPriors(N, rand, lo, hi) {
    lo = lo ?? 0;
    hi = hi ?? 1;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = clampCredence(lo + (hi - lo) * rand());
    return out;
  }

  const api = { createRun, simulate, samplePriors, randomPriors, logit, sigmoid };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.zollman = api;
  }
})(typeof self !== 'undefined' ? self : this);
