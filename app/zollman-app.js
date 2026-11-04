/* UI for zollman.html: twin coupled network runs + Monte Carlo experiment. */
(function () {
  'use strict';

  const { rng, networks: NETS, zollman: Z, charts: CH } = window.NET;
  const $ = (id) => document.getElementById(id);

  const EPS_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4];
  const N_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const SPEEDS = [1, 2, 4, 8, 15, 30, 60, Infinity];
  const MAX_ROUNDS = 10000;
  const MAX_PARTICLES = 1600;

  const S = { N: 10, eps: 0.001, n: 1000, lo: 0, hi: 1, seed: 4, speed: 3, scale: 'credence', animate: true, playing: false };

  // ------------------------------------------------------------ theme
  let T = {};
  let credTable = [];
  function hexRGB(s) {
    s = s.replace('#', '').trim();
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const v = parseInt(s, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    const g = (k) => cs.getPropertyValue(k).trim();
    T = {
      ink: g('--ink'), ink2: g('--ink-2'), muted: g('--muted'), rule: g('--rule'), axis: g('--axis'),
      surface: g('--surface'), good: g('--good'), bad: g('--bad'), mono: g('--mono') || 'monospace',
    };
    const A = hexRGB(g('--cred-a')), M = hexRGB(g('--cred-mid')), B = hexRGB(g('--cred-b'));
    credTable = [];
    for (let q = 0; q <= 200; q++) {
      const c = q / 200;
      const [from, to, t] = c < 0.5 ? [A, M, c / 0.5] : [M, B, (c - 0.5) / 0.5];
      const mix = from.map((v, i) => Math.round(v + (to[i] - v) * t));
      credTable.push(`rgb(${mix[0]},${mix[1]},${mix[2]})`);
    }
  }
  const credColor = (c) => credTable[Math.max(0, Math.min(200, Math.round(c * 200)))];

  // ------------------------------------------------------------ sides
  const sides = ['a', 'b'].map((key) => ({
    key,
    type: key === 'a' ? 'complete' : 'cycle',
    params: {},
    select: $('net-' + key), paramsEl: $('params-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
    canvas: $('graph-' + key), traj: $('traj-' + key),
    outTesting: $('testing-' + key), outMean: $('mean-' + key), outLinks: $('links-' + key), outSettled: $('settled-' + key),
    graph: null, pos: null, minD: 0.1, run: null,
    prev: null, cur: null, tested: null, animT0: 0, animDur: 0, particles: [],
    trajHover: null, stats: null,
  }));
  let hoverAgent = -1;
  let pinnedAgent = -1;
  const focusAgent = () => (hoverAgent >= 0 ? hoverAgent : pinnedAgent);
  let dirty = true;
  let trajDirty = true;

  function addTooltip(wrap) {
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    wrap.appendChild(tip);
    return tip;
  }

  for (const side of sides) {
    for (const [type, def] of Object.entries(NETS.TYPES)) {
      const o = document.createElement('option');
      o.value = type;
      o.textContent = def.label;
      side.select.appendChild(o);
    }
    side.select.value = side.type;
    side.select.addEventListener('change', () => {
      side.type = side.select.value;
      side.params = NETS.defaultParams(side.type);
      renderParamControls(side);
      clearScenario();
      rebuild();
    });
    side.tipNet = addTooltip(side.canvas.parentElement);
    side.tipTraj = addTooltip(side.traj.parentElement);
  }

  function renderParamControls(side) {
    const def = NETS.TYPES[side.type];
    side.blurb.textContent = def.blurb + (def.random ? ' Redrawn for each seed.' : '');
    side.paramsEl.innerHTML = '';
    for (const spec of def.params) {
      const id = `p-${side.key}-${spec.key}`;
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const val = side.params[spec.key] ?? spec.value;
      wrap.innerHTML = `<div class="field-top"><label for="${id}">${spec.label}</label><output for="${id}">${val}</output></div>
        <input type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${val}">`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('output');
      input.addEventListener('input', () => {
        side.params[spec.key] = +input.value;
        out.textContent = input.value;
        clearScenario();
        rebuild();
      });
      side.paramsEl.appendChild(wrap);
    }
  }

  function minDistance(pos) {
    let best = Infinity;
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const d = Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y);
        if (d < best) best = d;
      }
    return isFinite(best) ? best : 0.2;
  }

  function rebuild() {
    for (const side of sides) {
      side.graph = NETS.make(side.type, S.N, side.params, S.seed);
      side.pos = NETS.layout(side.graph);
      side.minD = minDistance(side.pos);
      side.stats = NETS.stats(side.graph);
      side.particles = [];
      side.animDur = 0;
    }
    restart();
  }

  function restart() {
    setPlaying(false);
    for (const side of sides) {
      side.run = Z.createRun({
        graph: side.graph, eps: S.eps, n: S.n, seed: S.seed,
        priorLo: Math.min(S.lo, S.hi), priorHi: Math.max(S.lo, S.hi), maxRounds: MAX_ROUNDS,
      });
      side.prev = side.cur = side.run.history[0];
      side.tested = null;
      side.particles = [];
      side.animDur = 0;
    }
    updateReadouts();
    dirty = trajDirty = true;
  }

  // ------------------------------------------------------------ stepping
  const anyRunning = () => sides.some((s) => s.run.status === 'running');

  function stepAll(animate, dur) {
    const now = performance.now();
    for (const side of sides) {
      const run = side.run;
      if (run.status !== 'running') continue;
      const N = run.graph.n;
      const tested = new Uint8Array(N);
      for (let i = 0; i < N; i++) tested[i] = run.logodds[i] > 0 ? 1 : 0;
      const before = run.history[run.history.length - 1];
      run.step();
      side.prev = before;
      side.cur = run.history[run.history.length - 1];
      side.tested = tested;
      if (animate) {
        side.animT0 = now;
        side.animDur = dur;
        side.particles = [];
        const { adj } = run.graph;
        outer: for (let j = 0; j < N; j++) {
          const k = run.lastK[j];
          if (k < 0) continue;
          const fav = Math.sign(2 * k - run.n);
          for (const i of adj[j]) {
            if (side.particles.length >= MAX_PARTICLES) break outer;
            side.particles.push(j, i, fav);
          }
        }
      } else {
        side.animDur = 0;
        side.particles = [];
      }
    }
    updateReadouts();
    dirty = trajDirty = true;
  }

  function setPlaying(on) {
    if (on && !anyRunning()) restart();
    S.playing = on;
    const btn = $('btn-play');
    btn.querySelector('span').textContent = on ? 'Pause' : 'Play';
    btn.querySelector('svg').innerHTML = on
      ? '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/>'
      : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>';
    acc = 0;
  }

  const STATUS = {
    running: ['running', 'Running'],
    correct: ['correct', '✓ Right consensus'],
    incorrect: ['incorrect', '✕ Wrong consensus'],
    timeout: ['timeout', 'Unsettled at cap'],
  };

  function updateReadouts() {
    let maxRound = 0;
    for (const side of sides) {
      const run = side.run;
      const N = run.graph.n;
      let testing = 0, sum = 0;
      for (let i = 0; i < N; i++) {
        const c = side.cur[i];
        sum += c;
        if (c > 0.5) testing++;
      }
      side.outTesting.textContent = `${testing} / ${N}`;
      side.outMean.textContent = (sum / N).toFixed(3);
      const st = side.stats;
      side.outLinks.textContent = st.edges + (st.components > 1 ? ` · ${st.components} parts` : '');
      side.outSettled.textContent = run.status === 'running' ? '–' : `round ${run.round}`;
      const [cls, label] = STATUS[run.status];
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      side.status.title =
        run.status === 'incorrect' ? 'Everyone now prefers A, so nobody will test B again.' :
        run.status === 'correct' ? 'Everyone is more than 99% sure that B is better.' :
        run.status === 'timeout' ? `No consensus after ${MAX_ROUNDS.toLocaleString()} rounds.` : '';
      maxRound = Math.max(maxRound, run.round);
    }
    $('round').textContent = maxRound.toLocaleString();
  }

  // ------------------------------------------------------------ canvas sizing
  function fitCanvas(cv) {
    const r = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    cv._dpr = dpr;
    cv._w = w;
    cv._h = h;
  }
  const ro = new ResizeObserver(() => {
    for (const side of sides) {
      fitCanvas(side.canvas);
      fitCanvas(side.traj);
    }
    dirty = trajDirty = true;
  });
  for (const side of sides) {
    ro.observe(side.canvas.parentElement);
    ro.observe(side.traj.parentElement);
  }

  // ------------------------------------------------------------ graph drawing
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function geometry(side) {
    const cv = side.canvas;
    const W = cv._w || 300, H = cv._h || 300;
    const size = Math.min(W, H);
    const ox = (W - size) / 2, oy = (H - size) / 2;
    const r = Math.max(2.5, Math.min(13, side.minD * size * 0.36));
    return { W, H, size, ox, oy, r, px: (p) => ox + p.x * size, py: (p) => oy + p.y * size };
  }

  function drawGraph(side, now) {
    const cv = side.canvas;
    if (!cv._dpr) fitCanvas(cv);
    const ctx = cv.getContext('2d');
    const dpr = cv._dpr;
    const g = geometry(side);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    const { pos } = side;
    const graph = side.graph;
    const N = graph.n;
    const focus = focusAgent();

    let p = 1;
    if (side.animDur) p = Math.max(0, Math.min(1, (now - side.animT0) / side.animDur));
    const ep = ease(p);
    const inFlight = p < 1;

    // edges
    const E = graph.edges.length;
    ctx.lineWidth = 1;
    ctx.strokeStyle = T.axis;
    ctx.globalAlpha = E > 600 ? 0.3 : E > 150 ? 0.55 : 0.9;
    ctx.beginPath();
    for (const [i, j] of graph.edges) {
      ctx.moveTo(g.px(pos[i]), g.py(pos[i]));
      ctx.lineTo(g.px(pos[j]), g.py(pos[j]));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (focus >= 0 && focus < N) {
      ctx.strokeStyle = T.ink2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const j of graph.adj[focus]) {
        ctx.moveTo(g.px(pos[focus]), g.py(pos[focus]));
        ctx.lineTo(g.px(pos[j]), g.py(pos[j]));
      }
      ctx.stroke();
    }

    // results in transit
    if (inFlight && side.particles.length) {
      const P = side.particles;
      const alpha = p > 0.85 ? (1 - p) / 0.15 : 1;
      ctx.globalAlpha = Math.max(0, alpha);
      const rr = Math.max(1.6, Math.min(3, g.r * 0.32));
      for (const fav of [1, -1, 0]) {
        ctx.fillStyle = fav > 0 ? credColor(1) : fav < 0 ? credColor(0) : credColor(0.5);
        ctx.beginPath();
        for (let q = 0; q < P.length; q += 3) {
          if (P[q + 2] !== fav) continue;
          const a = pos[P[q]], b = pos[P[q + 1]];
          const x = g.px(a) + (g.px(b) - g.px(a)) * ep;
          const y = g.py(a) + (g.py(b) - g.py(a)) * ep;
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // agents
    const prev = side.prev, cur = side.cur;
    for (let i = 0; i < N; i++) {
      const c = inFlight ? prev[i] + (cur[i] - prev[i]) * ep : cur[i];
      const filled = inFlight && side.tested ? side.tested[i] === 1 : cur[i] > 0.5;
      const x = g.px(pos[i]), y = g.py(pos[i]);
      const col = credColor(c);
      ctx.beginPath();
      ctx.arc(x, y, g.r, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = col;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = T.surface;
        ctx.stroke();
      } else {
        ctx.fillStyle = T.surface;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, g.r * 0.3);
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, g.r - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (i === focus) {
        ctx.beginPath();
        ctx.arc(x, y, g.r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = T.ink;
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------ trajectories
  const LIM = 7;
  function trajGeometry(side) {
    const cv = side.traj;
    const W = cv._w || 300, H = cv._h || 190;
    const m = { l: 46, r: 12, t: 10, b: 24 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xMax = Math.max(20, ...sides.map((s) => s.run.round));
    const X = (r) => m.l + (r / xMax) * pw;
    const Y =
      S.scale === 'credence'
        ? (c) => m.t + (1 - c) * ph
        : (c) => {
            let v = Math.log(c / (1 - c));
            if (!isFinite(v)) v = v > 0 ? LIM : -LIM;
            v = Math.max(-LIM, Math.min(LIM, v));
            return m.t + ((LIM - v) / (2 * LIM)) * ph;
          };
    return { W, H, m, pw, ph, xMax, X, Y };
  }

  function drawTraj(side) {
    const cv = side.traj;
    if (!cv._dpr) fitCanvas(cv);
    const ctx = cv.getContext('2d');
    const dpr = cv._dpr;
    const G = trajGeometry(side);
    const { m, pw, ph, X, Y } = G;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, G.W, G.H);
    ctx.font = `10.5px ${T.mono}`;
    ctx.textBaseline = 'middle';

    // grid + y labels
    const yTicks = S.scale === 'credence' ? [0, 0.25, 0.5, 0.75, 1] : [0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999];
    ctx.lineWidth = 1;
    for (const v of yTicks) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = T.rule;
      ctx.beginPath();
      ctx.moveTo(m.l, y);
      ctx.lineTo(m.l + pw, y);
      ctx.stroke();
      ctx.fillStyle = T.muted;
      ctx.textAlign = 'right';
      ctx.fillText(String(v), m.l - 6, y);
    }
    // reference lines
    const y5 = Math.round(Y(0.5)) + 0.5;
    ctx.strokeStyle = T.axis;
    ctx.beginPath(); ctx.moveTo(m.l, y5); ctx.lineTo(m.l + pw, y5); ctx.stroke();
    const y99 = Math.round(Y(0.99)) + 0.5;
    ctx.strokeStyle = T.good;
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(m.l, y99); ctx.lineTo(m.l + pw, y99); ctx.stroke();
    ctx.globalAlpha = 1;

    // x axis
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of CH.linearTicks(0, G.xMax, 5)) {
      const x = X(v);
      ctx.fillStyle = T.muted;
      ctx.fillText(v >= 10000 ? v / 1000 + 'K' : v.toLocaleString(), x, m.t + ph + 6);
      ctx.strokeStyle = T.axis;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, m.t + ph); ctx.lineTo(Math.round(x) + 0.5, m.t + ph + 3); ctx.stroke();
    }

    // lines
    const hist = side.run.history;
    const len = hist.length;
    const N = side.graph.n;
    const last = hist[len - 1];
    const stride = Math.max(1, Math.floor(len / Math.max(50, pw)));
    const focus = focusAgent();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const drawLine = (i) => {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(hist[0][i]));
      for (let r = stride; r < len; r += stride) ctx.lineTo(X(r), Y(hist[r][i]));
      ctx.lineTo(X(len - 1), Y(last[i]));
      ctx.stroke();
    };
    ctx.lineWidth = N > 40 ? 1 : 1.4;
    for (let i = 0; i < N; i++) {
      if (i === focus) continue;
      ctx.strokeStyle = credColor(last[i]);
      ctx.globalAlpha = focus >= 0 ? 0.18 : 0.85;
      drawLine(i);
    }
    ctx.globalAlpha = 1;
    if (focus >= 0 && focus < N) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = credColor(last[focus]);
      drawLine(focus);
    }
    if (len === 1) {
      // round 0: show where everyone starts
      for (let i = 0; i < N; i++) {
        ctx.fillStyle = credColor(last[i]);
        ctx.globalAlpha = focus >= 0 && i !== focus ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(X(0) + 3, Y(last[i]), i === focus ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // reference labels on a surface backing so lines never hide them
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
    label('tests B above 0.5', y5 + 9);
    label('consensus 0.99', y99 + (S.scale === 'credence' ? 9 : -9));
    if (side.trajHover != null) {
      const x = Math.round(X(side.trajHover)) + 0.5;
      ctx.strokeStyle = T.ink2;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }
  }

  // ------------------------------------------------------------ hover
  function placeTip(tip, wrap, x, y) {
    tip.hidden = false;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14, top = y + 14;
    if (left + tw > w) left = Math.max(0, x - tw - 14);
    if (top + th > h) top = Math.max(0, y - th - 14);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function agentHTML(side, i) {
    const run = side.run;
    const c = side.cur[i];
    const hub = (side.type === 'wheel' || side.type === 'star') && i === 0 && side.graph.n >= 4 ? ' · hub' : '';
    const k = run.lastK[i];
    const last = run.round === 0 ? 'not started' : k >= 0 ? `B: ${k.toLocaleString()} / ${run.n.toLocaleString()} successes` : 'did A';
    return `<div class="t-head">Agent ${i + 1}${hub}</div>
      <div class="t-row"><span>Credence in B</span><span>${c.toFixed(4)}</span></div>
      <div class="t-row"><span>Last round</span><span>${last}</span></div>
      <div class="t-row"><span>Next round</span><span>${c > 0.5 ? 'tests B' : 'does A'}</span></div>
      <div class="t-row"><span>Hears from</span><span>${side.graph.adj[i].length} neighbour${side.graph.adj[i].length === 1 ? '' : 's'}</span></div>`;
  }

  function nodeAt(side, ev) {
    const rect = side.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const g = geometry(side);
    let best = -1, bd = Infinity;
    side.pos.forEach((p, i) => {
      const d = Math.hypot(g.px(p) - x, g.py(p) - y);
      if (d < bd) { bd = d; best = i; }
    });
    return { i: bd <= g.r + 6 ? best : -1, x, y };
  }

  for (const side of sides) {
    side.canvas.addEventListener('pointermove', (ev) => {
      const { i, x, y } = nodeAt(side, ev);
      if (i !== hoverAgent) { hoverAgent = i; dirty = trajDirty = true; }
      if (i >= 0) {
        side.tipNet.innerHTML = agentHTML(side, i);
        placeTip(side.tipNet, side.canvas.parentElement, x, y);
      } else side.tipNet.hidden = true;
    });
    side.canvas.addEventListener('pointerleave', () => {
      hoverAgent = -1;
      side.tipNet.hidden = true;
      dirty = trajDirty = true;
    });
    side.canvas.addEventListener('click', (ev) => {
      const { i } = nodeAt(side, ev);
      pinnedAgent = i === pinnedAgent ? -1 : i;
      dirty = trajDirty = true;
    });

    side.traj.addEventListener('pointermove', (ev) => {
      const rect = side.traj.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const G = trajGeometry(side);
      const hist = side.run.history;
      const r = Math.max(0, Math.min(hist.length - 1, Math.round(((x - G.m.l) / G.pw) * G.xMax)));
      side.trajHover = r;
      let best = -1, bd = Infinity;
      for (let i = 0; i < side.graph.n; i++) {
        const d = Math.abs(G.Y(hist[r][i]) - y);
        if (d < bd) { bd = d; best = i; }
      }
      const agent = bd < 9 ? best : -1;
      if (agent !== hoverAgent) { hoverAgent = agent; dirty = true; }
      let testing = 0;
      for (let i = 0; i < side.graph.n; i++) if (hist[r][i] > 0.5) testing++;
      let html = `<div class="t-head">Round ${r.toLocaleString()}</div>
        <div class="t-row"><span>Testing B next</span><span>${testing} / ${side.graph.n}</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Agent ${agent + 1}</span><span>${hist[r][agent].toFixed(4)}</span></div>`;
      side.tipTraj.innerHTML = html;
      placeTip(side.tipTraj, side.traj.parentElement, x, y);
      trajDirty = true;
    });
    side.traj.addEventListener('pointerleave', () => {
      side.trajHover = null;
      hoverAgent = -1;
      side.tipTraj.hidden = true;
      dirty = trajDirty = true;
    });
  }

  // ------------------------------------------------------------ main loop
  let lastTs = 0;
  let acc = 0;
  let lastTrajDraw = 0;
  function frame(ts) {
    const dt = lastTs ? Math.min(100, ts - lastTs) : 16;
    lastTs = ts;
    if (S.playing) {
      const sp = SPEEDS[S.speed];
      if (!isFinite(sp)) {
        const t0 = performance.now();
        do stepAll(false); while (anyRunning() && performance.now() - t0 < 12);
      } else {
        acc += dt;
        const interval = 1000 / sp;
        let k = 0;
        while (acc >= interval && k < 3) {
          acc -= interval;
          stepAll(S.animate && sp <= 15, Math.min(650, interval * 0.92));
          k++;
        }
        if (k === 3) acc = 0;
      }
      if (!anyRunning()) setPlaying(false);
    }
    const animating = sides.some((s) => s.animDur && ts - s.animT0 < s.animDur);
    if (dirty || animating) {
      for (const s of sides) drawGraph(s, ts);
      dirty = animating;
    }
    if (trajDirty && (!S.playing || ts - lastTrajDraw > 45)) {
      for (const s of sides) drawTraj(s);
      trajDirty = false;
      lastTrajDraw = ts;
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ controls
  function syncOutputs() {
    $('in-N').value = S.N;
    $('out-N').textContent = S.N;
    $('in-eps').value = EPS_STEPS.indexOf(S.eps);
    $('out-eps').textContent = S.eps;
    const pct = (v) => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
    $('hint-eps').textContent = `B succeeds ${pct(0.5 + S.eps)} of the time; agents can’t rule out ${pct(0.5 - S.eps)}.`;
    $('in-n').value = N_STEPS.indexOf(S.n);
    $('out-n').textContent = S.n.toLocaleString();
    $('in-lo').value = S.lo;
    $('out-lo').textContent = S.lo.toFixed(2);
    $('in-hi').value = S.hi;
    $('out-hi').textContent = S.hi.toFixed(2);
    $('in-seed').value = S.seed;
    $('in-speed').value = S.speed;
    const sp = SPEEDS[S.speed];
    $('out-speed').textContent = isFinite(sp) ? `${sp} / s` : 'Max';
  }

  function clearScenario() {
    document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  }

  function bindRange(id, apply) {
    $(id).addEventListener('input', () => {
      apply(+$(id).value);
      clearScenario();
      syncOutputs();
      rebuild();
    });
  }
  bindRange('in-N', (v) => (S.N = v));
  bindRange('in-eps', (v) => (S.eps = EPS_STEPS[v]));
  bindRange('in-n', (v) => (S.n = N_STEPS[v]));
  bindRange('in-lo', (v) => { S.lo = v; if (S.hi < v) S.hi = v; });
  bindRange('in-hi', (v) => { S.hi = v; if (S.lo > v) S.lo = v; });
  $('in-seed').addEventListener('change', () => {
    const v = Math.max(0, Math.floor(+$('in-seed').value || 0));
    S.seed = v;
    setFindNote('');
    syncOutputs();
    rebuild();
  });
  $('btn-reseed').addEventListener('click', () => {
    S.seed = Math.floor(Math.random() * 100000);
    setFindNote('');
    syncOutputs();
    rebuild();
  });
  $('in-speed').addEventListener('input', () => {
    S.speed = +$('in-speed').value;
    syncOutputs();
  });
  $('in-anim').addEventListener('change', () => (S.animate = $('in-anim').checked));
  document.querySelectorAll('[data-scale]').forEach((b) =>
    b.addEventListener('click', () => {
      S.scale = b.dataset.scale;
      document.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      trajDirty = true;
    })
  );
  $('btn-play').addEventListener('click', () => setPlaying(!S.playing));
  $('btn-step').addEventListener('click', () => {
    setPlaying(false);
    stepAll(S.animate, 450);
  });
  $('btn-reset').addEventListener('click', () => restart());

  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === ' ') { ev.preventDefault(); setPlaying(!S.playing); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); setPlaying(false); stepAll(S.animate, 450); }
    else if (ev.key === 'r' || ev.key === 'R') restart();
  });

  // scenarios
  const SCENARIOS = {
    zollman: { N: 10, eps: 0.001, n: 1000, lo: 0, hi: 1, seed: 4, a: 'complete', b: 'cycle',
      note: 'Zollman’s parameters. With seed 4 the complete network gives up on B within a few rounds while the cycle recovers.' },
    hard: { N: 10, eps: 0.01, n: 10, lo: 0, hi: 1, a: 'complete', b: 'cycle',
      note: 'Ten trials per round: results are noisy, so misleading streaks are common. This is where sparse networks help most.' },
    easy: { N: 10, eps: 0.05, n: 1000, lo: 0, hi: 1, a: 'complete', b: 'cycle',
      note: 'B is 55% vs. 45%. The evidence is so clear that both networks almost always get it right; the complete one is just faster.' },
    sceptics: { N: 10, eps: 0.001, n: 1000, lo: 0, hi: 0.6, a: 'complete', b: 'cycle',
      note: 'Most agents start out doubting B. With few testers, early bad luck is more dangerous.' },
    big: { N: 50, eps: 0.001, n: 1000, lo: 0, hi: 1, a: 'complete', b: 'cycle',
      note: 'Fifty agents. Large communities generate so much evidence that the complete network rarely fails; the cycle is very slow.' },
  };
  document.querySelectorAll('[data-scenario]').forEach((chip) =>
    chip.addEventListener('click', () => {
      const sc = SCENARIOS[chip.dataset.scenario];
      Object.assign(S, { N: sc.N, eps: sc.eps, n: sc.n, lo: sc.lo, hi: sc.hi });
      if (sc.seed != null) S.seed = sc.seed;
      sides[0].type = sc.a; sides[0].params = NETS.defaultParams(sc.a);
      sides[1].type = sc.b; sides[1].params = NETS.defaultParams(sc.b);
      for (const side of sides) { side.select.value = side.type; renderParamControls(side); }
      clearScenario();
      chip.setAttribute('aria-pressed', 'true');
      setFindNote(sc.note);
      syncOutputs();
      rebuild();
    })
  );

  // find a disagreement
  function setFindNote(text) { $('find-note').textContent = text; }
  const VERDICT = { correct: 'finds B', incorrect: 'settles on A', timeout: 'stays unsettled' };
  let finding = null;
  $('btn-find').addEventListener('click', () => {
    if (finding) { finding.stop = true; return; }
    setPlaying(false);
    const btn = $('btn-find');
    const job = (finding = { seed: S.seed + 1, tried: 0, stop: false, limit: 2000 });
    btn.textContent = 'Stop searching';
    const lo = Math.min(S.lo, S.hi), hi = Math.max(S.lo, S.hi);
    const outcome = (side, seed) => {
      const g = NETS.make(side.type, S.N, side.params, seed);
      const run = Z.createRun({ graph: g, eps: S.eps, n: S.n, seed, priorLo: lo, priorHi: hi, maxRounds: MAX_ROUNDS, recordHistory: false });
      while (run.step());
      return run.status;
    };
    const done = (msg) => {
      finding = null;
      btn.textContent = 'Find a seed where they disagree';
      setFindNote(msg);
    };
    (function tick() {
      const t0 = performance.now();
      while (performance.now() - t0 < 30 && job.tried < job.limit && !job.stop) {
        const seed = job.seed++;
        job.tried++;
        const a = outcome(sides[0], seed), b = outcome(sides[1], seed);
        if (a !== b) {
          S.seed = seed;
          syncOutputs();
          rebuild();
          const la = NETS.TYPES[sides[0].type].label, lb = NETS.TYPES[sides[1].type].label;
          return done(`Seed ${seed}: ${la} ${VERDICT[a]}, ${lb} ${VERDICT[b]}. That took ${job.tried.toLocaleString()} ${job.tried === 1 ? 'try' : 'tries'}; press Play.`);
        }
      }
      if (job.stop) return done(`Stopped after ${job.tried.toLocaleString()} seeds without a disagreement.`);
      if (job.tried >= job.limit) return done(`No disagreement in ${job.limit.toLocaleString()} seeds. With these settings the two networks almost always agree.`);
      setFindNote(`Searching… ${job.tried.toLocaleString()} seeds tried`);
      setTimeout(tick, 0);
    })();
  });

  // ------------------------------------------------------------ boot the lab
  readTokens();
  const reTheme = () => { readTokens(); dirty = trajDirty = true; };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme);
  new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  for (const side of sides) { side.params = NETS.defaultParams(side.type); renderParamControls(side); }
  document.querySelector('[data-scenario="zollman"]').setAttribute('aria-pressed', 'true');
  syncOutputs();
  rebuild();
  for (const side of sides) { fitCanvas(side.canvas); fitCanvas(side.traj); }
  requestAnimationFrame(frame);

  // ================================================================ experiment
  const EXP_NETS = [
    { id: 'complete', type: 'complete', params: {}, label: 'Complete', color: 'var(--s1)' },
    { id: 'cycle', type: 'cycle', params: {}, label: 'Cycle', color: 'var(--s2)' },
    { id: 'wheel', type: 'wheel', params: {}, label: 'Wheel', color: 'var(--s3)' },
    { id: 'star', type: 'star', params: {}, label: 'Star', color: 'var(--s4)' },
    { id: 'ring2', type: 'ringLattice', params: { k: 2 }, label: 'Ring lattice (k = 2)', color: 'var(--s5)' },
    { id: 'grid', type: 'grid', params: {}, label: 'Grid', color: 'var(--s6)' },
    { id: 'clusters3', type: 'clusters', params: { c: 3 }, label: 'Three clusters', color: 'var(--s7)' },
    { id: 'smallworld', type: 'smallWorld', params: { k: 2, beta: 0.1 }, label: 'Small world (k = 2, β = 0.1)', color: 'var(--s8)' },
  ];
  const NET_BY_ID = Object.fromEntries(EXP_NETS.map((d) => [d.id, d]));
  const VARY = {
    N: { name: 'N', label: 'Number of agents, N', log: false, fmt: (v) => String(v), defaults: '3, 4, 5, 6, 7, 8, 9, 10' },
    eps: { name: 'ε', label: 'Advantage of B, ε', log: true, fmt: (v) => String(v), defaults: '0.001, 0.002, 0.005, 0.01, 0.02, 0.05' },
    n: { name: 'n', label: 'Trials per round, n', log: true, fmt: (v) => (v >= 1000 ? v / 1000 + 'K' : String(v)), defaults: '10, 20, 50, 100, 200, 500, 1000, 2000' },
  };

  const netChecks = $('exp-nets');
  for (const d of EXP_NETS) {
    const lab = document.createElement('label');
    lab.className = 'net-check';
    lab.innerHTML = `<input type="checkbox" id="exp-net-${d.id}" value="${d.id}"><span class="sw" style="background:${d.color}"></span>${d.label}`;
    netChecks.appendChild(lab);
  }

  function setVary(v, values) {
    $('exp-vary').value = v;
    $('exp-values').value = values ?? VARY[v].defaults;
    for (const k of ['N', 'eps', 'n']) $('exp-' + k).disabled = k === v;
  }
  $('exp-vary').addEventListener('change', () => setVary($('exp-vary').value));

  function applyConfig(cfg) {
    setVary(cfg.vary, cfg.xs.join(', '));
    $('exp-N').value = cfg.fixed.N;
    $('exp-eps').value = cfg.fixed.eps;
    $('exp-n').value = cfg.fixed.n;
    $('exp-runs').value = cfg.runs;
    $('exp-cap').value = cfg.cap;
    for (const d of EXP_NETS) $('exp-net-' + d.id).checked = cfg.nets.includes(d.id);
  }

  function readConfig() {
    const vary = $('exp-vary').value;
    const raw = $('exp-values').value.split(/[\s,;]+/).map(Number).filter((v) => isFinite(v) && v > 0);
    let xs = raw;
    if (vary === 'N') xs = raw.map(Math.round).filter((v) => v >= 2 && v <= 300);
    if (vary === 'n') xs = raw.map(Math.round).filter((v) => v >= 1 && v <= 100000);
    if (vary === 'eps') xs = raw.filter((v) => v < 0.5);
    xs = Array.from(new Set(xs)).sort((a, b) => a - b).slice(0, 24);
    const nets = EXP_NETS.filter((d) => $('exp-net-' + d.id).checked).map((d) => d.id);
    const fixed = {
      N: Math.max(2, Math.min(300, Math.round(+$('exp-N').value || 10))),
      eps: Math.max(0.0001, Math.min(0.49, +$('exp-eps').value || 0.001)),
      n: Math.max(1, Math.round(+$('exp-n').value || 1000)),
    };
    const runs = Math.max(10, Math.min(100000, Math.round(+$('exp-runs').value || 1000)));
    const cap = Math.max(10, Math.min(100000, Math.round(+$('exp-cap').value || 10000)));
    return { vary, xs, nets, fixed, runs, cap };
  }

  function emptyAcc() { return { runs: 0, correct: 0, incorrect: 0, timeout: 0, roundsCorrect: 0 }; }

  function wilson(k, n) {
    if (!n) return [0, 1];
    const z = 1.96, p = k / n, z2 = z * z;
    const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
  }

  let shown = null;
  function renderResults(res) {
    shown = res;
    const V = VARY[res.vary];
    const nets = res.nets.map((id) => NET_BY_ID[id]);
    const seriesP = nets.map((d) => {
      const accs = res.acc[d.id];
      const ys = accs.map((a) => (a.runs ? a.correct / a.runs : null));
      const ci = accs.map((a) => wilson(a.correct, a.runs));
      return { key: d.id, label: d.label, color: d.color, ys, lo: ci.map((c, i) => (accs[i].runs ? c[0] : null)), hi: ci.map((c, i) => (accs[i].runs ? c[1] : null)), accs };
    });
    const seriesT = nets.map((d) => {
      const accs = res.acc[d.id];
      return { key: d.id, label: d.label, color: d.color, ys: accs.map((a) => (a.correct ? a.roundsCorrect / a.correct : null)), accs };
    });
    let minLo = 1;
    for (const s of seriesP) s.lo.forEach((v) => { if (v != null) minLo = Math.min(minLo, v); });
    let yLo = Math.max(0, Math.floor(minLo * 10) / 10);
    if (1 - yLo < 0.1) yLo = 0.9;
    const tVals = seriesT.flatMap((s) => s.ys.filter((v) => v != null && v > 0));
    let tLo = tVals.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...tVals)))) : 1;
    let tHi = tVals.length ? Math.pow(10, Math.ceil(Math.log10(Math.max(...tVals)))) : 10;
    if (tHi <= tLo) tHi = tLo * 10;
    const xLabel = V.label + (res.vary === 'N' ? '' : '') + `   ·   ${fixedText(res)}`;

    CH.legend($('legend-p'), seriesP);
    CH.legend($('legend-t'), seriesT);
    CH.lineChart($('chart-p'), {
      xs: res.xs, xLog: V.log, xFormat: V.fmt, xName: V.name, xLabel,
      yDomain: [yLo, 1], yFormat: (v) => v.toFixed(yLo >= 0.9 ? 2 : 1),
      series: seriesP, height: 270,
      ariaLabel: 'Share of runs reaching the right consensus',
      valueText: (s, i) => {
        const a = s.accs[i];
        return `${(100 * s.ys[i]).toFixed(1)}%  of ${a.runs.toLocaleString()}`;
      },
    });
    CH.lineChart($('chart-t'), {
      xs: res.xs, xLog: V.log, xFormat: V.fmt, xName: V.name, xLabel,
      yLog: true, yDomain: [tLo, tHi], series: seriesT, height: 270,
      ariaLabel: 'Mean rounds to reach the right consensus',
      valueText: (s, i) => `${Math.round(s.ys[i]).toLocaleString()} rounds`,
    });
    renderTable(res, nets);
  }

  function fixedText(res) {
    const parts = [];
    if (res.vary !== 'N') parts.push(`N = ${res.fixed.N}`);
    if (res.vary !== 'eps') parts.push(`ε = ${res.fixed.eps}`);
    if (res.vary !== 'n') parts.push(`n = ${res.fixed.n.toLocaleString()}`);
    return parts.join(', ');
  }

  function renderTable(res, nets) {
    const V = VARY[res.vary];
    const both = res.nets.includes('complete') && res.nets.includes('cycle');
    let html = '<thead><tr><th>' + V.name + '</th>';
    for (const d of nets) html += `<th><span class="th-sw" style="background:${d.color}"></span>${d.label}<br><span style="font-weight:400">right · mean rounds</span></th>`;
    if (both) html += '<th>Zollman effect<br><span style="font-weight:400">cycle − complete</span></th>';
    html += '</tr></thead><tbody>';
    res.xs.forEach((x, i) => {
      html += `<tr><td>${V.fmt(x)}</td>`;
      for (const d of nets) {
        const a = res.acc[d.id][i];
        if (!a.runs) { html += '<td>–</td>'; continue; }
        const pct = ((100 * a.correct) / a.runs).toFixed(1) + '%';
        const rounds = a.correct ? Math.round(a.roundsCorrect / a.correct).toLocaleString() : '–';
        const extra = a.timeout ? ` <span class="r">${a.timeout} unsettled</span>` : '';
        html += `<td>${pct}<span class="r">${rounds}</span>${extra}</td>`;
      }
      if (both) {
        const c = res.acc.complete[i], y = res.acc.cycle[i];
        if (c.runs && y.runs) {
          const diff = 100 * (y.correct / y.runs - c.correct / c.runs);
          const cls = diff > 0.05 ? 'pos' : diff < -0.05 ? 'neg' : '';
          html += `<td class="${cls}">${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts</td>`;
        } else html += '<td>–</td>';
      }
      html += '</tr>';
    });
    html += '</tbody>';
    $('exp-table').innerHTML = html;
  }

  // presets: precomputed results ship with the page (data/zollman-presets.js)
  const PRESETS = (window.NET && window.NET.zollmanPresets) || {};
  function showPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    applyConfig(p);
    renderResults(p);
    document.querySelectorAll('#exp-presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === key)));
    $('exp-source').textContent = `Precomputed with this code: ${p.runs.toLocaleString()} runs per setting. Press Run experiment to recompute.`;
    $('exp-progress').textContent = '';
    $('exp-fill').style.width = '0';
  }
  document.querySelectorAll('[data-preset]').forEach((chip) => chip.addEventListener('click', () => {
    if (job) job.stop = true;
    showPreset(chip.dataset.preset);
  }));

  let job = null;
  $('exp-run').addEventListener('click', () => {
    if (job) { job.stop = true; return; }
    const cfg = readConfig();
    if (!cfg.xs.length) { $('exp-progress').textContent = 'Enter at least one valid value to try.'; return; }
    if (!cfg.nets.length) { $('exp-progress').textContent = 'Tick at least one network to compare.'; return; }
    document.querySelectorAll('#exp-presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    const res = Object.assign({}, cfg, { acc: {} });
    for (const id of cfg.nets) res.acc[id] = cfg.xs.map(emptyAcc);
    const tasks = [];
    cfg.xs.forEach((x, xi) => cfg.nets.forEach((id) => tasks.push({ xi, id })));
    job = { res, tasks, ti: 0, done: 0, total: tasks.length * cfg.runs, seed: rng.randomSeed(), stop: false, t0: performance.now(), lastRender: 0 };
    $('exp-run').textContent = 'Stop';
    $('exp-source').textContent = 'Computing in your browser…';
    renderResults(res);
    setTimeout(tick, 0);
  });

  function tick() {
    const j = job;
    if (!j) return;
    const { res } = j;
    const t0 = performance.now();
    while (performance.now() - t0 < 30 && j.ti < j.tasks.length && !j.stop) {
      const task = j.tasks[j.ti];
      if (!task.rand) {
        const x = res.xs[task.xi];
        task.N = res.vary === 'N' ? x : res.fixed.N;
        task.eps = res.vary === 'eps' ? x : res.fixed.eps;
        task.n = res.vary === 'n' ? x : res.fixed.n;
        task.def = NET_BY_ID[task.id];
        task.rand = rng.mulberry32(rng.mix(j.seed, j.ti));
        if (!NETS.TYPES[task.def.type].random) task.graph = NETS.make(task.def.type, task.N, task.def.params, 0);
      }
      const g = task.graph || NETS.make(task.def.type, task.N, task.def.params, (task.rand() * 4294967296) >>> 0);
      const out = Z.simulate(g, task.eps, task.n, Z.randomPriors(task.N, task.rand), task.rand, res.cap);
      const a = res.acc[task.id][task.xi];
      a.runs++;
      a[out.outcome]++;
      if (out.outcome === 'correct') a.roundsCorrect += out.rounds;
      j.done++;
      if (a.runs >= res.runs) j.ti++;
    }
    const frac = j.done / j.total;
    $('exp-fill').style.width = (100 * frac).toFixed(1) + '%';
    const finished = j.ti >= j.tasks.length;
    const now = performance.now();
    if (finished || j.stop || now - j.lastRender > 300) {
      renderResults(res);
      j.lastRender = now;
    }
    if (finished || j.stop) {
      const secs = ((now - j.t0) / 1000).toFixed(1);
      $('exp-progress').textContent = j.stop
        ? `Stopped after ${j.done.toLocaleString()} of ${j.total.toLocaleString()} runs.`
        : `Done: ${j.total.toLocaleString()} runs in ${secs} s.`;
      $('exp-source').textContent = j.stop ? 'Partial results computed in your browser.' : `Computed in your browser: ${res.runs.toLocaleString()} runs per setting.`;
      $('exp-run').textContent = 'Run experiment';
      job = null;
      return;
    }
    $('exp-progress').textContent = `Running… ${j.done.toLocaleString()} of ${j.total.toLocaleString()} runs (${Math.floor(100 * frac)}%)`;
    setTimeout(tick, 0);
  }

  if (PRESETS.zollman) showPreset('zollman');
  else {
    applyConfig({ vary: 'N', xs: [3, 4, 5, 6, 7, 8, 9, 10], fixed: { N: 10, eps: 0.001, n: 1000 }, runs: 1000, cap: 10000, nets: ['complete', 'cycle', 'wheel'] });
    $('exp-source').textContent = 'Press Run experiment to compute results.';
  }
})();
