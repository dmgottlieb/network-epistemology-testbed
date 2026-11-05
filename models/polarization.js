/*
 * O'Connor & Weatherall (2018), "Scientific Polarization".
 *
 * The Zollman bandit (see models/zollman.js), except that agents treat
 * evidence from others as uncertain, and trust it less the more the source's
 * credence differs from their own. Evidence E = "source saw k successes in n
 * trials of B". Agent with credence c in H (= "B is better") updates by
 * Jeffrey's rule:
 *
 *   P_f(H) = P_i(H|E) P_f(E) + P_i(H|~E) (1 - P_f(E))
 *
 * where the agent's credence that the evidence is real depends on the
 * distance d = |c_agent - c_source| and the mistrust multiplier m:
 *
 *   ignore version (their Eq. 2):  P_f(E) = 1 - min(1, d m) (1 - P_i(E))
 *   anti-updating  (their Eq. 1):  P_f(E) = max(1 - d m (1 - P_i(E)), 0)
 *
 * In the ignore version this simplifies to  c' = (1 - w) P(H|E) + w c  with
 * w = min(1, d m): a blend of full Bayesian updating and not moving at all.
 * With d m >= 1 the agent ignores the source; in the anti-updating version it
 * moves *against* the evidence. Own evidence has d = 0 and is used by strict
 * conditionalisation, as is everything when m = 0, which then reproduces the
 * Zollman model exactly.
 *
 * Update order. Jeffrey updates do not commute, and the paper does not say in
 * what order agents update. Two options:
 *   'sequential'   (default) agents update one at a time, in index order, each
 *                  working through its closed neighbourhood in index order and
 *                  measuring d against credences as they stand at that moment
 *                  (so some neighbours have already moved this round). This is
 *                  how Weisberg's public reimplementation works, and it
 *                  reproduces the paper's Figure 2.
 *   'simultaneous' every agent measures d against start-of-round credences and
 *                  updates on its own result first. Polarization is then much
 *                  rarer at moderate m (e.g. ~10% instead of ~60% at m = 1.5).
 *
 * Outcomes (as in the paper): correct consensus (all > .99), incorrect
 * consensus (all <= .5), or stable polarization: every agent is either > .99
 * or <= .5 with d m >= 1 to every agent above .99 that can reach it, and both
 * groups non-empty. (See classify for networks other than complete.)
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;

  const PRIOR_TAG = 0x70726972; // must match models/zollman.js
  const EVID_TAG = 0x65766964;

  // log-factorial table, grown on demand
  let lf = new Float64Array([0, 0]);
  function logFact(n) {
    if (n >= lf.length) {
      const next = new Float64Array(Math.max(n + 1, lf.length * 2));
      next.set(lf);
      for (let i = lf.length; i < next.length; i++) next[i] = next[i - 1] + Math.log(i);
      lf = next;
    }
    return lf[n];
  }
  // P(k successes in n trials). The binomial coefficient cancels in the
  // ignore version; in the anti-updating version it sets how much ~E says.
  function binomPmf(n, k, p) {
    return Math.exp(logFact(n) - logFact(k) - logFact(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }

  function clampCredence(c) {
    return Math.min(1 - 1e-12, Math.max(1e-12, c));
  }

  function samplePriors(N, seed, lo, hi) {
    lo = lo ?? 0;
    hi = hi ?? 1;
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = clampCredence(lo + (hi - lo) * rng.mulberry32(rng.mix(seed, i, PRIOR_TAG))());
    return out;
  }

  // One Jeffrey update. pEH, pEnH: probability of the evidence under H, not-H.
  function jeffrey(c, pEH, pEnH, d, m, anti) {
    const PE = c * pEH + (1 - c) * pEnH;
    const dm = d * m;
    const PfE = anti ? Math.max(1 - dm * (1 - PE), 0) : 1 - Math.min(1, dm) * (1 - PE);
    const postE = (c * pEH) / PE;
    const postNE = (c * (1 - pEH)) / (1 - PE);
    return clampCredence(postE * PfE + postNE * (1 - PfE));
  }

  // Weight on an edge: 1 = full trust, 0 = ignored, < 0 = anti-updating.
  function trust(d, m, anti) {
    const dm = d * m;
    return anti ? Math.max(-1, 1 - dm) : 1 - Math.min(1, dm);
  }

  /*
   * Outcome of the current state. The paper (complete networks only) calls a
   * state stably polarized when every agent is either > threshold, or <= .5 and
   * out of reach (d m >= 1) of every agent above threshold. On other networks
   * only neighbours can reach you, so we check neighbours; on a complete
   * network the two definitions coincide.
   */
  function classify(c, m, threshold, graph) {
    let high = 0, low = 0, testing = 0;
    for (let i = 0; i < c.length; i++) {
      if (c[i] > 0.5) testing++;
      if (c[i] > threshold) high++;
    }
    if (testing === 0) return 'incorrect';
    if (high === c.length) return 'correct';
    if (high === 0) return 'running';
    for (let i = 0; i < c.length; i++) {
      if (c[i] > threshold) continue;
      if (c[i] > 0.5) return 'running';
      if (graph) {
        const { offsets, nbrs } = graph;
        for (let q = offsets[i]; q < offsets[i + 1]; q++) {
          const j = nbrs[q];
          if (c[j] > threshold && Math.abs(c[i] - c[j]) * m < 1) return 'running';
        }
      } else {
        for (let j = 0; j < c.length; j++) {
          if (c[j] > threshold && Math.abs(c[i] - c[j]) * m < 1) return 'running';
        }
      }
      low++;
    }
    return low > 0 ? 'polarized' : 'running';
  }

  /*
   * Apply one round of updates in place.
   * c: credences (updated in place); c0: scratch copy; k[j] < 0 means j did A.
   */
  function updateRound(c, c0, k, pEH, pEnH, graph, m, anti, sequential) {
    const N = c.length;
    const { offsets, nbrs } = graph;
    c0.set(c);
    if (sequential) {
      for (let i = 0; i < N; i++) {
        // closed neighbourhood in index order (nbrs are sorted)
        let selfDone = false;
        for (let q = offsets[i]; q <= offsets[i + 1]; q++) {
          const j = q < offsets[i + 1] ? nbrs[q] : -1;
          if (!selfDone && (j < 0 || j > i)) {
            selfDone = true;
            if (k[i] >= 0) c[i] = jeffrey(c[i], pEH[i], pEnH[i], 0, m, anti);
          }
          if (j < 0 || k[j] < 0) continue;
          c[i] = jeffrey(c[i], pEH[j], pEnH[j], Math.abs(c[i] - c[j]), m, anti);
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        let ci = c0[i];
        if (k[i] >= 0) ci = jeffrey(ci, pEH[i], pEnH[i], 0, m, anti);
        for (let q = offsets[i]; q < offsets[i + 1]; q++) {
          const j = nbrs[q];
          if (k[j] < 0) continue;
          ci = jeffrey(ci, pEH[j], pEnH[j], Math.abs(c0[i] - c0[j]), m, anti);
        }
        c[i] = ci;
      }
    }
  }

  /*
   * opts: { graph, eps, n, m, anti, order, seed, priors | priorLo/priorHi,
   *         maxRounds, threshold, recordHistory }
   * Evidence is coupled with models/zollman.js: same seed, same results.
   */
  function createRun(opts) {
    const graph = opts.graph;
    const N = graph.n;
    const eps = Math.min(0.499, Math.max(1e-6, opts.eps));
    const n = Math.max(1, Math.round(opts.n));
    const m = Math.max(0, opts.m || 0);
    const anti = !!opts.anti;
    const sequential = opts.order !== 'simultaneous';
    const seed = opts.seed >>> 0;
    const pB = 0.5 + eps;
    const threshold = opts.threshold ?? 0.99;
    const maxRounds = opts.maxRounds ?? 10000;
    const record = opts.recordHistory !== false;
    const priors = opts.priors || samplePriors(N, seed, opts.priorLo, opts.priorHi);
    const c = Float64Array.from(priors, clampCredence);
    const c0 = new Float64Array(N);
    const pEH = new Float64Array(N), pEnH = new Float64Array(N);

    const run = {
      graph, eps, n, m, anti, seed, threshold, maxRounds,
      order: sequential ? 'sequential' : 'simultaneous',
      cred: c,
      round: 0,
      status: 'running',
      lastK: new Int32Array(N).fill(-1),
      history: [],
      credence: (i) => c[i],
      credences: () => Float64Array.from(c),
      // trust i places in j's evidence, judged from current credences
      trust: (i, j) => trust(Math.abs(c[i] - c[j]), m, anti),
      step,
    };

    function snapshot() {
      if (record) run.history.push(Float32Array.from(c));
    }
    run.status = classify(c, m, threshold, graph);
    snapshot();

    function step() {
      if (run.status !== 'running') return false;
      const t = run.round;
      const k = run.lastK;
      for (let i = 0; i < N; i++) {
        if (c[i] > 0.5) {
          k[i] = rng.binomial(rng.mulberry32(rng.mix(seed, i, t, EVID_TAG)), n, pB);
          pEH[i] = binomPmf(n, k[i], pB);
          pEnH[i] = binomPmf(n, k[i], 1 - pB);
        } else k[i] = -1;
      }
      updateRound(c, c0, k, pEH, pEnH, graph, m, anti, sequential);
      run.round = t + 1;
      run.status = classify(c, m, threshold, graph);
      if (run.status === 'running' && run.round >= maxRounds) run.status = 'timeout';
      snapshot();
      return true;
    }
    return run;
  }

  // Monte Carlo fast path: one random stream, no history.
  function simulate(graph, eps, n, m, anti, order, priors, rand, maxRounds, threshold) {
    const N = graph.n;
    eps = Math.min(0.499, Math.max(1e-6, eps));
    const pB = 0.5 + eps;
    threshold = threshold ?? 0.99;
    maxRounds = maxRounds ?? 10000;
    const sequential = order !== 'simultaneous';
    const c = Float64Array.from(priors, clampCredence);
    const c0 = new Float64Array(N);
    const k = new Int32Array(N);
    const pEH = new Float64Array(N), pEnH = new Float64Array(N);
    let status = classify(c, m, threshold, graph);
    let round = 0;
    while (status === 'running' && round < maxRounds) {
      for (let i = 0; i < N; i++) {
        if (c[i] > 0.5) {
          k[i] = rng.binomial(rand, n, pB);
          pEH[i] = binomPmf(n, k[i], pB);
          pEnH[i] = binomPmf(n, k[i], 1 - pB);
        } else k[i] = -1;
      }
      updateRound(c, c0, k, pEH, pEnH, graph, m, anti, sequential);
      round++;
      status = classify(c, m, threshold, graph);
    }
    let high = 0;
    for (let i = 0; i < N; i++) if (c[i] > threshold) high++;
    return { outcome: status === 'running' ? 'timeout' : status, rounds: round, shareRight: high / N };
  }

  const api = { createRun, simulate, samplePriors, jeffrey, trust, classify, binomPmf };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.polarization = api;
  }
})(typeof self !== 'undefined' ? self : this);
