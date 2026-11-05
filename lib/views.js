/*
 * Reusable canvas views for the model pages: a network diagram, a belief
 * trajectory chart and a small "how many are testing B" strip.
 * All colours come from CSS custom properties, so views follow the theme.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ theme
  const theme = {
    T: {},
    table: [],
    read() {
      const cs = getComputedStyle(document.documentElement);
      const g = (k) => cs.getPropertyValue(k).trim();
      this.T = {
        ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), rule: g('--rule'), axis: g('--axis'),
        surface: g('--surface'), good: g('--good'), bad: g('--bad'), warn: g('--warn'),
        mark: g('--mark') || g('--warn'), mono: g('--mono') || 'monospace',
        credA: g('--cred-a'), credB: g('--cred-b'),
      };
      const A = hexRGB(g('--cred-a')), M = hexRGB(g('--cred-mid')), B = hexRGB(g('--cred-b'));
      this.table = [];
      for (let q = 0; q <= 200; q++) {
        const c = q / 200;
        const [from, to, t] = c < 0.5 ? [A, M, c / 0.5] : [M, B, (c - 0.5) / 0.5];
        const mix = from.map((v, i) => Math.round(v + (to[i] - v) * t));
        this.table.push(`rgb(${mix[0]},${mix[1]},${mix[2]})`);
      }
    },
    cred(c) {
      return this.table[Math.max(0, Math.min(200, Math.round(c * 200)))];
    },
    onChange(cb) {
      const fire = () => { this.read(); cb(); };
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fire);
      new MutationObserver(fire).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    },
  };
  function hexRGB(s) {
    s = (s || '#888888').replace('#', '').trim();
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const v = parseInt(s, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // ------------------------------------------------------------ helpers
  function fitCanvas(cv) {
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    cv._dpr = dpr; cv._w = w; cv._h = h;
  }
  function watchSize(canvases, cb) {
    const ro = new ResizeObserver(() => { canvases.forEach(fitCanvas); cb(); });
    canvases.forEach((cv) => ro.observe(cv.parentElement));
    canvases.forEach(fitCanvas);
  }
  function ctxFor(cv) {
    if (!cv._dpr) fitCanvas(cv);
    const ctx = cv.getContext('2d');
    ctx.setTransform(cv._dpr, 0, 0, cv._dpr, 0, 0);
    ctx.clearRect(0, 0, cv._w, cv._h);
    return ctx;
  }
  function tooltip(wrap) {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    wrap.appendChild(tip);
    return {
      el: tip,
      show(html, x, y) {
        tip.innerHTML = html;
        tip.hidden = false;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        let left = x + 14, top = y + 14;
        if (left + tip.offsetWidth > w) left = Math.max(0, x - tip.offsetWidth - 14);
        if (top + tip.offsetHeight > h) top = Math.max(0, y - tip.offsetHeight - 14);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      },
      hide() { tip.hidden = true; },
    };
  }
  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(8));
    return out;
  }
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // ------------------------------------------------------------ network view
  /*
   * new NetView(canvas)
   * view.setGraph(graph, positions)
   * view.draw(scene) with scene = {
   *   value(i): 0..1 for colour (credence), filled(i): bool,
   *   mark(i): truthy to draw the highlight ring (e.g. an explorer),
   *   edgeWeight(i, j): optional, 1 full, 0 invisible, < 0 drawn as broken trust,
   *   particles: [from, to, sign, weight, ...] in groups of 4, progress: 0..1,
   *   focus: agent index or -1 }
   */
  function NetView(canvas) {
    this.cv = canvas;
    this.graph = null;
    this.pos = [];
    this.minD = 0.1;
  }
  NetView.prototype.setGraph = function (graph, pos) {
    this.graph = graph;
    this.pos = pos;
    let best = Infinity;
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) best = Math.min(best, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y));
    this.minD = isFinite(best) ? best : 0.2;
    if (this.minDOverride) this.minD = this.minDOverride;
  };
  NetView.prototype.geometry = function () {
    const W = this.cv._w || 300, H = this.cv._h || 300;
    const size = Math.min(W, H);
    const ox = (W - size) / 2, oy = (H - size) / 2;
    const r = Math.max(2.5, Math.min(13, this.minD * size * 0.36));
    return { W, H, r, px: (p) => ox + p.x * size, py: (p) => oy + p.y * size };
  };
  NetView.prototype.hit = function (ev) {
    const rect = this.cv.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const g = this.geometry();
    let best = -1, bd = Infinity;
    this.pos.forEach((p, i) => {
      const d = Math.hypot(g.px(p) - x, g.py(p) - y);
      if (d < bd) { bd = d; best = i; }
    });
    return { i: bd <= g.r + 6 ? best : -1, x, y };
  };
  NetView.prototype.draw = function (scene) {
    const T = theme.T;
    const ctx = ctxFor(this.cv);
    const g = this.geometry();
    const { pos, graph } = this;
    if (!graph) return;
    const N = graph.n;
    const focus = scene.focus ?? -1;
    const E = graph.edges.length;
    const baseAlpha = E > 600 ? 0.3 : E > 150 ? 0.55 : 0.9;

    // edges
    ctx.lineWidth = 1;
    if (!scene.edgeWeight) {
      ctx.strokeStyle = T.axis;
      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      for (const [i, j] of graph.edges) { ctx.moveTo(g.px(pos[i]), g.py(pos[i])); ctx.lineTo(g.px(pos[j]), g.py(pos[j])); }
      ctx.stroke();
    } else {
      for (const [i, j] of graph.edges) {
        const w = scene.edgeWeight(i, j);
        if (w <= 0 && w > -0.02) {
          // trust broken: a faint dotted trace so the structure stays legible
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = T.axis;
          ctx.globalAlpha = baseAlpha * 0.35;
        } else if (w < 0) {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = T.bad;
          ctx.globalAlpha = Math.min(1, 0.25 + 0.6 * -w) * baseAlpha;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = T.axis;
          ctx.globalAlpha = baseAlpha * (0.15 + 0.85 * w);
          ctx.lineWidth = 0.75 + 1.25 * w;
        }
        ctx.beginPath();
        ctx.moveTo(g.px(pos[i]), g.py(pos[i]));
        ctx.lineTo(g.px(pos[j]), g.py(pos[j]));
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    if (focus >= 0 && focus < N) {
      ctx.strokeStyle = T.ink2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const j of graph.adj[focus]) {
        const w = scene.edgeWeight ? scene.edgeWeight(focus, j) : 1;
        if (w <= 0) continue;
        ctx.moveTo(g.px(pos[focus]), g.py(pos[focus]));
        ctx.lineTo(g.px(pos[j]), g.py(pos[j]));
      }
      ctx.stroke();
    }

    // particles
    const P = scene.particles;
    const p = scene.progress ?? 1;
    if (P && P.length && p < 1) {
      const ep = ease(p);
      const fade = p > 0.85 ? (1 - p) / 0.15 : 1;
      const rr = Math.max(1.6, Math.min(3, g.r * 0.32));
      for (let q = 0; q < P.length; q += 4) {
        const w = P[q + 3];
        if (w <= 0.02) continue;
        const a = pos[P[q]], b = pos[P[q + 1]];
        // distrusted results stall partway along the link
        const reach = ep * (0.35 + 0.65 * Math.min(1, w));
        const x = g.px(a) + (g.px(b) - g.px(a)) * reach;
        const y = g.py(a) + (g.py(b) - g.py(a)) * reach;
        ctx.globalAlpha = Math.max(0, fade) * (0.3 + 0.7 * Math.min(1, w));
        ctx.fillStyle = P[q + 2] > 0 ? theme.cred(1) : P[q + 2] < 0 ? theme.cred(0) : theme.cred(0.5);
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // agents; scene.shape(i) may return 'square' or 'diamond' (default circle)
    const path = (shape, x, y, r) => {
      ctx.beginPath();
      if (shape === 'square') { const h = r * 0.9; ctx.rect(x - h, y - h, 2 * h, 2 * h); }
      else if (shape === 'diamond') { const h = r * 1.25; ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); }
      else ctx.arc(x, y, r, 0, Math.PI * 2);
    };
    for (let i = 0; i < N; i++) {
      const c = scene.value(i);
      const x = g.px(pos[i]), y = g.py(pos[i]);
      const shape = scene.shape ? scene.shape(i) : 'circle';
      const rr = g.r * (scene.size ? scene.size(i) : 1);
      const col = scene.color ? scene.color(i) || theme.cred(c) : theme.cred(c);
      path(shape, x, y, rr);
      if (scene.filled(i)) {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = T.surface;
        ctx.stroke();
      } else {
        ctx.fillStyle = T.surface;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, rr * 0.3);
        ctx.strokeStyle = col;
        path(shape, x, y, rr - ctx.lineWidth / 2);
        ctx.stroke();
      }
      if (scene.mark && scene.mark(i)) {
        path(shape, x, y, rr + 3.5);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = T.mark;
        ctx.stroke();
      }
      if (i === focus) {
        path(shape, x, y, rr + (scene.mark && scene.mark(i) ? 7 : 4));
        ctx.lineWidth = 2;
        ctx.strokeStyle = T.ink;
        ctx.stroke();
      }
    }
  };

  // ------------------------------------------------------------ trajectories
  /*
   * new TrajView(canvas)
   * view.draw({ history: [Float32Array per round], xMax, scale: 'credence'|'logodds',
   *             focus, hoverRound, bands: [{ from, to, label }], refs: [{ v, label, color }] })
   */
  const LIM = 7;
  function TrajView(canvas) { this.cv = canvas; }
  TrajView.prototype.geometry = function (o) {
    const W = this.cv._w || 300, H = this.cv._h || 190;
    const m = { l: 46, r: 12, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xMax = Math.max(20, o.xMax || 0);
    const X = (r) => m.l + (r / xMax) * pw;
    const Y = o.scale === 'logodds'
      ? (c) => {
          let v = Math.log(c / (1 - c));
          if (!isFinite(v)) v = v > 0 ? LIM : -LIM;
          v = Math.max(-LIM, Math.min(LIM, v));
          return m.t + ((LIM - v) / (2 * LIM)) * ph;
        }
      : (c) => m.t + (1 - c) * ph;
    return { W, H, m, pw, ph, xMax, X, Y };
  };
  TrajView.prototype.pick = function (ev, o) {
    const rect = this.cv.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const G = this.geometry(o);
    const hist = o.history;
    const r = Math.max(0, Math.min(hist.length - 1, Math.round(((x - G.m.l) / G.pw) * G.xMax)));
    let best = -1, bd = Infinity;
    for (let i = 0; i < hist[r].length; i++) {
      const d = Math.abs(G.Y(hist[r][i]) - y);
      if (d < bd) { bd = d; best = i; }
    }
    return { round: r, agent: bd < 9 ? best : -1, x, y };
  };
  TrajView.prototype.draw = function (o) {
    const T = theme.T;
    const ctx = ctxFor(this.cv);
    const G = this.geometry(o);
    const { m, pw, ph, X, Y } = G;
    ctx.font = `10.5px ${T.mono}`;

    for (const b of o.bands || []) {
      const y1 = Y(b.to), y2 = Y(b.from);
      ctx.fillStyle = T.bad;
      ctx.globalAlpha = 0.07;
      ctx.fillRect(m.l, y1, pw, y2 - y1);
      ctx.globalAlpha = 1;
    }
    const yTicks = o.scale === 'logodds' ? [0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999] : [0, 0.25, 0.5, 0.75, 1];
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const v of yTicks) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = T.rule;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.fillStyle = T.muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), m.l - 6, y);
    }
    const refs = o.refs || [];
    for (const r of refs) {
      const y = Math.round(Y(r.v)) + 0.5;
      ctx.strokeStyle = r.color || T.axis;
      ctx.globalAlpha = r.color ? 0.6 : 1;
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of niceTicks(0, G.xMax, 5)) {
      const x = X(v);
      ctx.fillStyle = T.muted;
      ctx.fillText(v >= 10000 ? v / 1000 + 'K' : v.toLocaleString(), x, m.t + ph + 6);
      ctx.strokeStyle = T.axis;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, m.t + ph); ctx.lineTo(Math.round(x) + 0.5, m.t + ph + 3); ctx.stroke();
    }

    const hist = o.history;
    const len = hist.length;
    const N = hist[0].length;
    const last = hist[len - 1];
    const stride = Math.max(1, Math.floor(len / Math.max(50, pw)));
    const focus = o.focus ?? -1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const line = (i) => {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(hist[0][i]));
      for (let r = stride; r < len; r += stride) ctx.lineTo(X(r), Y(hist[r][i]));
      ctx.lineTo(X(len - 1), Y(last[i]));
      ctx.stroke();
    };
    ctx.lineWidth = N > 40 ? 1 : 1.4;
    for (let i = 0; i < N; i++) {
      if (i === focus) continue;
      ctx.strokeStyle = theme.cred(last[i]);
      ctx.globalAlpha = focus >= 0 ? 0.18 : 0.85;
      line(i);
    }
    ctx.globalAlpha = 1;
    if (focus >= 0 && focus < N) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = theme.cred(last[focus]);
      line(focus);
    }
    if (len === 1) {
      for (let i = 0; i < N; i++) {
        ctx.fillStyle = theme.cred(last[i]);
        ctx.beginPath();
        ctx.arc(X(0) + 3, Y(last[i]), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // labels for reference lines and bands, on a backing so lines never hide them
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const label = (text, y) => {
      const w = ctx.measureText(text).width + 8;
      ctx.fillStyle = T.surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(m.l + pw - w, y - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = T.muted;
      ctx.fillText(text, m.l + pw - 4, y);
    };
    for (const r of refs) if (r.label) label(r.label, Y(r.v) + (r.below === false ? -9 : 9));
    for (const b of o.bands || []) if (b.label && Y(b.from) - Y(b.to) > 18) label(b.label, Y(b.from) - 9);
    if (o.hoverRound != null) {
      const x = Math.round(X(o.hoverRound)) + 0.5;
      ctx.strokeStyle = T.ink2;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }
  };

  // ------------------------------------------------------------ tester strip
  /*
   * new StripView(canvas)
   * view.draw({ tested: [count per round], explorers: [count per round] | null,
   *             trap: [bool per round] | null, N, xMax, hoverRound })
   * Area = agents testing B each round, with a highlighted subset overlaid.
   * Rounds flagged in `trap` are marked along the baseline.
   */
  function StripView(canvas) { this.cv = canvas; }
  StripView.prototype.geometry = function (o) {
    const W = this.cv._w || 300, H = this.cv._h || 60;
    const m = { l: 46, r: 12, t: 6, b: 6 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xMax = Math.max(20, o.xMax || 0);
    return { W, H, m, pw, ph, xMax, X: (r) => m.l + (r / xMax) * pw, Y: (v) => m.t + ph - (v / Math.max(1, o.N)) * ph };
  };
  StripView.prototype.draw = function (o) {
    const T = theme.T;
    const ctx = ctxFor(this.cv);
    const G = this.geometry(o);
    const { m, pw, ph, X, Y } = G;
    const t = o.tested;
    const len = t.length;
    ctx.font = `10.5px ${T.mono}`;
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(o.N), m.l - 6, Y(o.N));
    ctx.fillText('0', m.l - 6, Y(0));
    ctx.strokeStyle = T.rule;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(o.N)) + 0.5); ctx.lineTo(m.l + pw, Math.round(Y(o.N)) + 0.5); ctx.stroke();
    ctx.strokeStyle = T.axis;
    ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(0)) + 0.5); ctx.lineTo(m.l + pw, Math.round(Y(0)) + 0.5); ctx.stroke();
    if (len < 2) return;
    const step = Math.max(1, Math.floor(len / Math.max(50, pw)));
    // rounds 1..len-1 (entry 0 is the start)
    const area = (arr, color, alpha) => {
      ctx.beginPath();
      ctx.moveTo(X(1), Y(0));
      for (let r = 1; r < len; r += step) {
        let v = 0;
        for (let q = r; q < Math.min(len, r + step); q++) v = Math.max(v, arr[q]);
        ctx.lineTo(X(r), Y(v));
      }
      ctx.lineTo(X(len - 1), Y(arr[len - 1]));
      ctx.lineTo(X(len - 1), Y(0));
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    area(t, T.credB, 0.28);
    if (o.explorers) area(o.explorers, T.mark, 0.9);
    // rounds flagged as trapped (e.g. nobody believed B going in)
    if (o.trap) {
      ctx.fillStyle = T.bad;
      for (let r = 1; r < len; r++) if (o.trap[r]) ctx.fillRect(X(r - 1), Y(0) - 3, Math.max(1, X(r) - X(r - 1)), 3);
    }
    if (o.hoverRound != null) {
      const x = Math.round(X(o.hoverRound)) + 0.5;
      ctx.strokeStyle = T.ink2;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }
  };

  root.NET = root.NET || {};
  root.NET.views = { theme, NetView, TrajView, StripView, fitCanvas, watchSize, tooltip, niceTicks, ease };
})(typeof self !== 'undefined' ? self : this);
