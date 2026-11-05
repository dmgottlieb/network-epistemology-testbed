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
 * Optional extension (not in Zollman's model): exploration. With
 * explore = x > 0, each round every doubter (credence <= 0.5) tests B anyway
 * with probability x, in the spirit of Kummerfeld & Zollman's (2016)
 * epsilon-greedy agents. Exploring A would teach nothing here (its rate is
 * known), so only doubters explore. Everyone-on-A is then no longer an
 * absorbing state, so a run ends only at the right consensus or the cap.
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
  const EXPL_TAG = 0x6578706c; // "expl"

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

  // explore > 0 removes the absorbing wrong consensus
  function checkStatus(l, cut, explore) {
    let allAbove = true;
    let anyTesting = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] > 0) anyTesting = true;
      if (!(l[i] > cut)) allAbove = false;
    }
    if (!anyTesting && !(explore > 0)) return 'incorrect';
    if (allAbove) return 'correct';
    return 'running';
  }
  function allDoubt(l) {
    for (let i = 0; i < l.length; i++) if (l[i] > 0) return false;
    return true;
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
    const explore = Math.max(0, Math.min(1, opts.explore || 0));

    const priors = opts.priors || samplePriors(N, seed, opts.priorLo, opts.priorHi);
    const l = new Float64Array(N);
    for (let i = 0; i < N; i++) l[i] = logit(clampCredence(priors[i]));
    const l0 = Float64Array.from(l);

    const run = {
      graph, eps, n, seed, threshold, maxRounds, L, explore,
      logodds: l,
      round: 0,
      status: 'running',
      // results of the most recent round: successes, or -1 if the agent did A
      lastK: new Int32Array(N).fill(-1),
      // how much each agent's log-odds moved in the most recent round
      lastDelta: new Float64Array(N),
      history: [],
      testingHistory: [],
      // per round (aligned with history; entry 0 is the start): how many
      // agents tested B, and how many of those were deliberate explorers
      testedHistory: [0],
      explorerHistory: [0],
      againstHistory: [0],
      // this round: who tested B only because they explored, and who tested
      // B by their own lights although the community's pooled evidence
      // (their prior plus every result anyone has produced) favours A
      explorers: new Uint8Array(N),
      accidental: new Uint8Array(N),
      // tested B although the pooled evidence favours A, for either reason.
      // In a complete network own beliefs equal pooled ones, so only
      // explorers can be "against"; in a sparse network anyone can be.
      against: new Uint8Array(N),
      pooled: 0,
      everTrapped: false,
      trappedRounds: 0,
      explorations: 0,
      informedLogodds(i) {
        return l0[i] + run.pooled;
      },
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

    run.status = checkStatus(l, cut, explore);
    if (allDoubt(l)) run.everTrapped = true;
    snapshot();

    const e = new Float64Array(N);
    function step() {
      if (run.status !== 'running') return false;
      const t = run.round;
      if (allDoubt(l)) { run.everTrapped = true; run.trappedRounds++; }
      let tested = 0, explored = 0, againstCount = 0;
      for (let i = 0; i < N; i++) {
        const believes = l[i] > 0;
        const explores = !believes && explore > 0 && rng.mulberry32(rng.mix(seed, i, t, EXPL_TAG))() < explore;
        run.explorers[i] = explores ? 1 : 0;
        run.accidental[i] = believes && l0[i] + run.pooled <= 0 ? 1 : 0;
        run.against[i] = (believes || explores) && l0[i] + run.pooled <= 0 ? 1 : 0;
        againstCount += run.against[i];
        if (believes || explores) {
          tested++;
          if (explores) explored++;
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
      let total = 0;
      for (let i = 0; i < N; i++) {
        total += e[i];
        let s = e[i];
        for (let q = offsets[i]; q < offsets[i + 1]; q++) s += e[nbrs[q]];
        const d = s * L;
        run.lastDelta[i] = d;
        l[i] += d;
      }
      run.pooled += total * L;
      run.explorations += explored;
      if (record) {
        run.testedHistory.push(tested);
        run.explorerHistory.push(explored);
        run.againstHistory.push(againstCount);
      }
      run.round = t + 1;
      run.status = checkStatus(l, cut, explore);
      if (run.status === 'running' && run.round >= maxRounds) run.status = 'timeout';
      snapshot();
      return true;
    }

    return run;
  }

  /*
   * Fast path for Monte Carlo sweeps: one random stream, no history.
   * Returns { outcome: 'correct' | 'incorrect' | 'timeout', rounds,
   *           explorations, everTrapped }.
   */
  function simulate(graph, eps, n, priors, rand, maxRounds, threshold, explore) {
    explore = explore > 0 ? Math.min(1, explore) : 0;
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

    let status = checkStatus(l, cut, explore);
    let round = 0, explorations = 0, everTrapped = allDoubt(l);
    while (status === 'running' && round < maxRounds) {
      if (explore > 0) {
        let trapped = true;
        for (let i = 0; i < N; i++) {
          if (l[i] > 0) { trapped = false; e[i] = 2 * rng.binomial(rand, n, pTrue) - n; }
          else if (rand() < explore) { explorations++; e[i] = 2 * rng.binomial(rand, n, pTrue) - n; }
          else e[i] = 0;
        }
        if (trapped) everTrapped = true;
      } else {
        for (let i = 0; i < N; i++) e[i] = l[i] > 0 ? 2 * rng.binomial(rand, n, pTrue) - n : 0;
      }
      for (let i = 0; i < N; i++) {
        let s = e[i];
        for (let q = offsets[i]; q < offsets[i + 1]; q++) s += e[nbrs[q]];
        l[i] += s * L;
      }
      round++;
      status = checkStatus(l, cut, explore);
      if (status === 'incorrect') everTrapped = true;
    }
    return { outcome: status === 'running' ? 'timeout' : status, rounds: round, explorations, everTrapped };
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
