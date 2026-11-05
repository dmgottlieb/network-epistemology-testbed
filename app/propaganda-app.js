/* UI for propaganda.html: scientists, policy makers and a propagandist or journalist. */
(function () {
  'use strict';

  const { networks: NETS, propaganda: PR, views: V, lab: LAB } = window.NET;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;

  const EPS = [0.01, 0.025, 0.05, 0.075, 0.1, 0.2];
  const NS = [1, 2, 5, 10, 20, 50, 100, 500, 1000];
  const RES = [10, 20, 50, 100, 200];
  const STUDY = [1, 2, 5, 10, 20, 50];
  const S = { K: 20, net: 'cycle', eps: 0.05, n: 10, P: 10, listen: 0.5, resources: 50, studyN: 10, doubleCount: true, seed: 1, scale: 'credence' };
  const MODES = [
    ['none', 'No propagandist'], ['selective', 'Propagandist: selective sharing'], ['production', 'Propagandist: funds its own studies'],
    ['all', 'Journalist: reports everything'], ['random', 'Journalist: two random results'], ['fair', 'Journalist: “fair” (one per side)'],
  ];
  const BLURB = {
    none: 'Policy makers hear only the scientists they listen to.',
    selective: 'Each round the propagandist forwards every real result that favoured A to every policy maker.',
    production: 'The propagandist runs its own honest studies of B and publishes only those that favoured A.',
    all: 'Policy makers hear science only through a journalist, who reports every result.',
    random: 'Policy makers hear science only through a journalist, who reports two results chosen at random.',
    fair: 'The journalist reports one result for each side every round, digging up an old one if a side has none.',
  };

  // ------------------------------------------------------------ panels
  const panelsEl = $('panels');
  const sides = ['a', 'b'].map((key, idx) => {
    const el = document.createElement('article');
    el.className = 'panel';
    el.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <select id="mode-${key}" aria-label="Panel ${idx + 1} intervention">${MODES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <span class="pill running" id="status-${key}" aria-live="polite"><span class="dot"></span><span>Running</span></span>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap" style="height: clamp(300px, 30vw, 380px)"><canvas id="graph-${key}"></canvas></div>
      <dl class="readout">
        <div><dt>Testing B</dt><dd id="sci-${key}">–</dd></div>
        <div><dt>Science mean</dt><dd id="scimean-${key}">–</dd></div>
        <div><dt>Public mean</dt><dd id="pm-${key}">–</dd></div>
        <div><dt title="Results the propagandist or journalist passed on this round">Passed on</dt><dd id="shared-${key}">–</dd></div>
      </dl>
      <div class="traj-title"><span>Each line is one policy maker’s credence that B is better</span></div>
      <div class="traj-wrap"><canvas id="traj-${key}"></canvas></div>
      <div class="strip-title"><span>Scientists testing B each round (identical in both panels)</span></div>
      <div class="strip-wrap"><canvas id="strip-${key}"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, mode: idx === 0 ? 'none' : 'selective',
      select: $('mode-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      out: { sci: $('sci-' + key), scimean: $('scimean-' + key), pm: $('pm-' + key), shared: $('shared-' + key) },
      net: new V.NetView($('graph-' + key)), traj: new V.TrajView($('traj-' + key)), strip: new V.StripView($('strip-' + key)),
      run: null, display: null, particles: [], animT0: 0, animDur: 0, prevS: null, prevP: null, trajHover: null,
    };
    side.tipNet = V.tooltip(side.net.cv.parentElement);
    side.tipTraj = V.tooltip(side.traj.cv.parentElement);
    side.select.addEventListener('change', () => { side.mode = side.select.value; clearScenario(); rebuild(); });
    return side;
  });
  let sciGraph = null;
  let hover = -1, pinned = -1;
  const focus = () => (hover >= 0 ? hover : pinned);
  const listenK = () => Math.max(1, Math.min(S.K, Math.round(S.listen * S.K)));
  const hasSource = (m) => m !== 'none';
  const direct = (m) => m === 'none' || m === 'selective' || m === 'production';

  function buildDisplay(side) {
    const K = S.K, P = S.P;
    const sciPos = NETS.layout(sciGraph).map((p) => ({ x: 0.14 + 0.72 * p.x, y: 0.02 + 0.6 * p.y }));
    const pos = sciPos.slice();
    for (let j = 0; j < P; j++) pos.push({ x: P === 1 ? 0.5 : 0.06 + (0.88 * j) / (P - 1), y: 0.94 });
    const src = K + P;
    const edges = sciGraph.edges.map((e) => e.slice());
    if (direct(side.mode)) side.run.listens.forEach((set, j) => set.forEach((i) => edges.push([i, K + j])));
    if (hasSource(side.mode)) {
      pos.push({ x: 0.5, y: 0.76 });
      for (let j = 0; j < P; j++) edges.push([K + j, src]);
    }
    const g = NETS.buildGraph(pos.length, edges);
    side.display = { g, K, P, src: hasSource(side.mode) ? src : -1 };
    side.net.minDOverride = 0;
    side.net.setGraph(g, pos);
    // size nodes by the scientists' spacing, not the policy-maker row
    let best = Infinity;
    for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) best = Math.min(best, Math.hypot(sciPos[i].x - sciPos[j].x, sciPos[i].y - sciPos[j].y));
    side.net.minD = Math.min(best, 0.8 / Math.max(2, P));
  }

  function rebuild() {
    sciGraph = NETS.make(S.net, S.K, NETS.defaultParams(S.net), S.seed);
    restart();
  }
  function restart() {
    if (T) T.setPlaying(false);
    for (const side of sides) {
      side.run = PR.createRun({
        graph: sciGraph, eps: S.eps, n: S.n, seed: S.seed, policyMakers: S.P, listen: listenK(), mode: side.mode,
        resources: S.resources, studyN: S.studyN, doubleCount: S.doubleCount, maxRounds: 10000,
      });
      side.particles = [];
      side.animDur = 0;
      side.prevS = side.run.sci.history[0];
      side.prevP = side.run.pmHistory[0];
      side.blurb.textContent = BLURB[side.mode];
      buildDisplay(side);
    }
    readouts();
    if (T) T.invalidate();
  }
  const running = () => sides.some((s) => s.run.status === 'running');

  function step(animate, dur) {
    const now = performance.now();
    for (const side of sides) {
      const run = side.run;
      if (run.status !== 'running') continue;
      side.prevS = run.sci.history[run.sci.history.length - 1];
      side.prevP = run.pmHistory[run.pmHistory.length - 1];
      run.step();
      side.particles = [];
      side.animDur = 0;
      if (animate) {
        side.animT0 = now;
        side.animDur = dur;
        const { K, src } = side.display;
        const kRes = run.sci.lastK, n = run.sci.n;
        for (const [a, b] of sciGraph.edges) {
          if (kRes[a] >= 0) side.particles.push(a, b, Math.sign(2 * kRes[a] - n), 1);
          if (kRes[b] >= 0) side.particles.push(b, a, Math.sign(2 * kRes[b] - n), 1);
        }
        if (direct(side.mode)) run.listens.forEach((set, j) => set.forEach((i) => { if (kRes[i] >= 0) side.particles.push(i, K + j, Math.sign(2 * kRes[i] - n), 1); }));
        if (src >= 0) for (const [x, m] of run.lastBroadcast) for (let j = 0; j < run.P; j++) side.particles.push(src, K + j, Math.sign(2 * x - m), 1);
      }
    }
    readouts();
  }

  function readouts() {
    let maxRound = 0;
    for (const side of sides) {
      const run = side.run, sci = run.sci, K = S.K;
      let on = 0, sum = 0;
      for (let i = 0; i < K; i++) { const c = sci.credence(i); sum += c; if (c > 0.5) on++; }
      side.out.sci.textContent = `${on} / ${K}`;
      side.out.scimean.textContent = (sum / K).toFixed(3);
      side.out.pm.textContent = run.pmMean().toFixed(3);
      side.out.shared.textContent = hasSource(side.mode) && run.round > 0 ? String(run.lastBroadcast.length) : '–';
      const pm = run.pmMean();
      let cls = 'running', label = 'Running';
      if (run.status === 'correct') { cls = pm > 0.5 ? 'correct' : 'incorrect'; label = `Science ✓ · public ${pm.toFixed(2)}`; }
      else if (run.status === 'incorrect') { cls = 'incorrect'; label = 'Science settled on A'; }
      else if (run.status === 'timeout') { cls = 'timeout'; label = 'Unsettled at cap'; }
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      side.status.title = run.status === 'correct' ? 'The scientists agree B is better; the number is the policy makers’ mean credence in B.' : '';
      maxRound = Math.max(maxRound, run.round);
    }
    $('round').textContent = maxRound.toLocaleString();
  }

  function draw(ts) {
    let animating = false;
    for (const side of sides) {
      const run = side.run, { K, P, src } = side.display;
      let p = 1;
      if (side.animDur) p = Math.max(0, Math.min(1, (ts - side.animT0) / side.animDur));
      if (p < 1) animating = true;
      const ep = V.ease(p);
      const curS = run.sci.history[run.sci.history.length - 1], curP = run.pmHistory[run.pmHistory.length - 1];
      const lerp = (a, b) => (p < 1 ? a + (b - a) * ep : b);
      side.net.draw({
        value: (i) => (i < K ? lerp(side.prevS[i], curS[i]) : i < K + P ? lerp(side.prevP[i - K], curP[i - K]) : 0),
        filled: (i) => (i < K ? (p < 1 ? side.prevS[i] > 0.5 : curS[i] > 0.5) : true),
        shape: (i) => (i < K ? 'circle' : i < K + P ? 'square' : 'diamond'),
        size: (i) => (i < K ? 1 : i < K + P ? 0.85 : 1.3),
        color: (i) => (i === src ? (side.mode === 'selective' || side.mode === 'production' ? theme.T.bad : theme.T.ink2) : null),
        edgeWeight: (i, j) => {
          const hi = Math.max(i, j), lo = Math.min(i, j);
          if (hi < K) return 1;
          if (src >= 0 && hi === src) return side.mode === 'selective' || side.mode === 'production' ? -0.7 : 0.6;
          return lo < K ? 0 : 1;
        },
        particles: side.particles,
        progress: p,
        focus: focus(),
      });
    }
    return animating;
  }
  const xMax = () => Math.max(20, ...sides.map((s) => s.run.round));
  function trajOpts(side) {
    return { history: side.run.pmHistory, xMax: xMax(), scale: S.scale, focus: hover >= S.K && hover < S.K + S.P ? hover - S.K : -1, hoverRound: side.trajHover,
      refs: [{ v: 0.5, label: 'favours B above 0.5' }] };
  }
  function drawSlow() {
    for (const side of sides) {
      side.traj.draw(trajOpts(side));
      const sci = side.run.sci;
      side.strip.draw({ tested: sci.testedHistory, explorers: null, trap: null, N: S.K, xMax: xMax(), hoverRound: side.trajHover });
    }
  }

  for (const side of sides) {
    side.net.cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.net.hit(ev);
      if (i !== hover) { hover = i; T.invalidate(); }
      if (i < 0) return side.tipNet.hide();
      const run = side.run, { K, P, src } = side.display;
      let html;
      if (i < K) {
        const k = run.sci.lastK[i];
        html = `<div class="t-head">Scientist ${i + 1}</div><div class="t-row"><span>Credence in B</span><span>${run.sci.credence(i).toFixed(4)}</span></div>
          <div class="t-row"><span>Last round</span><span>${run.round === 0 ? 'not started' : k >= 0 ? `B: ${k} / ${run.sci.n}` : 'did A'}</span></div>`;
      } else if (i < K + P) {
        const j = i - K;
        html = `<div class="t-head">Policy maker ${j + 1}</div><div class="t-row"><span>Credence in B</span><span>${run.pmCredence(j).toFixed(4)}</span></div>
          <div class="t-row"><span>Listens to</span><span>${direct(side.mode) ? run.listens[j].length + ' scientists' : 'the journalist'}</span></div>`;
      } else {
        html = `<div class="t-head">${side.mode === 'selective' || side.mode === 'production' ? 'Propagandist' : 'Journalist'}</div><div class="t-row"><span>Passed on this round</span><span>${run.lastBroadcast.length} result${run.lastBroadcast.length === 1 ? '' : 's'}</span></div>`;
      }
      side.tipNet.show(html, x, y);
    });
    side.net.cv.addEventListener('pointerleave', () => { hover = -1; side.tipNet.hide(); T.invalidate(); });
    side.traj.cv.addEventListener('pointermove', (ev) => {
      const o = trajOpts(side);
      const { round, agent, x, y } = side.traj.pick(ev, o);
      side.trajHover = round;
      hover = agent >= 0 ? S.K + agent : -1;
      const h = side.run.pmHistory[round];
      let s = 0;
      for (const v of h) s += v;
      let html = `<div class="t-head">Round ${round}</div><div class="t-row"><span>Public’s mean</span><span>${(s / h.length).toFixed(3)}</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Policy maker ${agent + 1}</span><span>${h[agent].toFixed(4)}</span></div>`;
      side.tipTraj.show(html, x, y);
      T.invalidate();
    });
    side.traj.cv.addEventListener('pointerleave', () => { side.trajHover = null; hover = -1; side.tipTraj.hide(); T.invalidate(); });
  }

  // ------------------------------------------------------------ controls
  const RAIL = [['in-K', 'K'], ['in-eps', 'eps', EPS], ['in-n', 'n', NS], ['in-P', 'P'], ['in-listen', 'listen'], ['in-res', 'resources', RES], ['in-study', 'studyN', STUDY]];
  function sync() {
    for (const [id, key, steps] of RAIL) {
      $(id).value = steps ? Math.max(0, steps.indexOf(S[key])) : S[key];
      const out = $('out-' + id.slice(3));
      if (out) out.textContent = key === 'listen' ? `${Math.round(S.listen * 100)}% (${listenK()})` : S[key].toLocaleString();
    }
    $('in-net').value = S.net;
    $('in-double').checked = S.doubleCount;
    $('in-seed').value = S.seed;
    $('hint-eps').textContent = `B succeeds ${((0.5 + S.eps) * 100).toFixed(1).replace(/\.0$/, '')}% of the time.`;
    for (const side of sides) side.select.value = side.mode;
  }
  function clearScenario() { document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); }
  for (const [id, key, steps] of RAIL) $(id).addEventListener('input', () => { S[key] = steps ? steps[+$(id).value] : +$(id).value; clearScenario(); sync(); rebuild(); });
  $('in-net').addEventListener('change', () => { S.net = $('in-net').value; clearScenario(); rebuild(); });
  $('in-double').addEventListener('change', () => { S.doubleCount = $('in-double').checked; restart(); });
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); sync(); rebuild(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); sync(); rebuild(); });
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    S.scale = b.dataset.scale;
    document.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    T.invalidate();
  }));
  const SCENARIOS = {
    selective: { s: { K: 20, net: 'cycle', eps: 0.05, n: 10, listen: 0.5, seed: 1 }, a: 'none', b: 'selective', note: 'Same scientists, same results. The propagandist only forwards real findings, yet the public ends up sure of the wrong answer.' },
    funded: { s: { K: 10, net: 'complete', eps: 0.05, n: 10, listen: 0.5, resources: 50, studyN: 2, seed: 1 }, a: 'none', b: 'production', note: 'The propagandist runs 25 honest two-trial studies a round and publishes the ones that went its way.' },
    power: { s: { K: 10, net: 'complete', eps: 0.05, n: 100, listen: 0.9, seed: 1 }, a: 'none', b: 'selective', note: 'With 100 trials per study, results that favour A are rare: the propagandist has little to work with.' },
    fair: { s: { K: 10, net: 'complete', eps: 0.1, n: 10, listen: 0.5, seed: 1 }, a: 'all', b: 'fair', note: 'Two honest journalists. Balancing every result for B with one for A slows the public down.' },
  };
  document.querySelectorAll('[data-scenario]').forEach((chip) => chip.addEventListener('click', () => {
    const sc = SCENARIOS[chip.dataset.scenario];
    Object.assign(S, sc.s);
    sides[0].mode = sc.a;
    sides[1].mode = sc.b;
    clearScenario();
    chip.setAttribute('aria-pressed', 'true');
    $('find-note').textContent = sc.note;
    sync();
    rebuild();
  }));

  let T = null;
  theme.read();
  T = LAB.transport({ speed: 3, step, restart, running, draw, drawSlow, animateUpTo: 8 });
  theme.onChange(() => T.invalidate());
  V.watchSize(sides.flatMap((s) => [s.net.cv, s.traj.cv, s.strip.cv]), () => T.invalidate());
  document.querySelector('[data-scenario="selective"]').setAttribute('aria-pressed', 'true');
  $('find-note').textContent = SCENARIOS.selective.note;
  sync();
  rebuild();
})();
