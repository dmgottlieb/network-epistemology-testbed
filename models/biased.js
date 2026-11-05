/*
 * Holman & Bruner (2015), "The Problem of Intransigently Biased Agents",
 * Philosophy of Science 82(5): 956-968.
 *
 * Doctors are Zollman (2010) beta-belief agents choosing between two drugs:
 * the better drug (success pA, .51 in the paper) and the company's drug
 * (pB, .50). Each round every doctor prescribes the drug it currently thinks
 * better to N patients and shares the results.
 *
 * The company is an intransigently biased agent: it only ever "prescribes"
 * its own drug and reports results drawn from Binomial(N, pB + bias).
 *
 * Static networks: the company is linked to every doctor (a wheel with the
 * company at the hub; doctor-doctor links range from a cycle to complete).
 * Doctors update on their own, their neighbours' and the company's results,
 * all counted in full.
 *
 * Dynamic network (their section 5): doctor i has one bin per doctor (itself
 * included) and one for the company, starting with U(0, 100) balls. It weighs
 * source j's results by w_ij = b_ij / sum_k b_ik:
 *     alpha += w_ij s,  beta += w_ij (N - s)   (for the drug j used)
 * and, on receiving j's N results, runs a one-sample t-test of them against
 * its own expected success rate for that drug, then sets
 *     b_ij <- b_ij + L (1.96 - |t|).
 * Bins never go below zero.
 *
 * Choices the paper leaves open, made explicit here: priors alpha, beta ~
 * U(0, 4) for each drug (as in Zollman 2010); the t-test uses the sample
 * standard deviation of the N results (a floor keeps it finite when all N
 * agree); L = 1; t-tests use beliefs from the start of the round; weights
 * are recomputed after the bins are updated, for the next round.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;
  const PRIOR_TAG = 0x68627072, EVID_TAG = 0x65766964, BIN_TAG = 0x62696e73;

  const BETTER = 1, COMPANY = 0;

  /*
   * opts: { D (doctors), N (patients per round), pA, pB, bias, network:
   *         'wheel' | 'complete' | 'extra' (cycle plus `extraLinks` chords) |
   *         'dynamic', extraLinks, L, priorMax, seed | rand, rounds, record }
   */
  function createRun(opts) {
    const D = opts.D ?? 6, N = Math.max(2, Math.round(opts.N ?? 100));
    const probs = [opts.pB ?? 0.5, opts.pA ?? 0.51];
    const bias = opts.bias ?? 0.03;
    const dynamic = opts.network === 'dynamic';
    const L = opts.L ?? 1;
    const seed = opts.seed >>> 0;
    const batch = opts.rand || null;
    const rounds = opts.rounds ?? 2000;
    const record = opts.record !== false;
    const C = D; // index of the company

    const r0 = batch || rng.mulberry32(rng.mix(seed, PRIOR_TAG));
    const a = new Float64Array(D * 2), b = new Float64Array(D * 2);
    for (let i = 0; i < D * 2; i++) { a[i] = Math.max(1e-9, r0() * (opts.priorMax ?? 4)); b[i] = Math.max(1e-9, r0() * (opts.priorMax ?? 4)); }

    // static links among doctors (the company is linked to all of them)
    const adj = Array.from({ length: D }, () => new Set());
    const link = (i, j) => { if (i !== j) { adj[i].add(j); adj[j].add(i); } };
    if (opts.network === 'complete') { for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) link(i, j); }
    else if (!dynamic) {
      for (let i = 0; i < D; i++) link(i, (i + 1) % D);
      // extra links, shortest ring distance first, so connectivity rises step by step
      const chords = [];
      for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) {
        const dist = Math.min(j - i, D - (j - i));
        if (dist > 1) chords.push([dist, i, j]);
      }
      chords.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      chords.slice(0, Math.max(0, opts.extraLinks ?? 0)).forEach(([, i, j]) => link(i, j));
    }
    // bins for the dynamic network: D doctors + company
    const bins = new Float64Array(D * (D + 1));
    if (dynamic) {
      const rb = batch || rng.mulberry32(rng.mix(seed, BIN_TAG));
      for (let q = 0; q < bins.length; q++) bins[q] = rb() * 100;
    }
    const drug = new Int32Array(D + 1);
    const succ = new Int32Array(D + 1);
    const mean = (i, d) => a[i * 2 + d] / (a[i * 2 + d] + b[i * 2 + d]);

    // credence that the better drug really is better (normal approximation to the betas)
    const credence = (i) => {
      const v = (q) => (a[q] * b[q]) / ((a[q] + b[q]) ** 2 * (a[q] + b[q] + 1));
      const qa = i * 2 + BETTER, qb = i * 2 + COMPANY;
      const z = (mean(i, BETTER) - mean(i, COMPANY)) / (Math.sqrt(v(qa) + v(qb)) || 1e-9);
      return 1 / (1 + Math.exp(-1.702 * z)); // logistic approximation to the normal CDF
    };
    const run = {
      D, N, probs, bias, dynamic, rounds, adj, bins, a, b, drug, succ, credence,
      history: [],
      round: 0, done: false,
      betterHistory: [],       // doctors on the better drug each round
      companyWeightHistory: [], // mean weight doctors give the company
      onBetterLate: 0, lateRounds: 0,
      mean,
      prefers: (i) => (mean(i, BETTER) >= mean(i, COMPANY) ? BETTER : COMPANY),
      weight(i, j) { let s = 0; for (let k = 0; k <= D; k++) s += bins[i * (D + 1) + k]; return s > 0 ? bins[i * (D + 1) + j] / s : 0; },
      step,
    };

    if (record) run.history.push(Float32Array.from({ length: D }, (_, i) => credence(i)));
    function tScore(i, j) {
      const s = succ[j], d = drug[j];
      const xbar = s / N;
      const sd = Math.sqrt(Math.max(xbar * (1 - xbar) * N / (N - 1), 1 / (N * N)));
      return (xbar - mean(i, d)) / (sd / Math.sqrt(N));
    }

    function step() {
      if (run.done) return false;
      const t = run.round;
      for (let i = 0; i < D; i++) drug[i] = run.prefers(i);
      drug[C] = COMPANY;
      for (let i = 0; i <= D; i++) {
        const r = batch || rng.mulberry32(rng.mix(seed, i, t, EVID_TAG));
        succ[i] = rng.binomial(r, N, i === C ? Math.min(1, probs[COMPANY] + bias) : probs[drug[i]]);
      }
      if (!dynamic) {
        for (let i = 0; i < D; i++) {
          const srcs = [i, C, ...adj[i]];
          for (const j of srcs) { const q = i * 2 + drug[j]; a[q] += succ[j]; b[q] += N - succ[j]; }
        }
      } else {
        const tz = new Float64Array(D * (D + 1));
        for (let i = 0; i < D; i++) for (let j = 0; j <= D; j++) tz[i * (D + 1) + j] = tScore(i, j);
        for (let i = 0; i < D; i++) {
          let tot = 0;
          for (let j = 0; j <= D; j++) tot += bins[i * (D + 1) + j];
          if (tot > 0) for (let j = 0; j <= D; j++) {
            const w = bins[i * (D + 1) + j] / tot;
            if (w === 0) continue;
            const q = i * 2 + drug[j];
            a[q] += w * succ[j];
            b[q] += w * (N - succ[j]);
          }
          for (let j = 0; j <= D; j++) {
            const q = i * (D + 1) + j;
            bins[q] = Math.max(0, bins[q] + L * (1.96 - Math.abs(tz[q])));
          }
        }
      }
      let on = 0;
      for (let i = 0; i < D; i++) if (drug[i] === BETTER) on++;
      if (record) {
        run.history.push(Float32Array.from({ length: D }, (_, i) => credence(i)));
        run.betterHistory.push(on);
        let cw = 0;
        if (dynamic) for (let i = 0; i < D; i++) cw += run.weight(i, C);
        run.companyWeightHistory.push(dynamic ? cw / D : null);
      }
      if (t >= rounds / 2) { run.onBetterLate += on / D; run.lateRounds++; }
      run.round = t + 1;
      if (run.round >= rounds) run.done = true;
      return true;
    }
    return run;
  }

  // Share of doctor-rounds on the better drug in the second half of the run
  // (the paper: last 1,000 of 2,000 rounds).
  function simulate(opts, rand) {
    const run = createRun(Object.assign({}, opts, { rand, record: false }));
    while (run.step());
    return run.onBetterLate / run.lateRounds;
  }

  const api = { createRun, simulate, BETTER, COMPANY };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.biased = api;
  }
})(typeof self !== 'undefined' ? self : this);
