/* UI for exchange.html: pricing network structure in exploration. */
(function () {
  'use strict';

  const { rng, networks: NETS, zollman: Z, views: V } = window.NET;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;
  const SVGNS = 'http://www.w3.org/2000/svg';

  const EPS_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05];
  const N_STEPS = [10, 20, 50, 100, 200, 1000, 2000];
  const H_STEPS = [1000, 2000, 5000, 10000, 50000];
  const BUDGETS = [0, 1, 2, 3, 5, 7, 8, 10, 12, 14, 20, 30, 50, 100];
  const SPEEDS = [1, 2, 4, 8, 15, 30, 60, Infinity];

  const S = { N: 10, eps: 0.001, n: 1000, H: 2000, seed: 4, speed: 6, scale: 'logodds', playing: false };

  // ------------------------------------------------------------ data
  let DATA = window.NET.exchangePresets;
  const SKIP = new Set(['erdos']);
  const TOPO_LABEL = {
    complete: 'Complete', wheel: 'Wheel', ring3: 'Ring lattice, k = 3', ring2: 'Ring lattice, k = 2',
    clusters2: 'Two cliques, one bridge', clusters3: 'Three cliques in a ring', smallWorld: 'Small world (k = 2, β = 0.1)',
    scaleFree2: 'Scale-free (m = 2)', scaleFree1: 'Scale-free tree (m = 1)', grid: 'Grid', star: 'Star', cycle: 'Cycle', line: 'Line',
  };

  function failure(a) { return 1 - a.correct / a.runs; }
  function mainCurve() {
    return DATA.curves.find((c) => c.horizon === DATA.mainHorizon) || DATA.curves[0];
  }
  // points (budget, failure), budget 0 = complete network without exploration
  function curvePoints() {
    const complete = DATA.topologies.find((t) => t.id === 'complete');
    const pts = [{ B: 0, f: failure(complete.acc) }].concat(mainCurve().points.map((p) => ({ B: p.budget, f: failure(p) })));
    // enforce a non-increasing curve (Monte Carlo noise at tiny budgets)
    for (let i = 1; i < pts.length; i++) pts[i].f = Math.min(pts[i].f, pts[i - 1].f);
    return pts;
  }
  // budget at which the complete network's failure equals f
  function equivalent(f) {
    const pts = curvePoints();
    if (f >= pts[0].f) return 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (f <= a.f && f >= b.f) {
        if (a.f === b.f) return a.B;
        if (a.B === 0) return b.B * ((a.f - f) / (a.f - b.f));
        if (b.f <= 0) return a.B;
        const t = (Math.log(a.f) - Math.log(f)) / (Math.log(a.f) - Math.log(b.f));
        return Math.exp(Math.log(a.B) + t * (Math.log(b.B) - Math.log(a.B)));
      }
    }
    return pts[pts.length - 1].B;
  }
  // interpolate a property of the main curve at budget B (log-linear in B)
  function curveAt(B, getter) {
    const P = mainCurve().points;
    if (B <= P[0].budget) return getter(P[0]);
    for (let i = 0; i < P.length - 1; i++) {
      if (B >= P[i].budget && B <= P[i + 1].budget) {
        const t = (Math.log(B) - Math.log(P[i].budget)) / (Math.log(P[i + 1].budget) - Math.log(P[i].budget));
        return getter(P[i]) + t * (getter(P[i + 1]) - getter(P[i]));
      }
    }
    return getter(P[P.length - 1]);
  }
  function topoRows() {
    return DATA.topologies.filter((t) => !SKIP.has(t.id)).map((t) => {
      const a = t.acc;
      const p = a.correct / a.runs;
      const se = Math.sqrt((p * (1 - p)) / a.runs);
      return {
        id: t.id, type: t.type, params: t.params, label: TOPO_LABEL[t.id] || t.label, acc: a, p,
        eq: equivalent(1 - p), lo: equivalent(1 - p + 1.96 * se), hi: equivalent(Math.max(1e-6, 1 - p - 1.96 * se)),
      };
    }).sort((x, y) => x.eq - y.eq);
  }

  // ------------------------------------------------------------ panels
  const panelsEl = $('panels');
  const NET_OPTIONS = [
    ['cycle', 'Cycle', 'cycle', {}], ['line', 'Line', 'line', {}], ['star', 'Star', 'star', {}], ['grid', 'Grid', 'grid', {}],
    ['wheel', 'Wheel', 'wheel', {}], ['ring2', 'Ring lattice, k = 2', 'ringLattice', { k: 2 }], ['ring3', 'Ring lattice, k = 3', 'ringLattice', { k: 3 }],
    ['clusters2', 'Two cliques, one bridge', 'clusters', { c: 2 }], ['clusters3', 'Three cliques in a ring', 'clusters', { c: 3 }],
    ['smallWorld', 'Small world', 'smallWorld', { k: 2, beta: 0.1 }], ['scaleFree1', 'Scale-free tree', 'scaleFree', { m: 1 }],
    ['scaleFree2', 'Scale-free (m = 2)', 'scaleFree', { m: 2 }], ['complete', 'Complete', 'complete', {}],
  ];
  const NET_BY_ID = Object.fromEntries(NET_OPTIONS.map((o) => [o[0], { label: o[1], type: o[2], params: o[3] }]));

  const sides = ['a', 'b'].map((key, idx) => {
    const el = document.createElement('article');
    el.className = 'panel';
    el.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <select id="net-${key}" aria-label="Network ${idx + 1}"></select>
          <span class="pill running" id="status-${key}" aria-live="polite"><span class="dot"></span><span>Running</span></span>
        </div>
        <div class="panel-controls">
          <div class="field">
            <div class="field-top"><label for="bud-${key}">Exploration budget</label><output id="out-bud-${key}" for="bud-${key}"></output></div>
            <input type="range" id="bud-${key}" min="0" max="${BUDGETS.length - 1}" step="1">
          </div>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap"><canvas id="graph-${key}" aria-label="Network ${idx + 1} diagram"></canvas></div>
      <dl class="readout">
        <div><dt>Testing B</dt><dd id="testing-${key}">–</dd></div>
        <div><dt title="Agent-rounds testing B against the pooled evidence">Against evidence</dt><dd id="against-${key}">–</dd></div>
        <div><dt title="Rounds in which nobody believed B">Trapped</dt><dd id="trapped-${key}">–</dd></div>
        <div><dt>Settled</dt><dd id="settled-${key}">–</dd></div>
      </dl>
      <div class="traj-title"><span>Each line is one agent’s credence that B is better</span></div>
      <div class="traj-wrap"><canvas id="traj-${key}"></canvas></div>
      <div class="strip-title"><span>Agents testing B each round; violet: against the pooled evidence</span></div>
      <div class="strip-wrap"><canvas id="strip-${key}"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, netId: idx === 0 ? 'cycle' : 'complete', budget: idx === 0 ? 0 : 14,
      select: $('net-' + key), bud: $('bud-' + key), budOut: $('out-bud-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      outTesting: $('testing-' + key), outAgainst: $('against-' + key), outTrapped: $('trapped-' + key), outSettled: $('settled-' + key),
      net: new V.NetView($('graph-' + key)), traj: new V.TrajView($('traj-' + key)), strip: new V.StripView($('strip-' + key)),
      graph: null, run: null, againstTotal: 0, trajHover: null,
    };
    side.tipNet = V.tooltip(side.net.cv.parentElement);
    side.tipTraj = V.tooltip(side.traj.cv.parentElement);
    for (const [id, label] of NET_OPTIONS) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = label;
      side.select.appendChild(o);
    }
    side.select.addEventListener('change', () => { side.netId = side.select.value; rebuild(); });
    side.bud.addEventListener('input', () => { side.budget = BUDGETS[+side.bud.value]; syncOutputs(); restart(); });
    return side;
  });

  let hoverAgent = -1, pinnedAgent = -1;
  const focusAgent = () => (hoverAgent >= 0 ? hoverAgent : pinnedAgent);
  let dirty = true, trajDirty = true;

  const rate = (side) => side.budget / S.H;

  function blurb(side) {
    if (!side.budget) return 'No exploration: agents only test B when they think it is better, as in the Zollman model.';
    const x = rate(side);
    return `Each doubter tests B anyway with probability ${x < 0.001 ? x.toPrecision(2) : x.toFixed(4)} per round (${side.budget} over ${S.H.toLocaleString()} rounds).`;
  }

  function rebuild() {
    for (const side of sides) {
      const d = NET_BY_ID[side.netId];
      side.graph = NETS.make(d.type, S.N, d.params, S.seed);
      side.net.setGraph(side.graph, NETS.layout(side.graph));
    }
    restart();
  }
  function restart() {
    setPlaying(false);
    for (const side of sides) {
      side.run = Z.createRun({ graph: side.graph, eps: S.eps, n: S.n, seed: S.seed, explore: rate(side), maxRounds: S.H });
      side.againstTotal = 0;
      side.blurb.textContent = blurb(side);
    }
    updateReadouts();
    dirty = trajDirty = true;
  }
  const anyRunning = () => sides.some((s) => s.run.status === 'running');
  function stepAll() {
    for (const side of sides) {
      if (side.run.status !== 'running') continue;
      side.run.step();
      side.againstTotal += side.run.againstHistory[side.run.againstHistory.length - 1];
    }
    updateReadouts();
    dirty = trajDirty = true;
  }

  let acc = 0;
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

  function updateReadouts() {
    let maxRound = 0;
    for (const side of sides) {
      const run = side.run;
      const N = run.graph.n;
      const believers = run.testingHistory[run.testingHistory.length - 1];
      side.outTesting.textContent = `${run.testedHistory[run.testedHistory.length - 1]} / ${N}`;
      side.outAgainst.textContent = side.againstTotal.toLocaleString();
      side.outTrapped.textContent = run.trappedRounds ? `${run.trappedRounds.toLocaleString()} rds` : '0';
      side.outSettled.textContent = run.status === 'running' ? '–' : `round ${run.round.toLocaleString()}`;
      let cls = 'running', label = 'Running';
      if (run.status === 'correct') { cls = 'correct'; label = '✓ Right consensus'; }
      else if (run.status === 'incorrect') { cls = 'incorrect'; label = '✕ Trapped for good'; }
      else if (run.status === 'timeout') { cls = 'timeout'; label = 'Not right by the horizon'; }
      else if (believers === 0) { cls = 'incorrect'; label = 'Trapped: nobody believes B'; }
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      maxRound = Math.max(maxRound, run.round);
    }
    $('round').textContent = maxRound.toLocaleString();
  }

  function draw() {
    for (const side of sides) {
      const run = side.run;
      const cur = run.history[run.history.length - 1];
      const fresh = run.round > 0;
      side.net.draw({
        value: (i) => cur[i],
        filled: (i) => (fresh ? run.lastK[i] >= 0 : cur[i] > 0.5),
        mark: (i) => fresh && run.against[i] === 1,
        focus: focusAgent(),
      });
    }
  }
  function xMax() { return Math.max(20, ...sides.map((s) => s.run.round)); }
  function trajOpts(side) {
    return {
      history: side.run.history, xMax: xMax(), scale: S.scale, focus: focusAgent(), hoverRound: side.trajHover,
      refs: [{ v: 0.5, label: 'tests B above 0.5' }, { v: 0.99, label: 'consensus 0.99', color: theme.T.good, below: S.scale === 'credence' }],
    };
  }
  function drawTraj() {
    for (const side of sides) {
      side.traj.draw(trajOpts(side));
      const run = side.run;
      side.strip.draw({
        tested: run.testedHistory, explorers: run.againstHistory, N: run.graph.n, xMax: xMax(), hoverRound: side.trajHover,
        // round r is trapped if nobody believed B going into it
        trap: run.testedHistory.map((_, r) => r > 0 && run.testingHistory[r - 1] === 0),
      });
    }
  }

  // hover
  for (const side of sides) {
    const cv = side.net.cv;
    cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.net.hit(ev);
      if (i !== hoverAgent) { hoverAgent = i; dirty = trajDirty = true; }
      if (i < 0) return side.tipNet.hide();
      const run = side.run;
      const c = run.credence(i);
      const informed = Z.sigmoid(run.informedLogodds(i));
      const k = run.lastK[i];
      side.tipNet.show(`<div class="t-head">Agent ${i + 1}</div>
        <div class="t-row"><span>Own credence</span><span>${c.toFixed(4)}</span></div>
        <div class="t-row"><span>With all pooled evidence</span><span>${informed.toFixed(4)}</span></div>
        <div class="t-row"><span>Last round</span><span>${run.round === 0 ? 'not started' : k >= 0 ? (run.explorers[i] ? 'explored B' : 'tested B') + `: ${k}/${run.n}` : 'did A'}</span></div>`, x, y);
    });
    cv.addEventListener('pointerleave', () => { hoverAgent = -1; side.tipNet.hide(); dirty = trajDirty = true; });
    cv.addEventListener('click', (ev) => { const { i } = side.net.hit(ev); pinnedAgent = i === pinnedAgent ? -1 : i; dirty = trajDirty = true; });
    const tc = side.traj.cv;
    tc.addEventListener('pointermove', (ev) => {
      const o = trajOpts(side);
      const { round, agent, x, y } = side.traj.pick(ev, o);
      side.trajHover = round;
      if (agent !== hoverAgent) { hoverAgent = agent; dirty = true; }
      const run = side.run;
      let html = `<div class="t-head">Round ${round.toLocaleString()}</div>
        <div class="t-row"><span>Believe B</span><span>${run.testingHistory[round]} / ${run.graph.n}</span></div>`;
      if (round > 0) html += `<div class="t-row"><span>Tested B</span><span>${run.testedHistory[round]} (${run.againstHistory[round]} against evidence)</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Agent ${agent + 1}</span><span>${run.history[round][agent].toFixed(4)}</span></div>`;
      side.tipTraj.show(html, x, y);
      trajDirty = true;
    });
    tc.addEventListener('pointerleave', () => { side.trajHover = null; hoverAgent = -1; side.tipTraj.hide(); dirty = trajDirty = true; });
  }

  let lastTs = 0, lastTraj = 0;
  function frame(ts) {
    const dt = lastTs ? Math.min(100, ts - lastTs) : 16;
    lastTs = ts;
    if (S.playing) {
      const sp = SPEEDS[S.speed];
      if (!isFinite(sp)) {
        const t0 = performance.now();
        do stepAll(); while (anyRunning() && performance.now() - t0 < 12);
      } else {
        acc += dt;
        const interval = 1000 / sp;
        let k = 0;
        while (acc >= interval && k < 4) { acc -= interval; stepAll(); k++; }
        if (k === 4) acc = 0;
      }
      if (!anyRunning()) setPlaying(false);
    }
    if (dirty) { draw(); dirty = false; }
    if (trajDirty && (!S.playing || ts - lastTraj > 45)) { drawTraj(); trajDirty = false; lastTraj = ts; }
    requestAnimationFrame(frame);
  }

  // controls
  function syncOutputs() {
    $('in-N').value = S.N; $('out-N').textContent = S.N;
    $('in-eps').value = Math.max(0, EPS_STEPS.indexOf(S.eps)); $('out-eps').textContent = S.eps;
    $('in-n').value = Math.max(0, N_STEPS.indexOf(S.n)); $('out-n').textContent = S.n.toLocaleString();
    $('in-H').value = Math.max(0, H_STEPS.indexOf(S.H)); $('out-H').textContent = S.H.toLocaleString();
    $('in-seed').value = S.seed;
    $('in-speed').value = S.speed;
    const sp = SPEEDS[S.speed];
    $('out-speed').textContent = isFinite(sp) ? `${sp} / s` : 'Max';
    for (const side of sides) {
      side.select.value = side.netId;
      side.bud.value = Math.max(0, BUDGETS.indexOf(side.budget));
      side.budOut.textContent = side.budget ? `${side.budget} per agent` : 'none';
    }
    const ex = sides.find((s) => s.budget > 0);
    $('hint-x').textContent = ex
      ? `A budget of ${ex.budget} over ${S.H.toLocaleString()} rounds means x = ${(ex.budget / S.H).toPrecision(2)} per round.`
      : 'Rounds the run may last; also sets the exploration rate.';
  }
  function bindRange(id, apply) {
    $(id).addEventListener('input', () => { apply(+$(id).value); syncOutputs(); rebuild(); });
  }
  bindRange('in-N', (v) => (S.N = v));
  bindRange('in-eps', (v) => (S.eps = EPS_STEPS[v]));
  bindRange('in-n', (v) => (S.n = N_STEPS[v]));
  bindRange('in-H', (v) => (S.H = H_STEPS[v]));
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); $('find-note').textContent = ''; syncOutputs(); rebuild(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); $('find-note').textContent = ''; syncOutputs(); rebuild(); });
  $('in-speed').addEventListener('input', () => { S.speed = +$('in-speed').value; syncOutputs(); });
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    S.scale = b.dataset.scale;
    document.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    trajDirty = true;
  }));
  $('btn-play').addEventListener('click', () => setPlaying(!S.playing));
  $('btn-step').addEventListener('click', () => { setPlaying(false); stepAll(); });
  $('btn-reset').addEventListener('click', () => restart());
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === ' ') { ev.preventDefault(); setPlaying(!S.playing); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); setPlaying(false); stepAll(); }
    else if (ev.key === 'r' || ev.key === 'R') restart();
  });

  let finding = null;
  $('btn-find').addEventListener('click', () => {
    if (finding) { finding.stop = true; return; }
    setPlaying(false);
    const btn = $('btn-find');
    const job = (finding = { seed: S.seed + 1, tried: 0, stop: false, limit: 1500 });
    btn.textContent = 'Stop searching';
    const outcome = (side, seed) => {
      const d = NET_BY_ID[side.netId];
      const run = Z.createRun({ graph: NETS.make(d.type, S.N, d.params, seed), eps: S.eps, n: S.n, seed, explore: rate(side), maxRounds: S.H, recordHistory: false });
      while (run.step());
      return run;
    };
    const done = (msg) => { finding = null; btn.textContent = 'Find a rescue run'; $('find-note').textContent = msg; };
    const explorer = sides.findIndex((s) => s.budget > 0);
    if (explorer < 0) return done('Give one panel an exploration budget first.');
    (function tick() {
      const t0 = performance.now();
      while (performance.now() - t0 < 30 && job.tried < job.limit && !job.stop) {
        const seed = job.seed++;
        job.tried++;
        const e = outcome(sides[explorer], seed);
        if (!(e.everTrapped && e.status === 'correct')) continue;
        const o = outcome(sides[1 - explorer], seed);
        if (o.status === 'correct' && !o.everTrapped) {
          S.seed = seed;
          syncOutputs();
          rebuild();
          return done(`Seed ${seed}: the exploring network is trapped for ${e.trappedRounds.toLocaleString()} rounds and recovers; the other never falls in.`);
        }
      }
      if (job.stop) return done(`Stopped after ${job.tried.toLocaleString()} seeds.`);
      if (job.tried >= job.limit) return done(`No such run in ${job.limit.toLocaleString()} seeds with these settings.`);
      $('find-note').textContent = `Searching… ${job.tried.toLocaleString()} seeds tried`;
      setTimeout(tick, 0);
    })();
  });

  theme.read();
  V.watchSize(sides.flatMap((s) => [s.net.cv, s.traj.cv, s.strip.cv]), () => { dirty = trajDirty = true; });

  // ================================================================ charts
  function svgEl(name, attrs, style, text) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (style) e.setAttribute('style', style);
    if (text != null) e.textContent = text;
    return e;
  }
  const HORIZON_COLOR = ['var(--s2)', 'var(--s1)', 'var(--s3)'];
  let highlighted = new Set(['cycle', 'ring3']);

  function drawExchange() {
    const box = $('xchart');
    const W = Math.max(300, box.clientWidth || 560), H = 320;
    const m = { l: 52, r: 16, t: 14, b: 42 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    box.innerHTML = '';
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Failure probability against exploration budget' });
    box.appendChild(svg);
    const bx = [0.1, 300], fy = [0.001, 0.15];
    const X = (b) => m.l + ((Math.log10(b) - Math.log10(bx[0])) / (Math.log10(bx[1]) - Math.log10(bx[0]))) * pw;
    const Y = (f) => m.t + ph - ((Math.log10(Math.max(fy[0], f)) - Math.log10(fy[0])) / (Math.log10(fy[1]) - Math.log10(fy[0]))) * ph;
    for (const f of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1]) {
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: Y(f), y2: Y(f) }, 'stroke: var(--rule)'));
      svg.appendChild(svgEl('text', { x: m.l - 8, y: Y(f) + 4, 'text-anchor': 'end' }, 'fill: var(--muted); font: 11px var(--mono)', +(f * 100).toPrecision(2) + '%'));
    }
    for (const b of [0.1, 0.3, 1, 3, 10, 30, 100, 300]) {
      svg.appendChild(svgEl('line', { x1: X(b), x2: X(b), y1: m.t + ph, y2: m.t + ph + 4 }, 'stroke: var(--axis)'));
      svg.appendChild(svgEl('text', { x: X(b), y: m.t + ph + 17, 'text-anchor': 'middle' }, 'fill: var(--muted); font: 11px var(--mono)', String(b)));
    }
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph }, 'stroke: var(--axis)'));
    svg.appendChild(svgEl('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, 'fill: var(--ink-2); font: 12px var(--body)', 'Exploration budget per agent (complete network)'));

    // topology reference lines
    const rows = topoRows();
    for (const r of rows) {
      if (!highlighted.has(r.id) || r.id === 'complete') continue;
      const y = Y(1 - r.p);
      svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y }, 'stroke: var(--ink-2); stroke-width: 1; stroke-opacity: 0.55'));
      svg.appendChild(svgEl('text', { x: m.l + 6, y: y - 5 }, 'fill: var(--ink-2); font: 11.5px var(--body)', r.label));
      if (r.eq > bx[0]) {
        svg.appendChild(svgEl('line', { x1: X(r.eq), x2: X(r.eq), y1: y, y2: m.t + ph }, 'stroke: var(--ink-2); stroke-opacity: 0.35'));
        svg.appendChild(svgEl('circle', { cx: X(r.eq), cy: y, r: 4.5 }, 'fill: var(--ink); stroke: var(--surface); stroke-width: 2'));
        svg.appendChild(svgEl('text', { x: X(r.eq) + 7, y: y + 14 }, 'fill: var(--ink); font: 600 11.5px var(--mono)', '≈' + (r.eq < 10 ? r.eq.toFixed(1) : Math.round(r.eq))));
      }
    }
    // complete network without exploration
    const c0 = 1 - DATA.topologies.find((t) => t.id === 'complete').acc.correct / DATA.topologies.find((t) => t.id === 'complete').acc.runs;
    svg.appendChild(svgEl('line', { x1: m.l, x2: m.l + pw, y1: Y(c0), y2: Y(c0) }, 'stroke: var(--bad); stroke-opacity: 0.6'));
    svg.appendChild(svgEl('text', { x: m.l + pw - 4, y: Y(c0) - 5, 'text-anchor': 'end' }, 'fill: var(--ink-2); font: 11.5px var(--body)', 'Complete, no exploration'));

    // curves
    DATA.curves.forEach((c, ci) => {
      const main = c.horizon === DATA.mainHorizon;
      const color = HORIZON_COLOR[ci % HORIZON_COLOR.length];
      let d = '';
      const pts = c.points.filter((p) => failure(p) > 0);
      pts.forEach((p, i) => { d += (i ? 'L' : 'M') + X(p.budget).toFixed(1) + ',' + Y(failure(p)).toFixed(1); });
      svg.appendChild(svgEl('path', { d }, `fill: none; stroke: ${color}; stroke-width: ${main ? 2.5 : 1.5}; stroke-linejoin: round`));
      for (const p of pts) svg.appendChild(svgEl('circle', { cx: X(p.budget), cy: Y(failure(p)), r: main ? 4 : 3 }, `fill: ${color}; stroke: var(--surface); stroke-width: 2`));
    });

    // hover
    let tip = box.querySelector('.tooltip');
    tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    box.appendChild(tip);
    const guide = svgEl('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, visibility: 'hidden' }, 'stroke: var(--ink-2)');
    svg.appendChild(guide);
    const hit = svgEl('rect', { x: m.l, y: m.t, width: pw, height: ph }, 'fill: transparent');
    svg.appendChild(hit);
    const budgets = DATA.curves[0].points.map((p) => p.budget);
    hit.addEventListener('pointermove', (ev) => {
      const rect = svg.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      let bi = 0;
      budgets.forEach((b, i) => { if (Math.abs(X(b) - px) < Math.abs(X(budgets[bi]) - px)) bi = i; });
      guide.setAttribute('x1', X(budgets[bi])); guide.setAttribute('x2', X(budgets[bi])); guide.setAttribute('visibility', 'visible');
      let html = `<div class="t-head">Budget ${budgets[bi]} per agent</div>`;
      DATA.curves.forEach((c, ci) => {
        const p = c.points[bi];
        html += `<div class="t-row"><span><span class="sw" style="background:${HORIZON_COLOR[ci]}"></span>${c.horizon.toLocaleString()} rounds</span><span>${(100 * (1 - failure(p))).toFixed(1)}% right</span></div>`;
      });
      const main = mainCurve().points[bi];
      html += `<div class="t-row"><span>Explored, per agent</span><span>${(main.explorations / main.runs / DATA.settings.N).toFixed(2)} batches</span></div>`;
      tip.innerHTML = html;
      tip.hidden = false;
      const left = (X(budgets[bi]) / W) * box.clientWidth;
      tip.style.left = (left + 12 + tip.offsetWidth > box.clientWidth ? left - tip.offsetWidth - 12 : left + 12) + 'px';
      tip.style.top = '10px';
    });
    hit.addEventListener('pointerleave', () => { guide.setAttribute('visibility', 'hidden'); tip.hidden = true; });

    $('xlegend').innerHTML = DATA.curves.map((c, ci) => `<span><i style="background:${HORIZON_COLOR[ci]}"></i>Horizon ${c.horizon.toLocaleString()} rounds${c.horizon === DATA.mainHorizon ? ' (main)' : ''}</span>`).join('') +
      '<span><i style="background:var(--ink-2)"></i>A network with no exploration</span>';
  }

  function drawDots() {
    const box = $('dots');
    const rows = topoRows();
    const W = Math.max(300, box.clientWidth || 520), rowH = 26;
    const m = { l: 178, r: 54, t: 22, b: 34 };
    const H = m.t + m.b + rows.length * rowH;
    const pw = W - m.l - m.r;
    box.innerHTML = '';
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Exploration equivalent of each network' });
    box.appendChild(svg);
    const xMaxV = Math.max(16, Math.ceil(Math.max(...rows.map((r) => r.hi)) / 2) * 2);
    const X = (v) => m.l + (Math.min(v, xMaxV) / xMaxV) * pw;
    for (let v = 0; v <= xMaxV; v += xMaxV > 20 ? 5 : 2) {
      svg.appendChild(svgEl('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b }, 'stroke: var(--rule)'));
      svg.appendChild(svgEl('text', { x: X(v), y: H - m.b + 16, 'text-anchor': 'middle' }, 'fill: var(--muted); font: 11px var(--mono)', String(v)));
    }
    svg.appendChild(svgEl('text', { x: W - 4, y: 12, 'text-anchor': 'end' }, 'fill: var(--muted); font: 11px var(--body)', 'links'));
    rows.forEach((r, i) => {
      const y = m.t + i * rowH + rowH / 2;
      const g = svgEl('g', { class: 'row-hit', tabindex: '0', role: 'button', 'aria-label': `Load ${r.label} with its matched budget` });
      g.appendChild(svgEl('rect', { class: 'bg', x: 0, y: y - rowH / 2, width: W, height: rowH, rx: 4 }, 'fill: transparent'));
      const sel = sides[0].netId === r.id;
      g.appendChild(svgEl('text', { x: m.l - 10, y: y + 4, 'text-anchor': 'end' }, `fill: var(--ink); font: ${sel ? 600 : 400} 12.5px var(--body)`, r.label));
      if (r.hi > r.lo) g.appendChild(svgEl('line', { x1: X(r.lo), x2: X(r.hi), y1: y, y2: y }, 'stroke: var(--s1); stroke-width: 2; stroke-opacity: 0.45; stroke-linecap: round'));
      g.appendChild(svgEl('circle', { cx: X(r.eq), cy: y, r: 5 }, 'fill: var(--s1); stroke: var(--surface); stroke-width: 2'));
      g.appendChild(svgEl('text', { x: X(r.hi) + 8, y: y + 4 }, 'fill: var(--ink-2); font: 11px var(--mono)', r.eq < 10 ? r.eq.toFixed(1) : r.eq.toFixed(0)));
      g.appendChild(svgEl('text', { x: W - 4, y: y + 4, 'text-anchor': 'end' }, 'fill: var(--muted); font: 11px var(--mono)', String(Math.round(r.acc.stats.edges))));
      const act = () => loadMatch(r);
      g.addEventListener('click', act);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
      g.addEventListener('pointerenter', () => { if (!highlighted.has(r.id)) { highlighted.add(r.id); r._temp = true; drawExchange(); } });
      g.addEventListener('pointerleave', () => { if (r._temp) { highlighted.delete(r.id); r._temp = false; drawExchange(); } });
      svg.appendChild(g);
    });
    svg.appendChild(svgEl('text', { x: m.l + pw / 2, y: H - 4, 'text-anchor': 'middle' }, 'fill: var(--ink-2); font: 12px var(--body)', 'Exploration budget a complete network needs to match it'));
  }

  function drawTable() {
    const rows = topoRows();
    let html = '<thead><tr><th>Network</th><th>Links</th><th>Right consensus</th><th>Mean rounds</th><th>Exploration equivalent</th></tr></thead><tbody>';
    for (const r of rows) {
      const a = r.acc;
      html += `<tr><td>${r.label}</td><td>${Math.round(a.stats.edges)}</td><td>${(100 * r.p).toFixed(1)}%</td><td>${Math.round(a.roundsCorrect / a.correct).toLocaleString()}</td><td>${r.eq.toFixed(1)} <span class="r">${r.lo.toFixed(1)}–${r.hi.toFixed(1)}</span></td></tr>`;
    }
    $('xtable').innerHTML = html + '</tbody>';
  }

  function drawStats() {
    const rows = topoRows();
    const cyc = rows.find((r) => r.id === 'cycle');
    const comp = rows.find((r) => r.id === 'complete');
    const B = cyc.eq;
    const trap = curveAt(B, (p) => p.everTrapped / p.runs);
    const fail = 1 - cyc.p;
    const realized = curveAt(B, (p) => p.explorations / p.runs / DATA.settings.N);
    const speed = curveAt(B, (p) => p.roundsCorrect / p.correct);
    const pct = (v) => (100 * v).toFixed(1) + '%';
    $('mech-stats').innerHTML = `
      <div class="stat"><div class="k">Complete, no exploration</div><div class="v">${pct(1 - comp.p)}</div><div class="d">fall into the trap, and all of them stay there</div></div>
      <div class="stat"><div class="k">Complete, budget ≈ ${Math.round(B)}</div><div class="v">${pct(trap)}</div><div class="d">fall into the trap; ${pct(1 - fail / trap)} of those climb back out</div></div>
      <div class="stat"><div class="k">Cycle, no exploration</div><div class="v">${pct(fail)}</div><div class="d">fall into the trap, and all of them stay there</div></div>`;
    $('cycle-equiv').textContent = Math.round(B);
    $('cycle-realized').textContent = `about ${realized.toFixed(1)}`;
    $('cycle-speed').textContent = Math.round(speed).toLocaleString();
    $('cycle-own-speed').textContent = Math.round(cyc.acc.roundsCorrect / cyc.acc.correct).toLocaleString();
    const s = DATA.settings;
    $('dots-sub').textContent = `${s.N} agents, ε = ${s.eps}, n = ${s.n.toLocaleString()}. Whiskers are 95% intervals from the networks’ own success rates.`;
  }

  function loadMatch(r) {
    sides[0].netId = r.id;
    sides[0].budget = 0;
    sides[1].netId = 'complete';
    // nearest available budget step to the matched value
    sides[1].budget = BUDGETS.reduce((best, b) => (Math.abs(b - r.eq) < Math.abs(best - r.eq) ? b : best), BUDGETS[1]);
    S.N = DATA.settings.N; S.eps = DATA.settings.eps; S.n = DATA.settings.n;
    syncOutputs();
    rebuild();
    drawDots();
    $('find-note').textContent = `${r.label} vs. a complete network with budget ${sides[1].budget}, its nearest matched setting (≈${r.eq.toFixed(1)}).`;
    document.querySelector('.lab').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawAll() { drawExchange(); drawDots(); drawTable(); drawStats(); }
  new ResizeObserver(() => { drawExchange(); drawDots(); }).observe($('xchart'));

  // ------------------------------------------------------------ recompute
  let rc = null;
  $('rc-run').addEventListener('click', () => {
    if (rc) { rc.stop = true; return; }
    const N = Math.max(3, Math.min(40, Math.round(+$('rc-N').value || 10)));
    const eps = Math.max(0.0005, Math.min(0.2, +$('rc-eps').value || 0.001));
    const n = Math.max(1, Math.round(+$('rc-n').value || 1000));
    const runs = Math.max(100, Math.round(+$('rc-runs').value || 2000));
    const H = 10000;
    const budgets = [0.3, 1, 3, 10, 30, 100];
    const tasks = [];
    for (const [id, , type, params] of NET_OPTIONS) tasks.push({ kind: 'topo', id, type, params });
    for (const b of budgets) tasks.push({ kind: 'curve', budget: b });
    const empty = () => ({ runs: 0, correct: 0, incorrect: 0, timeout: 0, roundsCorrect: 0, explorations: 0, everTrapped: 0, stats: { edges: 0, meanDegree: 0, components: 0 } });
    const data = { settings: { N, eps, n }, mainHorizon: H, topologies: [], curves: [{ horizon: H, points: [] }] };
    const seed = rng.randomSeed();
    rc = { stop: false, ti: 0, done: 0, total: tasks.length * runs, t0: performance.now() };
    $('rc-run').textContent = 'Stop';
    const complete = NETS.make('complete', N);
    (function tick() {
      const t0 = performance.now();
      while (performance.now() - t0 < 30 && rc.ti < tasks.length && !rc.stop) {
        const task = tasks[rc.ti];
        if (!task.acc) {
          task.acc = empty();
          task.rand = rng.mulberry32(rng.mix(seed, rc.ti));
          if (task.kind === 'topo' && !NETS.TYPES[task.type].random) task.graph = NETS.make(task.type, N, task.params, 0);
        }
        const g = task.kind === 'curve' ? complete : task.graph || NETS.make(task.type, N, task.params, (task.rand() * 4294967296) >>> 0);
        const res = Z.simulate(g, eps, n, Z.randomPriors(N, task.rand), task.rand, task.kind === 'curve' ? H : 20000, 0.99, task.kind === 'curve' ? task.budget / H : 0);
        const a = task.acc;
        a.runs++;
        a[res.outcome]++;
        if (res.outcome === 'correct') a.roundsCorrect += res.rounds;
        a.explorations += res.explorations;
        if (res.everTrapped) a.everTrapped++;
        if (a.runs <= 50) { const st = NETS.stats(g); a.stats.edges += st.edges / 50; a.stats.meanDegree += st.meanDegree / 50; }
        rc.done++;
        if (a.runs >= runs) {
          if (task.kind === 'topo') data.topologies.push({ id: task.id, type: task.type, params: task.params, acc: a });
          else data.curves[0].points.push(Object.assign({ budget: task.budget, rate: task.budget / H }, a));
          rc.ti++;
        }
      }
      $('rc-fill').style.width = ((100 * rc.done) / rc.total).toFixed(1) + '%';
      if (rc.stop || rc.ti >= tasks.length) {
        const ok = rc.ti >= tasks.length;
        $('rc-progress').textContent = ok ? `Done in ${((performance.now() - rc.t0) / 1000).toFixed(1)} s.` : 'Stopped; showing the precomputed results.';
        $('rc-run').textContent = 'Recompute';
        if (ok) {
          DATA = data;
          $('rc-source').textContent = `Showing your recomputed results: N = ${N}, ε = ${eps}, n = ${n}, ${runs.toLocaleString()} runs per point, horizon ${H.toLocaleString()}.`;
          drawAll();
        }
        rc = null;
        return;
      }
      $('rc-progress').textContent = `Running… ${rc.done.toLocaleString()} of ${rc.total.toLocaleString()} runs`;
      setTimeout(tick, 0);
    })();
  });

  // ------------------------------------------------------------ boot
  theme.onChange(() => { dirty = trajDirty = true; });
  syncOutputs();
  rebuild();
  drawAll();
  $('rc-source').textContent = `Showing precomputed results: ${DATA.topologies[0].acc.runs.toLocaleString()} runs per network and per budget.`;
  $('find-note').textContent = 'Seed 4: the complete network gives up on B at round 15, as on the Zollman page. Here its explorers bring it back.';
  requestAnimationFrame(frame);
})();
