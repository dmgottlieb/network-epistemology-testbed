/*
 * Seeded random numbers for reproducible simulations.
 *
 * Works as a classic <script> (attaches to window.NET.rng) and as a Node module,
 * so pages can be opened straight from disk with no build step or server.
 */
(function (root) {
  'use strict';

  // 32-bit integer hash (a splitmix/murmur-style finaliser).
  function hash32(x) {
    x = (x + 0x9e3779b9) | 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x21f0aaad);
    x ^= x >>> 15;
    x = Math.imul(x, 0x735a2d97);
    x ^= x >>> 15;
    return x >>> 0;
  }

  // Combine several integers into one well-mixed 32-bit seed.
  function mix() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      h = hash32(h ^ hash32(arguments[i] | 0));
    }
    return h >>> 0;
  }

  // mulberry32: small, fast, good-enough PRNG returning floats in [0, 1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard normal via Box–Muller.
  function normal(rand) {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /*
   * Binomial(n, p) draw.
   * Exact (n Bernoulli trials) when the distribution is narrow; otherwise a
   * normal approximation rounded to the nearest integer. With n >= 60 and
   * sd >= 3 the approximation error is far below anything the simulations
   * can detect, and it keeps large Monte Carlo sweeps fast.
   */
  function binomial(rand, n, p) {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    const sd = Math.sqrt(n * p * (1 - p));
    if (n < 60 || sd < 3) {
      let k = 0;
      for (let i = 0; i < n; i++) if (rand() < p) k++;
      return k;
    }
    let k = Math.round(n * p + sd * normal(rand));
    if (k < 0) k = 0;
    else if (k > n) k = n;
    return k;
  }

  function randomSeed() {
    return (Math.random() * 4294967296) >>> 0;
  }

  const api = { hash32, mix, mulberry32, normal, binomial, randomSeed };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.rng = api;
  }
})(typeof self !== 'undefined' ? self : this);
