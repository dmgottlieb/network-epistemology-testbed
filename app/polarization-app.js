/* UI for polarization.html: two coupled runs of O'Connor & Weatherall's model. */
(function () {
  'use strict';

  const { rng, networks: NETS, polarization: P, polarizationSweep: SW, charts: CH, views: V } = window.NET;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;

  const EPS_STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
  const N_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const SPEEDS = [1, 2, 4, 8, 15, 30, 60, Infinity];
  const MAX_ROUNDS = 20000;

  const S = { N: 10, eps: 0.05, n: 20, lo: 0, hi: 1, seed: 9, speed: 1, scale: 'credence', animate: true, rule: 'ignore', order: 'sequential', playing: false };

  // ------------------------------------------------------------ panels
  const panelsEl = $('panels');
  const sides = ['a', 'b'].map((key, idx) => {
    const el = document.createElement('article');
    el.className = 'panel';
    el.setAttribute('aria-label', `Community ${idx + 1}`);
    el.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <select id="net-${key}" aria-label="Community ${idx + 1} network"></select>
          <span class="pill running" id="status-${key}" aria-live="polite"><span class="dot"></span><span>Running</span></span>
        </div>
        <div class="panel-controls">
          <div class="field">
            <div class="field-top"><label for="m-${key}">Mistrust, m</label><output id="out-m-${key}" for="m-${key}"></output></div>
            <input type="range" id="m-${key}" min="0" max="3" step="0.1">
          </div>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap"><canvas id="graph-${key}" aria-label="Community ${idx + 1} network diagram"></canvas></div>
      <dl class="readout">
        <div><dt>Testing B</dt><dd id="testing-${key}">–</dd></div>
        <div><dt>Mean credence</dt><dd id="mean-${key}">–</dd></div>
        <div><dt title="Doubters who currently discount every B-tester they hear from">Unreachable</dt><dd id="reach-${key}">–</dd></div>
        <div><dt>Settled</dt><dd id="settled-${key}">–</dd></div>
      </dl>
      <div class="traj-title"><span>Each line is one agent’s credence that B is better</span></div>
      <div class="traj-wrap"><canvas id="traj-${key}" aria-label="Community ${idx + 1} belief trajectories"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, type: 'complete', m: idx === 0 ? 0 : 1.5,
      select: $('net-' + key), mInput: $('m-' + key), mOut: $('out-m-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      outTesting: $('testing-' + key), outMean: $('mean-' + key), outReach: $('reach-' + key), outSettled: $('settled-' + key),
      net: new V.NetView($('graph-' + key)), traj: new V.TrajView($('traj-' + key)),
      graph: null, run: null, prev: null, cur: null, tested: null, animT0: 0, animDur: 0, particles: [], trajHover: null,
    };
    side.tipNet = V.tooltip(side.net.cv.parentElement);
    side.tipTraj = V.tooltip(side.traj.cv.parentElement);
    for (const [type, def] of Object.entries(NETS.TYPES)) {
      const o = document.createElement('option');
      o.value = type;
      o.textContent = def.label;
      side.select.appendChild(o);
    }
    side.select.addEventListener('change', () => { side.type = side.select.value; clearScenario(); rebuild(); });
    side.mInput.addEventListener('input', () => { side.m = +side.mInput.value; clearScenario(); syncOutputs(); restart(); });
    return side;
  });

  let hoverAgent = -1, pinnedAgent = -1;
  const focusAgent = () => (hoverAgent >= 0 ? hoverAgent : pinnedAgent);
  let dirty = true, trajDirty = true;

  function blurb(side) {
    const m = side.m;
    if (m === 0) return 'Full trust: everyone updates on every result. This is the Zollman model.';
    if (m <= 1) return `Trust falls with disagreement but never reaches zero (a gap of 1 would be needed). Polarization is impossible.`;
    const gap = (1 / m).toFixed(2);
    return `Results from anyone whose credence differs by ${gap} or more are ${S.rule === 'anti' ? 'held against them' : 'ignored'}.`;
  }

  function rebuild() {
    for (const side of sides) {
      side.graph = NETS.make(side.type, S.N, NETS.defaultParams(side.type), S.seed);
      side.net.setGraph(side.graph, NETS.layout(side.graph));
    }
    restart();
  }

  function restart() {
    setPlaying(false);
    for (const side of sides) {
      side.run = P.createRun({
        graph: side.graph, eps: S.eps, n: S.n, m: side.m, anti: S.rule === 'anti', order: S.order, seed: S.seed,
        priorLo: Math.min(S.lo, S.hi), priorHi: Math.max(S.lo, S.hi), maxRounds: MAX_ROUNDS,
      });
      side.prev = side.cur = side.run.history[0];
      side.tested = null;
      side.particles = [];
      side.animDur = 0;
      side.blurb.textContent = blurb(side);
    }
    updateReadouts();
    dirty = trajDirty = true;
  }

  const anyRunning = () => sides.some((s) => s.run.status === 'running');

  function stepAll(animate, dur) {
    const now = performance.now();
    for (const side of sides) {
      const run = side.run;
      if (run.status !== 'running') continue;
      const N = run.graph.n;
      const before = run.history[run.history.length - 1];
      run.step();
      side.prev = before;
      side.cur = run.history[run.history.length - 1];
      side.tested = Uint8Array.from(run.lastK, (k) => (k >= 0 ? 1 : 0));
      side.particles = [];
      side.animDur = 0;
      if (animate) {
        side.animT0 = now;
        side.animDur = dur;
        const { adj } = run.graph;
        for (let j = 0; j < N && side.particles.length < 6400; j++) {
          const k = run.lastK[j];
          if (k < 0) continue;
          const sign = Math.sign(2 * k - run.n);
          for (const i of adj[j]) {
            // how much i trusted j's report, judged from start-of-round beliefs
            const w = P.trust(Math.abs(before[i] - before[j]), run.m, run.anti);
            side.particles.push(j, i, sign, w);
          }
        }
      }
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

  const STATUS = {
    running: ['running', 'Running'],
    correct: ['correct', '✓ Right consensus'],
    incorrect: ['incorrect', '✕ Wrong consensus'],
    polarized: ['timeout', '⇹ Polarized'],
    timeout: ['timeout', 'Unsettled at cap'],
  };

  function outOfReach(side) {
    const c = side.cur, run = side.run, { adj } = side.graph;
    if (run.m <= 0) return 0;
    let count = 0;
    for (let i = 0; i < c.length; i++) {
      if (c[i] > 0.5) continue;
      let reachable = false;
      for (const j of adj[i]) if (c[j] > 0.5 && Math.abs(c[i] - c[j]) * run.m < 1) { reachable = true; break; }
      if (!reachable && adj[i].some((j) => c[j] > 0.5)) count++;
    }
    return count;
  }

  function updateReadouts() {
    let maxRound = 0;
    for (const side of sides) {
      const run = side.run;
      const N = run.graph.n;
      let testing = 0, sum = 0;
      for (let i = 0; i < N; i++) { sum += side.cur[i]; if (side.cur[i] > 0.5) testing++; }
      side.outTesting.textContent = `${testing} / ${N}`;
      side.outMean.textContent = (sum / N).toFixed(3);
      side.outReach.textContent = run.m > 1 ? `${outOfReach(side)} / ${N}` : '–';
      side.outSettled.textContent = run.status === 'running' ? '–' : `round ${run.round}`;
      const [cls, label] = STATUS[run.status];
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      side.status.title =
        run.status === 'polarized' ? 'Stable: the believers are above 0.99 and every doubter discounts them completely.' :
        run.status === 'incorrect' ? 'Everyone prefers A, so nobody will test B again.' :
        run.status === 'correct' ? 'Everyone is more than 99% sure that B is better.' : '';
      maxRound = Math.max(maxRound, run.round);
    }
    $('round').textContent = maxRound.toLocaleString();
  }

  // ------------------------------------------------------------ drawing
  function drawNet(side, now) {
    let p = 1;
    if (side.animDur) p = Math.max(0, Math.min(1, (now - side.animT0) / side.animDur));
    const inFlight = p < 1;
    const ep = V.ease(p);
    const prev = side.prev, cur = side.cur;
    const run = side.run;
    side.net.draw({
      value: (i) => (inFlight ? prev[i] + (cur[i] - prev[i]) * ep : cur[i]),
      filled: (i) => (inFlight && side.tested ? side.tested[i] === 1 : cur[i] > 0.5),
      edgeWeight: run.m > 0 ? (i, j) => {
        const ci = inFlight ? prev[i] + (cur[i] - prev[i]) * ep : cur[i];
        const cj = inFlight ? prev[j] + (cur[j] - prev[j]) * ep : cur[j];
        return P.trust(Math.abs(ci - cj), run.m, run.anti);
      } : null,
      particles: side.particles,
      progress: p,
      focus: focusAgent(),
    });
  }

  function trajOpts(side) {
    const m = side.run.m;
    const bands = m > 1 ? [{ from: 0, to: Math.max(0, 1 - 1 / m), label: `below ${(1 - 1 / m).toFixed(2)}: beyond reach of a consensus at 1` }] : [];
    return {
      history: side.run.history,
      xMax: Math.max(20, ...sides.map((s) => s.run.round)),
      scale: S.scale,
      focus: focusAgent(),
      hoverRound: side.trajHover,
      bands,
      refs: [{ v: 0.5, label: 'tests B above 0.5' }, { v: 0.99, label: 'consensus 0.99', color: theme.T.good, below: S.scale === 'credence' }],
    };
  }

  // ------------------------------------------------------------ hover
  function agentHTML(side, i) {
    const run = side.run, c = side.cur[i];
    const k = run.lastK[i];
    const last = run.round === 0 ? 'not started' : k >= 0 ? `B: ${k} / ${run.n} successes` : 'did A';
    let reach = '';
    if (run.m > 0) {
      const nb = side.graph.adj[i];
      const trusted = nb.filter((j) => P.trust(Math.abs(c - side.cur[j]), run.m, run.anti) > 0).length;
      reach = `<div class="t-row"><span>Trusts at all</span><span>${trusted} of ${nb.length} neighbours</span></div>`;
    }
    return `<div class="t-head">Agent ${i + 1}</div>
      <div class="t-row"><span>Credence in B</span><span>${c.toFixed(4)}</span></div>
      <div class="t-row"><span>Last round</span><span>${last}</span></div>${reach}`;
  }

  for (const side of sides) {
    const cv = side.net.cv;
    cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.net.hit(ev);
      if (i !== hoverAgent) { hoverAgent = i; dirty = trajDirty = true; }
      if (i >= 0) side.tipNet.show(agentHTML(side, i), x, y);
      else side.tipNet.hide();
    });
    cv.addEventListener('pointerleave', () => { hoverAgent = -1; side.tipNet.hide(); dirty = trajDirty = true; });
    cv.addEventListener('click', (ev) => { const { i } = side.net.hit(ev); pinnedAgent = i === pinnedAgent ? -1 : i; dirty = trajDirty = true; });
    const tc = side.traj.cv;
    tc.addEventListener('pointermove', (ev) => {
      const o = trajOpts(side);
      const { round, agent, x, y } = side.traj.pick(ev, o);
      side.trajHover = round;
      if (agent !== hoverAgent) { hoverAgent = agent; dirty = true; }
      const h = side.run.history[round];
      let testing = 0;
      for (let i = 0; i < h.length; i++) if (h[i] > 0.5) testing++;
      let html = `<div class="t-head">Round ${round}</div><div class="t-row"><span>Testing B next</span><span>${testing} / ${h.length}</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Agent ${agent + 1}</span><span>${h[agent].toFixed(4)}</span></div>`;
      side.tipTraj.show(html, x, y);
      trajDirty = true;
    });
    tc.addEventListener('pointerleave', () => { side.trajHover = null; hoverAgent = -1; side.tipTraj.hide(); dirty = trajDirty = true; });
  }

  // ------------------------------------------------------------ loop
  let lastTs = 0, lastTraj = 0;
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
        while (acc >= interval && k < 3) { acc -= interval; stepAll(S.animate && sp <= 15, Math.min(800, interval * 0.92)); k++; }
        if (k === 3) acc = 0;
      }
      if (!anyRunning()) setPlaying(false);
    }
    const animating = sides.some((s) => s.animDur && ts - s.animT0 < s.animDur);
    if (dirty || animating) { for (const s of sides) drawNet(s, ts); dirty = animating; }
    if (trajDirty && (!S.playing || ts - lastTraj > 45)) { for (const s of sides) s.traj.draw(trajOpts(s)); trajDirty = false; lastTraj = ts; }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ controls
  function syncOutputs() {
    $('in-N').value = S.N; $('out-N').textContent = S.N;
    $('in-eps').value = Math.max(0, EPS_STEPS.indexOf(S.eps)); $('out-eps').textContent = S.eps;
    const pct = (v) => (v * 100).toFixed(1).replace(/\.0$/, '') + '%';
    $('hint-eps').textContent = `B succeeds ${pct(0.5 + S.eps)} of the time; agents can’t rule out ${pct(0.5 - S.eps)}.`;
    $('in-n').value = Math.max(0, N_STEPS.indexOf(S.n)); $('out-n').textContent = S.n.toLocaleString();
    $('in-lo').value = S.lo; $('out-lo').textContent = S.lo.toFixed(2);
    $('in-hi').value = S.hi; $('out-hi').textContent = S.hi.toFixed(2);
    $('in-seed').value = S.seed;
    $('in-speed').value = S.speed;
    const sp = SPEEDS[S.speed];
    $('out-speed').textContent = isFinite(sp) ? `${sp} / s` : 'Max';
    for (const side of sides) {
      side.select.value = side.type;
      side.mInput.value = side.m;
      side.mOut.textContent = side.m.toFixed(1);
    }
    document.querySelectorAll('[data-rule]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rule === S.rule)));
    document.querySelectorAll('[data-order]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.order === S.order)));
    $('rule-hint').textContent = S.rule === 'anti'
      ? 'The paper’s Eq. 1: past the cutoff, a result pushes the listener the other way.'
      : 'The paper’s Eq. 2: past the cutoff, the result changes nothing.';
  }
  function clearScenario() {
    document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  }
  function bindRange(id, apply) {
    $(id).addEventListener('input', () => { apply(+$(id).value); clearScenario(); syncOutputs(); rebuild(); });
  }
  bindRange('in-N', (v) => (S.N = v));
  bindRange('in-eps', (v) => (S.eps = EPS_STEPS[v]));
  bindRange('in-n', (v) => (S.n = N_STEPS[v]));
  bindRange('in-lo', (v) => { S.lo = v; if (S.hi < v) S.hi = v; });
  bindRange('in-hi', (v) => { S.hi = v; if (S.lo > v) S.lo = v; });
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); setNote(''); syncOutputs(); rebuild(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); setNote(''); syncOutputs(); rebuild(); });
  $('in-speed').addEventListener('input', () => { S.speed = +$('in-speed').value; syncOutputs(); });
  $('in-anim').addEventListener('change', () => (S.animate = $('in-anim').checked));
  document.querySelectorAll('[data-rule]').forEach((b) => b.addEventListener('click', () => { S.rule = b.dataset.rule; clearScenario(); syncOutputs(); restart(); }));
  document.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => { S.order = b.dataset.order; clearScenario(); syncOutputs(); restart(); }));
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    S.scale = b.dataset.scale;
    document.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    trajDirty = true;
  }));
  $('btn-play').addEventListener('click', () => setPlaying(!S.playing));
  $('btn-step').addEventListener('click', () => { setPlaying(false); stepAll(S.animate, 600); });
  $('btn-reset').addEventListener('click', () => restart());
  document.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === ' ') { ev.preventDefault(); setPlaying(!S.playing); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); setPlaying(false); stepAll(S.animate, 600); }
    else if (ev.key === 'r' || ev.key === 'R') restart();
  });

  const SCENARIOS = {
    trust: { N: 10, eps: 0.05, n: 20, seed: 9, rule: 'ignore', a: ['complete', 0], b: ['complete', 1.5],
      note: 'Seed 9: with full trust the community agrees on B in 4 rounds. At m = 1.5 the same evidence leaves three agents permanently out of reach.' },
    mild: { N: 10, eps: 0.05, n: 20, seed: 36, rule: 'ignore', a: ['complete', 0], b: ['complete', 1],
      note: 'At m = 1 trust never reaches zero, so everyone is eventually convinced, but much more slowly (the paper’s Fig. 4).' },
    anti: { N: 10, eps: 0.05, n: 20, seed: 18, rule: 'anti', a: ['complete', 0], b: ['complete', 2],
      note: 'Held against them: past the cutoff, good news for B from a believer pushes a doubter further towards A.' },
    sparse: { N: 10, eps: 0.2, n: 50, seed: 60, rule: 'ignore', a: ['complete', 1.3], b: ['cycle', 1.3],
      note: 'Same mistrust, different network. On the cycle each doubter hears from only two people, and once those two are out of range nobody else can reach them.' },
    paper: { N: 10, eps: 0.2, n: 50, seed: 2, rule: 'ignore', a: ['complete', 0], b: ['complete', 2],
      note: 'The paper’s Fig. 2 setting: pB = .7, n = 50. Evidence is strong, so everything happens within a few rounds; use Step.' },
  };
  document.querySelectorAll('[data-scenario]').forEach((chip) => chip.addEventListener('click', () => {
    const sc = SCENARIOS[chip.dataset.scenario];
    Object.assign(S, { N: sc.N, eps: sc.eps, n: sc.n, lo: 0, hi: 1, seed: sc.seed, rule: sc.rule });
    [sides[0].type, sides[0].m] = sc.a;
    [sides[1].type, sides[1].m] = sc.b;
    clearScenario();
    chip.setAttribute('aria-pressed', 'true');
    setNote(sc.note);
    syncOutputs();
    rebuild();
  }));

  function setNote(t) { $('find-note').textContent = t; }
  const VERDICT = { correct: 'agrees on B', incorrect: 'settles on A', polarized: 'polarizes', timeout: 'stays unsettled' };
  let finding = null;
  $('btn-find').addEventListener('click', () => {
    if (finding) { finding.stop = true; return; }
    setPlaying(false);
    const btn = $('btn-find');
    const job = (finding = { seed: S.seed + 1, tried: 0, stop: false, limit: 3000 });
    btn.textContent = 'Stop searching';
    const lo = Math.min(S.lo, S.hi), hi = Math.max(S.lo, S.hi);
    const outcome = (side, seed) => {
      const g = NETS.make(side.type, S.N, NETS.defaultParams(side.type), seed);
      const run = P.createRun({ graph: g, eps: S.eps, n: S.n, m: side.m, anti: S.rule === 'anti', order: S.order, seed, priorLo: lo, priorHi: hi, maxRounds: MAX_ROUNDS, recordHistory: false });
      while (run.step());
      return run.status;
    };
    const done = (msg) => { finding = null; btn.textContent = 'Find a seed where they differ'; setNote(msg); };
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
          return done(`Seed ${seed}: the left community ${VERDICT[a]}, the right one ${VERDICT[b]}. Found after ${job.tried.toLocaleString()} ${job.tried === 1 ? 'try' : 'tries'}.`);
        }
      }
      if (job.stop) return done(`Stopped after ${job.tried.toLocaleString()} seeds.`);
      if (job.tried >= job.limit) return done(`No difference in ${job.limit.toLocaleString()} seeds with these settings.`);
      setNote(`Searching… ${job.tried.toLocaleString()} seeds tried`);
      setTimeout(tick, 0);
    })();
  });

  theme.read();
  theme.onChange(() => { dirty = trajDirty = true; });
  V.watchSize(sides.flatMap((s) => [s.net.cv, s.traj.cv]), () => { dirty = trajDirty = true; });
  document.querySelector('[data-scenario="trust"]').setAttribute('aria-pressed', 'true');
  setNote(SCENARIOS.trust.note);
  syncOutputs();
  rebuild();
  requestAnimationFrame(frame);

  // ================================================================ experiment
  const PRESETS = window.NET.polarizationPresets || {};
  const VARS = SW.VARIABLES;
  const METRICS = {
    polarized: { label: 'Share of runs ending polarized', sub: 'Stable polarization: believers above 0.99, every remaining doubter out of their reach.', prop: true },
    correct: { label: 'Share reaching the right consensus', sub: 'Everyone above 0.99.', prop: true },
    incorrect: { label: 'Share reaching the wrong consensus', sub: 'Everyone at or below 0.5, so nobody tests B again.', prop: true },
    leftBehind: { label: 'Share of agents not convinced of B at the end', sub: 'Averaged over runs: the fraction of agents not above 0.99 when the run ends.', prop: false },
    rounds: { label: 'Rounds to the right consensus', sub: 'Mean over runs that reached it. Log scale.', prop: false, log: true },
  };
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  const PRESET_NOTES = {
    fig2: 'pB = .7, n = 50, complete networks. Compare the paper’s Fig. 2: about 30% polarized at m = 1.2, 60% at 1.5 and 90% at 2.',
    fig3: 'K = 10, n = 20. Higher pB makes polarization rarer at moderate mistrust, as in the paper’s Fig. 3.',
    fig4: 'K = 6, pB = .55. Mild mistrust (m = 1) cannot polarize but slows consensus by a factor of 2 to 3 (Fig. 4).',
    order: 'Not in the paper. The same model with each agent judging distance from start-of-round beliefs polarizes far less at moderate m.',
    rule: 'Ignoring vs. anti-updating. Anti-updating leaves slightly more agents behind, as the paper reports.',
    networks: 'Not in the paper, which uses complete networks only. Sparse networks polarize more under the same mistrust.',
  };

  const presetsEl = $('exp-presets');
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.dataset.preset = key;
    b.textContent = p.title;
    b.addEventListener('click', () => { if (job) job.stop = true; showPreset(key); });
    presetsEl.appendChild(b);
  }
  for (const [type, def] of Object.entries(NETS.TYPES)) {
    const o = document.createElement('option');
    o.value = type;
    o.textContent = def.label;
    $('exp-network').appendChild(o);
  }

  function seriesLabel(by, s) {
    if (by === 'network') return NETS.TYPES[s] ? NETS.TYPES[s].label : s;
    if (by === 'order') return s === 'simultaneous' ? 'All at once' : 'One at a time';
    if (by === 'rule') return s === 'anti' ? 'Held against' : 'Ignored';
    return `${VARS[by].name} = ${s}`;
  }
  const fmtX = (vary) => (v) => (vary === 'n' && v >= 1000 ? v / 1000 + 'K' : String(v));

  function value(metric, a) {
    if (!a.runs) return null;
    if (metric === 'rounds') return a.correct ? a.roundsCorrect / a.correct : null;
    if (metric === 'leftBehind') return a.leftBehind / a.runs;
    return a[metric] / a.runs;
  }
  function wilson(k, n) {
    const z = 1.96, p = k / n, z2 = z * z;
    const c = (p + z2 / (2 * n)) / (1 + z2 / n);
    const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }

  let shown = null;
  function render(res) {
    shown = res;
    const metric = $('exp-metric').value;
    const M = METRICS[metric];
    $('chart-title').textContent = M.label;
    const fixedBits = [];
    const f = res.fixed;
    for (const k of ['N', 'eps', 'n', 'm']) if (k !== res.vary && k !== res.seriesBy) fixedBits.push(`${VARS[k].name} = ${f[k]}`);
    if (res.vary !== 'network' && res.seriesBy !== 'network') fixedBits.push(NETS.TYPES[f.network].label.toLowerCase());
    if (res.seriesBy !== 'order') fixedBits.push(f.order === 'simultaneous' ? 'all at once' : 'one at a time');
    if (res.seriesBy !== 'rule') fixedBits.push(f.rule === 'anti' ? 'held against' : 'ignored');
    $('chart-sub').textContent = `${M.sub} ${M.prop ? 'Bands are 95% intervals.' : ''} Fixed: ${fixedBits.join(', ')}.`;
    const series = res.series.map((s, i) => {
      const accs = res.acc[String(s)];
      const ys = accs.map((a) => value(metric, a));
      const out = { key: String(s), label: seriesLabel(res.seriesBy, s), color: COLORS[i % COLORS.length], ys, accs };
      if (M.prop) {
        const ci = accs.map((a) => (a.runs ? wilson(a[metric], a.runs) : [null, null]));
        out.lo = ci.map((c) => c[0]);
        out.hi = ci.map((c) => c[1]);
      }
      return out;
    });
    let domain = [0, 1];
    if (M.log) {
      const vals = series.flatMap((s) => s.ys.filter((v) => v != null && v > 0));
      const lo = vals.length ? Math.pow(10, Math.floor(Math.log10(Math.min(...vals)))) : 1;
      let hi = vals.length ? Math.pow(10, Math.ceil(Math.log10(Math.max(...vals)))) : 10;
      if (hi <= lo) hi = lo * 10;
      domain = [lo, hi];
    }
    const xNumeric = res.xs.every((x) => typeof x === 'number');
    const xLog = xNumeric && (res.vary === 'n' || res.vary === 'eps') && Math.min(...res.xs) > 0;
    CH.legend($('legend'), series);
    CH.lineChart($('chart'), {
      xs: res.xs, xLog, xFormat: fmtX(res.vary), xName: VARS[res.vary].name, xLabel: VARS[res.vary].label,
      yLog: !!M.log, yDomain: domain, yFormat: M.log ? undefined : (v) => v.toFixed(1), series, height: 300,
      ariaLabel: M.label,
      valueText: (s, i) => (metric === 'rounds' ? `${Math.round(s.ys[i]).toLocaleString()} rounds` : `${(100 * s.ys[i]).toFixed(1)}%`),
    });
    renderTable(res, series);
  }

  function renderTable(res, series) {
    let html = `<thead><tr><th>${VARS[res.vary].name}</th>`;
    for (const s of series) html += `<th><span class="th-sw" style="background:${s.color}"></span>${s.label}<br><span style="font-weight:400">right · polarized · wrong</span></th>`;
    html += '</tr></thead><tbody>';
    res.xs.forEach((x, i) => {
      html += `<tr><td>${fmtX(res.vary)(x)}</td>`;
      for (const s of series) {
        const a = s.accs[i];
        if (!a.runs) { html += '<td>–</td>'; continue; }
        const pc = (k) => Math.round((100 * a[k]) / a.runs) + '%';
        html += `<td>${pc('correct')} · ${pc('polarized')} · ${pc('incorrect')}${a.timeout ? ` <span class="r">${a.timeout} unsettled</span>` : ''}</td>`;
      }
      html += '</tr>';
    });
    $('exp-table').innerHTML = html + '</tbody>';
  }
  $('exp-metric').addEventListener('change', () => shown && render(shown));

  function applyConfig(cfg) {
    $('exp-vary').value = cfg.vary;
    $('exp-values').value = cfg.xs.join(', ');
    $('exp-series').value = cfg.seriesBy;
    $('exp-series-values').value = cfg.series.join(', ');
    for (const k of ['N', 'eps', 'n', 'm']) $('exp-' + k).value = cfg.fixed[k];
    $('exp-network').value = cfg.fixed.network;
    $('exp-order').value = cfg.fixed.order;
    $('exp-rule').value = cfg.fixed.rule;
    $('exp-runs').value = cfg.runs;
    $('exp-cap').value = cfg.cap;
    if (cfg.metric) $('exp-metric').value = cfg.metric;
  }
  function showPreset(key) {
    const p = PRESETS[key];
    applyConfig(p);
    render(p);
    presetsEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === key)));
    $('exp-preset-note').textContent = PRESET_NOTES[key] || '';
    $('exp-source').textContent = `Precomputed with this code: ${p.runs.toLocaleString()} runs per point. Press Run experiment to recompute.`;
    $('exp-progress').textContent = '';
    $('exp-fill').style.width = '0';
  }

  function parseList(text, kind) {
    const raw = text.split(/[\s,;]+/).filter(Boolean);
    if (kind === 'network') return raw.filter((t) => NETS.TYPES[t]);
    if (kind === 'order') return raw.filter((t) => t === 'sequential' || t === 'simultaneous');
    if (kind === 'rule') return raw.filter((t) => t === 'ignore' || t === 'anti');
    let v = raw.map(Number).filter((x) => isFinite(x) && x >= 0);
    if (kind === 'N') v = v.map(Math.round).filter((x) => x >= 2 && x <= 100);
    if (kind === 'n') v = v.map(Math.round).filter((x) => x >= 1 && x <= 10000);
    if (kind === 'eps') v = v.filter((x) => x > 0 && x < 0.5);
    if (kind === 'm') v = v.filter((x) => x <= 20);
    return Array.from(new Set(v)).sort((a, b) => a - b);
  }
  $('exp-series').addEventListener('change', () => {
    const k = $('exp-series').value;
    $('exp-series-values').value = { N: '6, 10, 20', m: '1.2, 1.5, 2', eps: '0.05, 0.2', n: '10, 50', network: 'complete, cycle', order: 'sequential, simultaneous', rule: 'ignore, anti' }[k];
  });
  $('exp-vary').addEventListener('change', () => {
    const k = $('exp-vary').value;
    $('exp-values').value = { m: '1, 1.25, 1.5, 2, 2.5, 3', N: '2, 4, 6, 10, 20', eps: '0.01, 0.05, 0.1, 0.2, 0.3', n: '1, 5, 10, 20, 50, 100' }[k];
  });

  let job = null;
  $('exp-run').addEventListener('click', () => {
    if (job) { job.stop = true; return; }
    const vary = $('exp-vary').value, seriesBy = $('exp-series').value;
    if (vary === seriesBy) { $('exp-progress').textContent = 'Choose different variables to vary and to compare.'; return; }
    const xs = parseList($('exp-values').value, vary);
    const series = parseList($('exp-series-values').value, seriesBy).slice(0, 8);
    if (!xs.length || !series.length) { $('exp-progress').textContent = 'Enter at least one valid value in each list.'; return; }
    const cfg = {
      vary, xs, seriesBy, series,
      fixed: {
        N: Math.max(2, Math.round(+$('exp-N').value || 10)), eps: Math.min(0.49, Math.max(0.001, +$('exp-eps').value || 0.2)),
        n: Math.max(1, Math.round(+$('exp-n').value || 50)), m: Math.max(0, +$('exp-m').value || 0),
        network: $('exp-network').value, order: $('exp-order').value, rule: $('exp-rule').value,
      },
      runs: Math.max(10, Math.round(+$('exp-runs').value || 500)),
      cap: Math.max(10, Math.round(+$('exp-cap').value || 20000)),
    };
    presetsEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    $('exp-preset-note').textContent = '';
    const sweep = SW.createSweep(cfg, rng.randomSeed());
    const res = Object.assign({}, cfg, { acc: sweep.acc });
    job = { sweep, res, stop: false, t0: performance.now(), last: 0 };
    $('exp-run').textContent = 'Stop';
    $('exp-source').textContent = 'Computing in your browser…';
    render(res);
    (function tick() {
      const finished = sweep.next(30);
      const now = performance.now();
      $('exp-fill').style.width = ((100 * sweep.done) / sweep.total).toFixed(1) + '%';
      if (finished || job.stop || now - job.last > 300) { render(res); job.last = now; }
      if (finished || job.stop) {
        $('exp-progress').textContent = job.stop
          ? `Stopped after ${sweep.done.toLocaleString()} of ${sweep.total.toLocaleString()} runs.`
          : `Done: ${sweep.total.toLocaleString()} runs in ${((now - job.t0) / 1000).toFixed(1)} s.`;
        $('exp-source').textContent = job.stop ? 'Partial results computed in your browser.' : `Computed in your browser: ${cfg.runs.toLocaleString()} runs per point.`;
        $('exp-run').textContent = 'Run experiment';
        job = null;
        return;
      }
      $('exp-progress').textContent = `Running… ${sweep.done.toLocaleString()} of ${sweep.total.toLocaleString()} runs`;
      setTimeout(tick, 0);
    })();
  });

  if (PRESETS.fig2) showPreset('fig2');
})();
