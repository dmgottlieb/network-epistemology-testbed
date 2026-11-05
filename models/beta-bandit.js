/*
 * Bandit with beta-distributed beliefs about every arm, shared by two models:
 *
 *  - Zollman (2010), "The Epistemic Benefit of Transient Diversity",
 *    Erkenntnis 72: two methods, both of unknown success rate (0.5 and
 *    0.499), priors alpha, beta ~ U[0, max] for each arm (max = 4 by default,
 *    up to 10,000 for "dogmatic" agents), 1,000 pulls a round, judged after
 *    10,000 rounds. Agents are myopic: they always pull the arm with the
 *    highest expected success rate alpha / (alpha + beta).
 *
 *  - Weatherall & O'Connor (2021), "Conformity in Scientific Networks",
 *    Synthese: the same agents, but each arm's utility adds a payoff for doing
 *    what one's neighbours did last round,
 *        u_i(arm) = k (number of neighbours who did that arm
 *                      - number who did something else) + expected success.
 *    (Their formula for two arms; for more arms we use the same "agreeing
 *    minus disagreeing neighbours" count.) In round 1 nobody has acted yet,
 *    so the conformity term is 0.
 *
 * Results from one's own pulls and from neighbours' are added to the beta
 * parameters (conjugate updating). Arms are indexed so that the best arm is
 * the last one: for the two-arm case arm 0 is "A" and arm 1 is "B".
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;

  const PRIOR_TAG = 0x62657461; // "beta"
  const EVID_TAG = 0x65766964;

  // standard normal CDF (Abramowitz & Stegun 7.1.26 via erf)
  function phi(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function samplePriors(N, M, seed, max, rand) {
    const a = new Float64Array(N * M), b = new Float64Array(N * M);
    for (let i = 0; i < N; i++) {
      const r = rand || rng.mulberry32(rng.mix(seed, i, PRIOR_TAG));
      for (let j = 0; j < M; j++) {
        // a parameter of exactly 0 would make the mean undefined
        a[i * M + j] = Math.max(1e-9, r() * max);
        b[i * M + j] = Math.max(1e-9, r() * max);
      }
    }
    return { a, b };
  }

  /*
   * opts: { graph, probs: [p0, ..., p(M-1)] (best last), n, k (conformity),
   *         priorMax, seed | rand, maxRounds, recordHistory }
   */
  function createRun(opts) {
    const graph = opts.graph;
    const N = graph.n;
    const probs = opts.probs;
    const M = probs.length;
    const n = Math.max(1, Math.round(opts.n));
    const k = Math.max(0, opts.k || 0);
    const seed = opts.seed >>> 0;
    const batch = opts.rand || null; // one shared stream (fast Monte Carlo)
    const maxRounds = opts.maxRounds ?? 10000;
    const record = opts.recordHistory !== false;
    const best = probs.indexOf(Math.max(...probs));
    const { a, b } = samplePriors(N, M, seed, opts.priorMax ?? 4, batch);
    const action = new Int32Array(N).fill(-1);
    const prevAction = new Int32Array(N).fill(-1);
    const succ = new Int32Array(N);
    const { offsets, nbrs } = graph;

    const run = {
      graph, probs, n, k, seed, maxRounds, M, best,
      a, b, action, round: 0, status: 'running',
      history: [], actionHistory: [], bestShareHistory: [],
      mean: (i, j) => a[i * M + j] / (a[i * M + j] + b[i * M + j]),
      believed(i) {
        let bj = 0, bm = -1;
        for (let j = 0; j < M; j++) { const m = run.mean(i, j); if (m > bm) { bm = m; bj = j; } }
        return bj;
      },
      // approximate probability (normal approximation to the betas) that
      // the best arm beats the agent's strongest alternative
      credenceBest(i) {
        const ib = i * M + best;
        const mb = a[ib] / (a[ib] + b[ib]);
        const vb = (a[ib] * b[ib]) / ((a[ib] + b[ib]) ** 2 * (a[ib] + b[ib] + 1));
        let mo = -1, vo = 0;
        for (let j = 0; j < M; j++) {
          if (j === best) continue;
          const q = i * M + j;
          const m = a[q] / (a[q] + b[q]);
          if (m > mo) { mo = m; vo = (a[q] * b[q]) / ((a[q] + b[q]) ** 2 * (a[q] + b[q] + 1)); }
        }
        const sd = Math.sqrt(vb + vo) || 1e-9;
        return phi((mb - mo) / sd);
      },
      step,
      outcome,
    };

    /*
     * Conformity looks at the neighbours' most recent actions (the agent's own
     * is not counted). Agents choose one at a time in a random order each
     * round ('sequential', the default), so later choosers see earlier
     * choosers' new actions, as in typical agent-based implementations. With
     * 'simultaneous' choice an evenly split complete network swaps sides
     * forever; with sequential choice it tips into a cascade, matching the
     * paper's report that polarization is never stable on complete networks or
     * cycles. In round 1 nobody has acted, so choices follow beliefs alone.
     */
    const sequential = opts.order !== 'simultaneous';
    const ORDER_TAG = 0x6f726472;
    const perm = Int32Array.from({ length: N }, (_, i) => i);
    function choose(i, seen) {
      let bj = 0, bu = -Infinity;
      let acted = 0;
      if (k > 0) for (let q = offsets[i]; q < offsets[i + 1]; q++) if (seen[nbrs[q]] >= 0) acted++;
      for (let j = 0; j < M; j++) {
        let u = run.mean(i, j);
        if (k > 0 && acted > 0) {
          let same = 0;
          for (let q = offsets[i]; q < offsets[i + 1]; q++) if (seen[nbrs[q]] === j) same++;
          u += k * (same - (acted - same));
        }
        if (u > bu) { bu = u; bj = j; }
      }
      return bj;
    }
    function chooseAll(t) {
      if (t === 0 || k === 0 || !sequential) {
        for (let i = 0; i < N; i++) action[i] = t === 0 ? choose(i, NO_ACTIONS) : choose(i, prevAction);
        return;
      }
      const r = batch || rng.mulberry32(rng.mix(seed, t, ORDER_TAG));
      for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }
      action.set(prevAction);
      for (let q = 0; q < N; q++) { const i = perm[q]; action[i] = choose(i, action); }
    }
    const NO_ACTIONS = new Int32Array(N).fill(-1);

    function snapshot() {
      if (!record) return;
      const c = new Float32Array(N);
      for (let i = 0; i < N; i++) c[i] = run.credenceBest(i);
      run.history.push(c);
      run.actionHistory.push(Int8Array.from(action));
      let onBest = 0;
      for (let i = 0; i < N; i++) if (action[i] === best) onBest++;
      run.bestShareHistory.push(onBest);
    }
    snapshot();

    function step() {
      if (run.status !== 'running') return false;
      const t = run.round;
      chooseAll(t);
      for (let i = 0; i < N; i++) {
        const r = batch || rng.mulberry32(rng.mix(seed, i, t, EVID_TAG));
        succ[i] = rng.binomial(r, n, probs[action[i]]);
      }
      for (let i = 0; i < N; i++) {
        let q0 = offsets[i], q1 = offsets[i + 1];
        for (let q = q0 - 1; q < q1; q++) {
          const j = q < q0 ? i : nbrs[q];
          const idx = i * M + action[j];
          a[idx] += succ[j];
          b[idx] += n - succ[j];
        }
      }
      prevAction.set(action);
      run.round = t + 1;
      if (run.round >= maxRounds) run.status = 'done';
      snapshot();
      return true;
    }

    /*
     * Classification after the run (Weatherall & O'Connor's five outcomes):
     * everyone doing the same arm is a consensus, "correct" if it is the best
     * arm; "with disagreement" if some agents believe another arm is better;
     * mixed actions are "polarized". Zollman (2010) counts a success when
     * every agent believes the best arm is best.
     */
    function outcome() {
      // actions agents would take now (last round's actions)
      const act = run.round > 0 ? action : Int32Array.from({ length: N }, (_, i) => run.believed(i));
      const first = act[0];
      let same = true, allBelieveBest = true, allBelieveAct = true;
      for (let i = 0; i < N; i++) {
        if (act[i] !== first) same = false;
        const bel = run.believed(i);
        if (bel !== best) allBelieveBest = false;
        if (bel !== act[i]) allBelieveAct = false;
      }
      let kind;
      if (!same) kind = 'polarized';
      else if (first === best) kind = allBelieveAct ? 'correct' : 'correctDisagree';
      else kind = allBelieveAct ? 'incorrect' : 'incorrectDisagree';
      return { kind, learned: allBelieveBest };
    }

    return run;
  }

  // Fast Monte Carlo: run to the horizon with one random stream.
  function simulate(graph, probs, n, k, priorMax, rand, rounds) {
    const run = createRun({ graph, probs, n, k, priorMax, rand, maxRounds: rounds, recordHistory: false });
    while (run.step());
    return run.outcome();
  }

  // Share of agents on each arm averaged over runs, per round (Zollman's
  // Fig. 7 plots the variance of actions; we report both).
  function diversityCurve(graph, probs, n, priorMax, rand, rounds, runs) {
    const variance = new Float64Array(rounds);
    for (let r = 0; r < runs; r++) {
      const run = createRun({ graph, probs, n, k: 0, priorMax, rand, maxRounds: rounds, recordHistory: false });
      for (let t = 0; t < rounds; t++) {
        run.step();
        let s = 0;
        for (let i = 0; i < graph.n; i++) s += run.action[i] === run.best ? 1 : 0;
        const p = s / graph.n;
        variance[t] += p * (1 - p);
      }
    }
    for (let t = 0; t < rounds; t++) variance[t] /= runs;
    return variance;
  }

  const api = { createRun, simulate, diversityCurve, samplePriors, phi };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.betaBandit = api;
  }
})(typeof self !== 'undefined' ? self : this);
