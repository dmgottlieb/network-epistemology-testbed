/*
 * Weatherall, O'Connor & Bruner (2020), "How to Beat Science and Influence
 * People: Policymakers and Propaganda in Epistemic Networks", BJPS 71(4).
 *
 * Scientists are exactly the Zollman model (models/zollman.js). Added:
 *
 *  - Policy makers: Bayesian agents with the same two hypotheses, starting
 *    sceptical (credence ~ U(0, .5)). They do no experiments. Each listens to
 *    k scientists and updates on those scientists' results. They influence
 *    nobody.
 *  - A propagandist who sees every scientist and talks to every policy maker:
 *      'selective'  shares every result this round that favoured A
 *                   (fewer than n/2 successes). Results a policy maker
 *                   already heard directly are counted again, as in the
 *                   paper's main treatment, unless doubleCount is false.
 *      'production' runs its own studies of B, `resources` pulls a round in
 *                   studies of size `studyN`, and shares only those that
 *                   favoured A. Its data are honest draws; only publication is
 *                   selective.
 *  - Or a journalist, through whom policy makers get all their evidence:
 *      'fair'   one result favouring A and one favouring B each round, chosen
 *               at random; if a side has none this round, last round's pick for
 *               that side is repeated; a side with no result yet is skipped.
 *      'random' two results chosen at random.
 *      'all'    every result.
 *
 * Neither propagandist nor journalist affects the scientists, so with the
 * same seed the science is identical whatever happens to the public.
 * The run ends when the scientists reach consensus. The paper reports mean
 * policy-maker credence in B at the moment of a correct scientific consensus
 * and sets aside runs where the scientists themselves got it wrong.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;
  const Z = isNode ? require('./zollman.js') : root.NET.zollman;

  const PM_TAG = 0x706f6c6d; // "polm"
  const PROP_TAG = 0x70726f70; // "prop"

  const logit = (c) => Math.log(c / (1 - c));
  const sigmoid = (l) => 1 / (1 + Math.exp(-l));

  // which k scientists each policy maker listens to (a random subset, fixed for the run)
  function listenSets(P, K, k, rand) {
    const sets = [];
    for (let j = 0; j < P; j++) {
      const ids = Array.from({ length: K }, (_, i) => i);
      for (let i = K - 1; i > 0; i--) { const r = Math.floor(rand() * (i + 1)); [ids[i], ids[r]] = [ids[r], ids[i]]; }
      sets.push(ids.slice(0, Math.max(0, Math.min(K, k))).sort((x, y) => x - y));
    }
    return sets;
  }

  /*
   * Given this round's scientist results (k[i] >= 0 means scientist i tested B),
   * work out what each policy maker updates on, as a list of [successes, trials].
   */
  function makeRoundEvidence(o, K, n, kRes, rand, memory) {
    const favA = [], favB = [], all = [];
    for (let i = 0; i < K; i++) {
      if (kRes[i] < 0) continue;
      all.push(i);
      if (kRes[i] < n / 2) favA.push(i);
      else if (kRes[i] > n / 2) favB.push(i);
    }
    const broadcast = []; // [successes, trials, sourceScientist or -1]
    let direct = true;
    if (o.mode === 'selective') {
      for (const i of favA) broadcast.push([kRes[i], n, i]);
    } else if (o.mode === 'production') {
      const m = Math.max(1, Math.round(o.studyN));
      const studies = Math.floor(o.resources / m);
      for (let s = 0; s < studies; s++) {
        const x = rng.binomial(rand, m, 0.5 + o.eps);
        if (x < m / 2) broadcast.push([x, m, -1]);
      }
    } else if (o.mode === 'fair' || o.mode === 'random' || o.mode === 'all') {
      direct = false;
      if (o.mode === 'all') for (const i of all) broadcast.push([kRes[i], n, i]);
      else if (o.mode === 'random') {
        const pool = all.slice();
        for (let s = 0; s < 2 && pool.length; s++) {
          const r = Math.floor(rand() * pool.length);
          const i = pool.splice(r, 1)[0];
          broadcast.push([kRes[i], n, i]);
        }
      } else {
        if (favA.length) memory.a = [kRes[favA[Math.floor(rand() * favA.length)]], n, -1];
        if (favB.length) memory.b = [kRes[favB[Math.floor(rand() * favB.length)]], n, -1];
        if (memory.a) broadcast.push(memory.a);
        if (memory.b) broadcast.push(memory.b);
      }
    }
    return { broadcast, direct };
  }

  /*
   * opts: { graph, eps, n, seed, priorLo, priorHi (scientists),
   *         policyMakers (P), listen (k), mode: 'none' | 'selective' |
   *         'production' | 'fair' | 'random' | 'all', resources, studyN,
   *         doubleCount, maxRounds, recordHistory }
   */
  function createRun(opts) {
    const o = Object.assign({ policyMakers: 10, listen: 5, mode: 'none', resources: 50, studyN: 10, doubleCount: true }, opts);
    const sci = Z.createRun({ graph: o.graph, eps: o.eps, n: o.n, seed: o.seed, priorLo: o.priorLo, priorHi: o.priorHi, maxRounds: o.maxRounds ?? 10000, recordHistory: o.recordHistory });
    const K = o.graph.n, P = o.policyMakers, n = sci.n;
    const L = Math.log((0.5 + sci.eps) / (0.5 - sci.eps));
    const pmRand = rng.mulberry32(rng.mix(o.seed, PM_TAG));
    const pl = new Float64Array(P);
    for (let j = 0; j < P; j++) pl[j] = logit(Math.min(0.5 - 1e-9, Math.max(1e-9, 0.5 * pmRand())));
    const listens = listenSets(P, K, o.listen, pmRand);
    const memory = {};
    const run = {
      sci, P, listens, mode: o.mode, pl,
      pmHistory: [], broadcastHistory: [],
      lastBroadcast: [],
      get round() { return sci.round; },
      get status() { return sci.status; },
      pmCredence: (j) => sigmoid(pl[j]),
      pmMean() { let s = 0; for (let j = 0; j < P; j++) s += sigmoid(pl[j]); return s / P; },
      step,
    };
    const record = o.recordHistory !== false;
    function snap() { if (record) run.pmHistory.push(Float32Array.from(pl, sigmoid)); }
    snap();

    function step() {
      if (!sci.step()) return false;
      const t = sci.round - 1;
      const r = rng.mulberry32(rng.mix(o.seed, t, PROP_TAG));
      const { broadcast, direct } = makeRoundEvidence(Object.assign({}, o, { eps: sci.eps }), K, n, sci.lastK, r, memory);
      run.lastBroadcast = broadcast;
      for (let j = 0; j < P; j++) {
        let d = 0;
        if (direct) for (const i of listens[j]) if (sci.lastK[i] >= 0) d += 2 * sci.lastK[i] - n;
        for (const [x, m, src] of broadcast) {
          if (!o.doubleCount && direct && src >= 0 && listens[j].includes(src)) continue;
          d += 2 * x - m;
        }
        pl[j] += d * L;
      }
      if (record) run.broadcastHistory.push(broadcast.length);
      snap();
      return true;
    }
    return run;
  }

  /*
   * Fast Monte Carlo path. Returns { outcome: scientists' outcome,
   * pmMean: mean policy-maker credence in B when the scientists stopped,
   * rounds }.
   */
  function simulate(graph, o, rand) {
    const K = graph.n;
    const eps = Math.min(0.499, Math.max(1e-6, o.eps));
    const n = Math.max(1, Math.round(o.n));
    const L = Math.log((0.5 + eps) / (0.5 - eps));
    const pB = 0.5 + eps;
    const cut = Math.log(99);
    const P = o.policyMakers ?? 10;
    const l = new Float64Array(K);
    for (let i = 0; i < K; i++) l[i] = logit(Math.min(1 - 1e-12, Math.max(1e-12, rand())));
    const pl = new Float64Array(P);
    for (let j = 0; j < P; j++) pl[j] = logit(Math.min(0.5 - 1e-9, Math.max(1e-9, 0.5 * rand())));
    const listens = listenSets(P, K, o.listen ?? K, rand);
    const kRes = new Int32Array(K), e = new Float64Array(K);
    const { offsets, nbrs } = graph;
    const memory = {};
    const cfg = Object.assign({ mode: 'none', resources: 50, studyN: 10, doubleCount: true }, o, { eps });
    const maxRounds = o.maxRounds ?? 10000;
    let round = 0, outcome = 'timeout';
    for (;;) {
      let any = false, all = true;
      for (let i = 0; i < K; i++) { if (l[i] > 0) any = true; if (!(l[i] > cut)) all = false; }
      if (!any) { outcome = 'incorrect'; break; }
      if (all) { outcome = 'correct'; break; }
      if (round >= maxRounds) break;
      for (let i = 0; i < K; i++) {
        if (l[i] > 0) { kRes[i] = rng.binomial(rand, n, pB); e[i] = 2 * kRes[i] - n; }
        else { kRes[i] = -1; e[i] = 0; }
      }
      for (let i = 0; i < K; i++) {
        let s = e[i];
        for (let q = offsets[i]; q < offsets[i + 1]; q++) s += e[nbrs[q]];
        l[i] += s * L;
      }
      const { broadcast, direct } = makeRoundEvidence(cfg, K, n, kRes, rand, memory);
      for (let j = 0; j < P; j++) {
        let d = 0;
        if (direct) for (const i of listens[j]) d += e[i];
        for (const [x, m, src] of broadcast) {
          if (!cfg.doubleCount && direct && src >= 0 && listens[j].includes(src)) continue;
          d += 2 * x - m;
        }
        pl[j] += d * L;
      }
      round++;
    }
    let s = 0;
    for (let j = 0; j < P; j++) s += sigmoid(pl[j]);
    return { outcome, pmMean: s / P, rounds: round };
  }

  const api = { createRun, simulate, listenSets };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.propaganda = api;
  }
})(typeof self !== 'undefined' ? self : this);
