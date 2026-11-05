/*
 * Learning whom to trust: the self-assembling network model of Barrett,
 * Skyrms & Mohseni (2019, BJPS 70(1)) with the epistemic-vigilance extension
 * of Pozzi (2025, "From Individual Trust to Collective Knowledge: Modeling
 * Epistemic Vigilance", CIFMA).
 *
 *  - N agents, each with a fixed reliability r ~ U(0, 1): the chance that
 *    observing nature gives them the true answer.
 *  - A run is a sequence of problems. On each problem every agent starts with
 *    an inaccurate belief and has R rounds to acquire the accurate one.
 *  - Each agent keeps an "urn" with one ball for nature, one for itself and
 *    one for every other agent. Each round agents take turns in a random
 *    order; an agent draws a ball and
 *       nature  -> gets the accurate belief with probability r (else an
 *                  inaccurate one); the ball is reinforced on success;
 *       itself  -> keeps its belief; reinforced if that belief is accurate;
 *       agent j -> adopts j's current belief; reinforcement depends on the
 *                  vigilance V and the scenario:
 *         credulous: always reinforce j if j was accurate; reinforce an
 *                    inaccurate j with probability 1 - V;
 *         sceptical: never reinforce an inaccurate j; reinforce an accurate
 *                    j with probability V.
 *    "Reinforce" adds a ball. With V = 1 both scenarios are Barrett et al.'s
 *    rule: reinforce whatever produced a true belief.
 *  - Urns persist across problems, so trust accumulates.
 *  - Optional turnover: each round each agent is replaced with probability q
 *    by a newcomer with a fresh reliability and a fresh urn. Others' balls for
 *    that seat stay, since they cannot tell the person has changed.
 *  - Collective knowledge on a problem: the mean share of agents holding the
 *    accurate belief over its last Tw rounds.
 *
 * Choices Pozzi's summary leaves open, made explicit here: a failed
 * observation of nature leaves the agent with the inaccurate belief, and
 * turnover is applied at the start of each round.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;

  // Fenwick tree for sampling from an urn of N+1 weights in O(log N)
  function Urn(size) {
    this.n = size;
    this.tree = new Float64Array(size + 1);
    this.w = new Float64Array(size);
    this.total = 0;
  }
  Urn.prototype.add = function (i, v) {
    this.w[i] += v;
    this.total += v;
    for (let k = i + 1; k <= this.n; k += k & -k) this.tree[k] += v;
  };
  Urn.prototype.reset = function () {
    this.tree.fill(0); this.w.fill(0); this.total = 0;
    for (let i = 0; i < this.n; i++) this.add(i, 1);
  };
  Urn.prototype.sample = function (u) {
    let target = u * this.total, pos = 0;
    let step = 1;
    while (step * 2 <= this.n) step *= 2;
    for (; step > 0; step >>= 1) {
      const nxt = pos + step;
      if (nxt <= this.n && this.tree[nxt] < target) { pos = nxt; target -= this.tree[nxt]; }
    }
    return Math.min(pos, this.n - 1);
  };

  /*
   * opts: { N, rounds (per problem), problems, scenario: 'credulous' |
   *         'sceptical', V, turnover, window, seed | rand, record }
   * Seat index N in each urn is "nature"; seat i is the agent itself.
   */
  function createRun(opts) {
    const N = opts.N;
    const R = opts.rounds ?? 100, P = opts.problems ?? 100, Tw = opts.window ?? 20;
    const V = opts.V ?? 1, q = opts.turnover ?? 0;
    const credulous = opts.scenario !== 'sceptical';
    const perProblem = opts.turnoverEvery !== 'round';
    const rand = opts.rand || rng.mulberry32(rng.mix(opts.seed >>> 0, N, 0x74727374));
    const NATURE = N;
    const rel = new Float64Array(N), belief = new Uint8Array(N);
    const urns = Array.from({ length: N }, () => new Urn(N + 1));
    for (let i = 0; i < N; i++) { rel[i] = rand(); urns[i].reset(); }
    const order = Int32Array.from({ length: N }, (_, i) => i);
    const run = {
      N, R, P, Tw, V, credulous, q, rel, belief, urns,
      problem: 0, round: 0, done: false,
      lastChoice: new Int32Array(N).fill(-1),
      knowledge: [],            // per finished problem
      accurateHistory: [],      // share accurate per round within the current problem
      windowSum: 0,
      replaced: new Uint8Array(N),
      step,
      trust(i, j) { return urns[i].w[j] / urns[i].total; },
    };
    function step() {
      if (run.done) return false;
      run.replaced.fill(0);
      if (run.round === 0) {
        belief.fill(0); run.accurateHistory = []; run.windowSum = 0;
        if (q > 0 && perProblem) for (let i = 0; i < N; i++) if (rand() < q) { rel[i] = rand(); urns[i].reset(); run.replaced[i] = 1; }
      }
      if (q > 0 && !perProblem) for (let i = 0; i < N; i++) if (rand() < q) { rel[i] = rand(); urns[i].reset(); belief[i] = 0; run.replaced[i] = 1; }
      for (let k = N - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); const t = order[k]; order[k] = order[j]; order[j] = t; }
      for (let k = 0; k < N; k++) {
        const i = order[k];
        const c = urns[i].sample(rand());
        run.lastChoice[i] = c;
        if (c === NATURE) {
          belief[i] = rand() < rel[i] ? 1 : 0;
          if (belief[i]) urns[i].add(c, 1);
        } else if (c === i) {
          if (belief[i]) urns[i].add(c, 1);
        } else {
          belief[i] = belief[c];
          const reinforce = belief[c] ? (credulous || rand() < V) : (credulous && rand() < 1 - V);
          if (reinforce) urns[i].add(c, 1);
        }
      }
      let acc = 0;
      for (let i = 0; i < N; i++) acc += belief[i];
      run.accurateHistory.push(acc / N);
      run.round++;
      if (run.round > R - Tw) run.windowSum += acc / N;
      if (run.round >= R) {
        run.knowledge.push(run.windowSum / Tw);
        run.round = 0;
        run.problem++;
        if (run.problem >= P) run.done = true;
      }
      return true;
    }
    return run;
  }

  // Monte Carlo: knowledge per problem for one run
  function simulate(opts, rand) {
    const run = createRun(Object.assign({}, opts, { rand }));
    while (run.step());
    return run.knowledge;
  }

  const api = { createRun, simulate, Urn };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.trust = api;
  }
})(typeof self !== 'undefined' ? self : this);
