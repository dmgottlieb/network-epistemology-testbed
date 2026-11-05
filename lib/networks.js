/*
 * Network (graph) generators and layouts for epistemic network models.
 *
 * A graph is { n, edges: [[i, j], ...], adj: [[neighbours of 0], ...],
 *              offsets: Int32Array, nbrs: Int32Array }   (CSR form for fast loops)
 * Layout positions are in the unit square.
 */
(function (root) {
  'use strict';

  const rngLib =
    typeof module !== 'undefined' && module.exports ? require('./rng.js') : root.NET.rng;

  // ---------------------------------------------------------------- helpers

  function buildGraph(n, edgeList) {
    const seen = new Set();
    const edges = [];
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b] of edgeList) {
      if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
      const i = Math.min(a, b);
      const j = Math.max(a, b);
      const key = i * n + j;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
      adj[i].push(j);
      adj[j].push(i);
    }
    for (const list of adj) list.sort((x, y) => x - y);
    const offsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + adj[i].length;
    const nbrs = new Int32Array(offsets[n]);
    for (let i = 0; i < n; i++) nbrs.set(adj[i], offsets[i]);
    return { n, edges, adj, offsets, nbrs };
  }

  function components(graph) {
    const comp = new Int32Array(graph.n).fill(-1);
    let count = 0;
    for (let s = 0; s < graph.n; s++) {
      if (comp[s] >= 0) continue;
      const stack = [s];
      comp[s] = count;
      while (stack.length) {
        const v = stack.pop();
        for (const w of graph.adj[v]) {
          if (comp[w] < 0) {
            comp[w] = count;
            stack.push(w);
          }
        }
      }
      count++;
    }
    return count;
  }

  function stats(graph) {
    const degrees = graph.adj.map((a) => a.length);
    const mean = degrees.reduce((s, d) => s + d, 0) / Math.max(1, graph.n);
    const possible = (graph.n * (graph.n - 1)) / 2;
    return {
      edges: graph.edges.length,
      meanDegree: mean,
      density: possible ? graph.edges.length / possible : 0,
      components: components(graph),
    };
  }

  // --------------------------------------------------------- edge builders

  function completeEdges(n) {
    const e = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) e.push([i, j]);
    return e;
  }

  function ringLatticeEdges(n, k) {
    const e = [];
    if (n < 2) return e;
    const reach = Math.max(1, Math.min(k, Math.floor((n - 1) / 2) || 1));
    for (let i = 0; i < n; i++) for (let d = 1; d <= reach; d++) e.push([i, (i + d) % n]);
    return e;
  }

  function gridDims(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  function clusterSizes(n, c) {
    c = Math.max(1, Math.min(c, Math.floor(n / 2) || 1));
    const sizes = [];
    for (let i = 0; i < c; i++) sizes.push(Math.floor(n / c) + (i < n % c ? 1 : 0));
    return sizes;
  }

  // ------------------------------------------------------------ registry
  // Each entry: label, short description, parameters, minimum sensible n,
  // whether it is random (needs a new draw per run), edges(n, params, rand),
  // and a layout(n, params, graph) -> [{x, y}].

  const TAU = Math.PI * 2;

  function circle(n, r, cx, cy, phase) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (phase || 0) + (TAU * i) / Math.max(1, n);
      pts.push({ x: (cx ?? 0.5) + r * Math.cos(a), y: (cy ?? 0.5) + r * Math.sin(a) });
    }
    return pts;
  }

  function circleLayout(n) {
    return circle(n, 0.42);
  }

  function hubLayout(n) {
    return [{ x: 0.5, y: 0.5 }].concat(circle(n - 1, 0.42));
  }

  // Fruchterman–Reingold force layout with a deterministic start.
  function forceLayout(n, graph, iterations) {
    const pos = circle(n, 0.35);
    // small deterministic jitter so symmetric starts can break symmetry
    const jr = rngLib.mulberry32(rngLib.mix(n, graph.edges.length, 7));
    for (const p of pos) {
      p.x += (jr() - 0.5) * 0.02;
      p.y += (jr() - 0.5) * 0.02;
    }
    const k = Math.sqrt(1 / Math.max(1, n));
    let temp = 0.1;
    const iters = iterations || 300;
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let it = 0; it < iters; it++) {
      dx.fill(0);
      dy.fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let vx = pos[i].x - pos[j].x;
          let vy = pos[i].y - pos[j].y;
          let d2 = vx * vx + vy * vy || 1e-6;
          const f = (k * k) / d2;
          dx[i] += vx * f;
          dy[i] += vy * f;
          dx[j] -= vx * f;
          dy[j] -= vy * f;
        }
      }
      for (const [i, j] of graph.edges) {
        const vx = pos[i].x - pos[j].x;
        const vy = pos[i].y - pos[j].y;
        const d = Math.sqrt(vx * vx + vy * vy) || 1e-6;
        const f = d / k;
        dx[i] -= vx * f;
        dy[i] -= vy * f;
        dx[j] += vx * f;
        dy[j] += vy * f;
      }
      for (let i = 0; i < n; i++) {
        // gentle pull to the centre keeps disconnected parts on screen
        dx[i] += (0.5 - pos[i].x) * 0.5;
        dy[i] += (0.5 - pos[i].y) * 0.5;
        const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1e-6;
        const step = Math.min(len, temp);
        pos[i].x += (dx[i] / len) * step;
        pos[i].y += (dy[i] / len) * step;
      }
      temp *= 0.985;
    }
    return normalise(pos);
  }

  function normalise(pos, margin) {
    margin = margin ?? 0.08;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pos) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const s = (1 - 2 * margin) / span;
    const ox = (1 - (maxX - minX) * s) / 2;
    const oy = (1 - (maxY - minY) * s) / 2;
    return pos.map((p) => ({ x: ox + (p.x - minX) * s, y: oy + (p.y - minY) * s }));
  }

  const TYPES = {
    complete: {
      label: 'Complete',
      blurb: 'Everyone sees everyone’s results.',
      params: [],
      edges: (n) => completeEdges(n),
      layout: (n) => circleLayout(n),
    },
    cycle: {
      label: 'Cycle',
      blurb: 'Each agent hears from two neighbours.',
      params: [],
      edges: (n) => ringLatticeEdges(n, 1),
      layout: (n) => circleLayout(n),
    },
    wheel: {
      label: 'Wheel',
      blurb: 'A cycle plus one hub connected to all.',
      params: [],
      minN: 4,
      edges: (n) => {
        if (n < 4) return completeEdges(n);
        const e = [];
        for (let i = 1; i < n; i++) e.push([0, i]);
        for (let i = 1; i < n; i++) e.push([i, i === n - 1 ? 1 : i + 1]);
        return e;
      },
      layout: (n) => (n < 4 ? circleLayout(n) : hubLayout(n)),
    },
    star: {
      label: 'Star',
      blurb: 'One hub; the rim only hears from the hub.',
      params: [],
      edges: (n) => {
        const e = [];
        for (let i = 1; i < n; i++) e.push([0, i]);
        return e;
      },
      layout: (n) => hubLayout(n),
    },
    line: {
      label: 'Line',
      blurb: 'A chain: a cycle with one link cut.',
      params: [],
      edges: (n) => {
        const e = [];
        for (let i = 0; i < n - 1; i++) e.push([i, i + 1]);
        return e;
      },
      layout: (n) => {
        // a snake so long lines still fit in a square
        const { cols } = gridDims(n);
        const rows = Math.ceil(n / cols);
        const pts = [];
        for (let i = 0; i < n; i++) {
          const r = Math.floor(i / cols);
          let c = i % cols;
          if (r % 2 === 1) c = cols - 1 - c;
          pts.push({ x: c, y: r });
        }
        if (rows === 1) return pts.map((p) => ({ x: 0.08 + (0.84 * p.x) / Math.max(1, n - 1), y: 0.5 }));
        return normalise(pts);
      },
    },
    ringLattice: {
      label: 'Ring lattice',
      blurb: 'A cycle where each agent also hears from the k nearest on each side.',
      params: [{ key: 'k', label: 'Neighbours each side', min: 1, max: 10, step: 1, value: 2 }],
      edges: (n, p) => ringLatticeEdges(n, p.k),
      layout: (n) => circleLayout(n),
    },
    grid: {
      label: 'Grid',
      blurb: 'A square lattice; each agent hears from up to four neighbours.',
      params: [],
      edges: (n) => {
        const { cols } = gridDims(n);
        const e = [];
        for (let i = 0; i < n; i++) {
          const c = i % cols;
          if (c < cols - 1 && i + 1 < n) e.push([i, i + 1]);
          if (i + cols < n) e.push([i, i + cols]);
        }
        return e;
      },
      layout: (n) => {
        const { cols } = gridDims(n);
        const pts = [];
        for (let i = 0; i < n; i++) pts.push({ x: i % cols, y: Math.floor(i / cols) });
        return normalise(pts, 0.1);
      },
    },
    clusters: {
      label: 'Clusters',
      blurb: 'Tight cliques joined in a ring by single bridges.',
      params: [{ key: 'c', label: 'Clusters', min: 2, max: 10, step: 1, value: 3 }],
      edges: (n, p) => {
        const sizes = clusterSizes(n, p.c);
        const e = [];
        const starts = [];
        let s = 0;
        for (const size of sizes) {
          starts.push(s);
          for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) e.push([s + i, s + j]);
          s += size;
        }
        if (sizes.length === 2) e.push([starts[0], starts[1]]);
        else if (sizes.length > 2) {
          for (let c = 0; c < sizes.length; c++) {
            const next = (c + 1) % sizes.length;
            // last member of this cluster to first member of the next
            e.push([starts[c] + sizes[c] - 1, starts[next]]);
          }
        }
        return e;
      },
      layout: (n, p) => {
        const sizes = clusterSizes(n, p.c);
        if (sizes.length === 1) return circleLayout(n);
        const big = 0.3;
        const small = Math.min(0.17, Math.PI * big / sizes.length * 0.85);
        const pts = [];
        sizes.forEach((size, c) => {
          const a = -Math.PI / 2 + (TAU * c) / sizes.length;
          const cx = 0.5 + big * Math.cos(a);
          const cy = 0.5 + big * Math.sin(a);
          // rotate each cluster so its bridge members face their neighbours
          const phase = a + Math.PI / 2 + Math.PI / Math.max(1, size);
          const local = circle(size, size === 1 ? 0 : small, cx, cy, phase);
          for (const q of local) pts.push(q);
        });
        return normalise(pts);
      },
    },
    erdosRenyi: {
      label: 'Random (Erdős–Rényi)',
      blurb: 'Every pair is linked independently with probability p.',
      random: true,
      params: [{ key: 'p', label: 'Link probability', min: 0.02, max: 1, step: 0.01, value: 0.3 }],
      edges: (n, p, rand) => {
        const e = [];
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < p.p) e.push([i, j]);
        return e;
      },
      layout: (n, p, g) => forceLayout(n, g, 250),
    },
    randomConnected: {
      label: 'Random, connected (G(N, q))',
      blurb: 'Every pair linked with probability q, redrawn until everyone is connected.',
      random: true,
      params: [{ key: 'q', label: 'Link probability', min: 0.1, max: 1, step: 0.05, value: 0.5 }],
      edges: (n, p, rand) => {
        for (let tries = 0; tries < 1000; tries++) {
          const e = [];
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rand() < p.q) e.push([i, j]);
          if (components(buildGraph(n, e)) === 1) return e;
        }
        return completeEdges(n);
      },
      layout: (n, p, g) => forceLayout(n, g, 250),
    },
    smallWorld: {
      label: 'Small world',
      blurb: 'A ring lattice with each link rewired at random with probability β (Watts–Strogatz).',
      random: true,
      params: [
        { key: 'k', label: 'Neighbours each side', min: 1, max: 10, step: 1, value: 2 },
        { key: 'beta', label: 'Rewiring β', min: 0, max: 1, step: 0.01, value: 0.1 },
      ],
      edges: (n, p, rand) => {
        const base = ringLatticeEdges(n, p.k);
        const set = new Set(base.map(([a, b]) => Math.min(a, b) * n + Math.max(a, b)));
        const out = [];
        for (const [a, b] of base) {
          if (rand() < p.beta && n > 2) {
            // rewire the far end to a random node, avoiding loops and duplicates
            for (let tries = 0; tries < 20; tries++) {
              const c = Math.floor(rand() * n);
              const key = Math.min(a, c) * n + Math.max(a, c);
              if (c !== a && !set.has(key)) {
                set.delete(Math.min(a, b) * n + Math.max(a, b));
                set.add(key);
                out.push([a, c]);
                break;
              }
              if (tries === 19) out.push([a, b]);
            }
          } else out.push([a, b]);
        }
        return out;
      },
      layout: (n) => circleLayout(n),
    },
    scaleFree: {
      label: 'Scale-free (Barabási–Albert)',
      blurb: 'Grown by preferential attachment: a few well-connected hubs.',
      random: true,
      params: [{ key: 'm', label: 'Links per newcomer', min: 1, max: 5, step: 1, value: 1 }],
      edges: (n, p, rand) => {
        const m = Math.max(1, Math.min(p.m, n - 1));
        const e = [];
        const targets = []; // node list repeated by degree
        const seed = Math.min(n, m + 1);
        for (let i = 0; i < seed; i++)
          for (let j = i + 1; j < seed; j++) {
            e.push([i, j]);
            targets.push(i, j);
          }
        for (let v = seed; v < n; v++) {
          const chosen = new Set();
          while (chosen.size < m) {
            const t = targets.length ? targets[Math.floor(rand() * targets.length)] : 0;
            chosen.add(t);
          }
          for (const t of chosen) {
            e.push([v, t]);
            targets.push(v, t);
          }
        }
        return e;
      },
      layout: (n, p, g) => forceLayout(n, g, 300),
    },
  };

  function defaultParams(type) {
    const out = {};
    for (const spec of TYPES[type].params) out[spec.key] = spec.value;
    return out;
  }

  /*
   * Build a network. `seed` only matters for random families.
   * Returns a graph plus layout positions and summary stats.
   */
  function make(type, n, params, seed) {
    const def = TYPES[type];
    if (!def) throw new Error('Unknown network type: ' + type);
    const p = Object.assign(defaultParams(type), params || {});
    const rand = rngLib.mulberry32(rngLib.mix(seed >>> 0, n, 0x6e6574));
    const graph = buildGraph(n, def.edges(n, p, rand));
    graph.type = type;
    graph.params = p;
    return graph;
  }

  function layout(graph) {
    const def = TYPES[graph.type];
    return def.layout(graph.n, graph.params, graph);
  }

  function describe(type, params) {
    const def = TYPES[type];
    const p = Object.assign(defaultParams(type), params || {});
    const bits = def.params.map((s) => `${s.key === 'beta' ? 'β' : s.key} = ${p[s.key]}`);
    return def.label + (bits.length ? ` (${bits.join(', ')})` : '');
  }

  const api = { TYPES, make, layout, stats, buildGraph, defaultParams, describe };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.NET = root.NET || {};
    root.NET.networks = api;
  }
})(typeof self !== 'undefined' ? self : this);
