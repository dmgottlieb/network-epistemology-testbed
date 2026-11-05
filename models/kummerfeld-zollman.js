/*
 * Kummerfeld & Zollman (2016), "Conservatism and the Scientific State of
 * Nature", British Journal for the Philosophy of Science 67(4).
 *
 *   - Two arms. The safe arm ("normal science") always pays 0. The risky arm
 *     pays a draw from a normal distribution with mean 1.
 *   - Each agent pulls one arm per round for T = 50 rounds and sees its own
 *     results and its network neighbours'.
 *   - epsilon-greedy, in the paper's slightly modified form: with probability
 *     1 - eps pull the arm with the higher average payoff among the results
 *     the agent has seen, otherwise pull the other arm.
 *   - Performance = expected payoff per pull, averaged over agents and rounds.
 *
 * Two details are reconstructed, chosen because together they reproduce the
 * paper's Figure 6 (8 agents: complete 0.41 at eps = 0, peak ~0.65 near
 * eps = 0.18; ring 0.54 at eps = 0, peak ~0.62 near eps = 0.13):
 *   - The risky arm's standard deviation is 9. The text says "variance nine",
 *     but sd 3 gives payoffs far above the published curves; sd 9 matches them
 *     and Rosenstock, Bruner & O'Connor (2017) also describe it as sd 9.
 *   - An arm for which an agent has seen no results yet counts as the better
 *     one, so every agent's first greedy choice is the risky arm.
 * Ties between equal averages are broken at random.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const rng = isNode ? require('../lib/rng.js') : root.NET.rng;

  const DEFAULTS = { rounds: 50, mean: 1, sd: 9 };

  // One community run. Returns the share of pulls on the risky arm and the
  // realised mean payoff per pull. Expected payoff = share * mean.
  function simulate(graph, eps, rand, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const N = graph.n;
    const sum = new Float64Array(N), cnt = new Float64Array(N), res = new Float64Array(N);
    const risky = new Uint8Array(N);
    const { offsets, nbrs } = graph;
    let pulls = 0, payoff = 0;
    for (let t = 0; t < o.rounds; t++) {
      for (let i = 0; i < N; i++) {
        let prefer;
        if (cnt[i] === 0) prefer = true;
        else {
          const m = sum[i] / cnt[i];
          prefer = m > 0 ? true : m < 0 ? false : rand() < 0.5;
        }
        const r = rand() < eps ? !prefer : prefer;
        risky[i] = r ? 1 : 0;
        if (r) {
          res[i] = o.mean + o.sd * rng.normal(rand);
          pulls++;
          payoff += res[i];
        }
      }
      for (let i = 0; i < N; i++) {
        if (risky[i]) { sum[i] += res[i]; cnt[i]++; }
        for (let q = offsets[i]; q < offsets[i + 1]; q++) {
          const j = nbrs[q];
          if (risky[j]) { sum[i] += res[j]; cnt[i]++; }
        }
      }
    }
    return { riskyShare: pulls / (N * o.rounds), payoff: payoff / (N * o.rounds) };
  }

  // Average performance (expected payoff per pull) over many runs.
  function performance(graph, eps, runs, rand, opts) {
    const mean = (opts && opts.mean) ?? DEFAULTS.mean;
    let s = 0, s2 = 0;
    for (let r = 0; r < runs; r++) {
      const v = simulate(graph, eps, rand, opts).riskyShare * mean;
      s += v;
      s2 += v * v;
    }
    const m = s / runs;
    return { mean: m, se: Math.sqrt(Math.max(0, s2 / runs - m * m) / runs) };
  }

  const api = { simulate, performance, DEFAULTS };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.kz = api;
  }
})(typeof self !== 'undefined' ? self : this);
