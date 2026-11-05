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

  /*
   * The Choose-Your-epsilon game (their section 3). One "hero" (agent 0) plays
   * epsHero, everyone else epsGroup. To compare hero strategies precisely we
   * use common random numbers: each run's coin flips and payoff draws are
   * fixed in advance per (agent, round), so changing epsHero changes only the
   * hero's decisions, not the luck.
   */
  function makeNoise(N, rounds, rand) {
    const u = new Float64Array(N * rounds), z = new Float64Array(N * rounds), tie = new Float64Array(N * rounds);
    for (let q = 0; q < N * rounds; q++) { u[q] = rand(); z[q] = rng.normal(rand); tie[q] = rand(); }
    return { u, z, tie };
  }
  function playWithNoise(graph, epsOf, noise, o) {
    const N = graph.n;
    const sum = new Float64Array(N), cnt = new Float64Array(N), res = new Float64Array(N);
    const risky = new Uint8Array(N), pulls = new Float64Array(N);
    const { offsets, nbrs } = graph;
    for (let t = 0; t < o.rounds; t++) {
      for (let i = 0; i < N; i++) {
        const q = t * N + i;
        let prefer;
        if (cnt[i] === 0) prefer = true;
        else {
          const m = sum[i] / cnt[i];
          prefer = m > 0 ? true : m < 0 ? false : noise.tie[q] < 0.5;
        }
        const r = noise.u[q] < epsOf(i) ? !prefer : prefer;
        risky[i] = r ? 1 : 0;
        if (r) { res[i] = o.mean + o.sd * noise.z[q]; pulls[i]++; }
      }
      for (let i = 0; i < N; i++) {
        if (risky[i]) { sum[i] += res[i]; cnt[i]++; }
        for (let q = offsets[i]; q < offsets[i + 1]; q++) {
          const j = nbrs[q];
          if (risky[j]) { sum[i] += res[j]; cnt[i]++; }
        }
      }
    }
    return pulls;
  }
  // hero's expected payoff per pull for each epsHero in a list
  function heroPayoffs(graph, epsGroup, epsHeroes, runs, rand, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const out = new Float64Array(epsHeroes.length);
    for (let r = 0; r < runs; r++) {
      const noise = makeNoise(graph.n, o.rounds, rand);
      epsHeroes.forEach((eh, h) => {
        const pulls = playWithNoise(graph, (i) => (i === 0 ? eh : epsGroup), noise, o);
        out[h] += (pulls[0] / o.rounds) * o.mean;
      });
    }
    for (let h = 0; h < out.length; h++) out[h] /= runs;
    return out;
  }
  // best response: maximise a quadratic fitted around the grid maximum
  function bestResponse(xs, ys) {
    let k = 0;
    ys.forEach((y, i) => { if (y > ys[k]) k = i; });
    const lo = Math.max(0, k - 3), hi = Math.min(xs.length - 1, k + 3);
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let i = lo; i <= hi; i++) {
      const x = xs[i], y = ys[i];
      S0++; S1 += x; S2 += x * x; S3 += x * x * x; S4 += x * x * x * x;
      T0 += y; T1 += x * y; T2 += x * x * y;
    }
    // solve the 3x3 normal equations for y = c0 + c1 x + c2 x^2
    const A = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], B = [T0, T1, T2];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-18) return xs[k];
    const col = (c) => A.map((row, r) => row.map((v, j) => (j === c ? B[r] : v)));
    const c1 = det(col(1)) / D, c2 = det(col(2)) / D;
    if (c2 >= 0) return xs[k];
    return Math.min(xs[hi], Math.max(xs[lo], -c1 / (2 * c2)));
  }

  // Step-by-step version of playWithNoise for animation (same rules).
  function createEpisode(graph, epsOf, noise, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const N = graph.n;
    const ep = {
      N, round: 0, rounds: o.rounds,
      sum: new Float64Array(N), cnt: new Float64Array(N), res: new Float64Array(N),
      risky: new Uint8Array(N), explored: new Uint8Array(N), pulls: new Float64Array(N), payoff: new Float64Array(N),
      estimate(i) { return ep.cnt[i] ? ep.sum[i] / ep.cnt[i] : null; },
      done() { return ep.round >= o.rounds; },
      step() {
        if (ep.done()) return false;
        const t = ep.round;
        const { offsets, nbrs } = graph;
        for (let i = 0; i < N; i++) {
          const q = t * N + i;
          let prefer;
          if (ep.cnt[i] === 0) prefer = true;
          else { const m = ep.sum[i] / ep.cnt[i]; prefer = m > 0 ? true : m < 0 ? false : noise.tie[q] < 0.5; }
          const explore = noise.u[q] < epsOf(i);
          const r = explore ? !prefer : prefer;
          ep.explored[i] = explore ? 1 : 0;
          ep.risky[i] = r ? 1 : 0;
          if (r) { ep.res[i] = o.mean + o.sd * noise.z[q]; ep.pulls[i]++; ep.payoff[i] += ep.res[i]; }
        }
        for (let i = 0; i < N; i++) {
          if (ep.risky[i]) { ep.sum[i] += ep.res[i]; ep.cnt[i]++; }
          for (let q = offsets[i]; q < offsets[i + 1]; q++) { const j = nbrs[q]; if (ep.risky[j]) { ep.sum[i] += ep.res[j]; ep.cnt[i]++; } }
        }
        ep.round = t + 1;
        return true;
      },
    };
    return ep;
  }

  const api = { simulate, performance, DEFAULTS, makeNoise, playWithNoise, heroPayoffs, bestResponse, createEpisode };
  if (isNode) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.kz = api;
  }
})(typeof self !== 'undefined' ? self : this);
