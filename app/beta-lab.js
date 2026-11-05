/*
 * Twin-panel lab shared by diversity.html (Zollman 2010) and
 * conformity.html (Weatherall & O'Connor), both built on models/beta-bandit.js.
 * The page sets window.BETA_PAGE before loading this script.
 */
(function () {
  'use strict';

  const { networks: NETS, betaBandit: BB, views: V, lab: LAB } = window.NET;
  const CFG = window.BETA_PAGE;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;
  const S = Object.assign({ scale: 'credence' }, CFG.defaults.shared);

  // ------------------------------------------------------------ panels
  const panelsEl = $('panels');
  const sides = ['a', 'b'].map((key, idx) => {
    const d = CFG.defaults[key];
    const P = CFG.panelParam;
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
            <div class="field-top"><label for="pp-${key}">${P.label}</label><output id="out-pp-${key}" for="pp-${key}"></output></div>
            <input type="range" id="pp-${key}" min="0" max="${P.steps.length - 1}" step="1">
          </div>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap"><canvas id="graph-${key}" aria-label="Network ${idx + 1} diagram"></canvas></div>
      <dl class="readout">
        <div><dt>On ${CFG.bestName}</dt><dd id="onbest-${key}">–</dd></div>
        <div><dt>Believe ${CFG.bestName}</dt><dd id="believe-${key}">–</dd></div>
        <div><dt title="Agents whose action differs from what they believe is best">${CFG.thirdLabel}</dt><dd id="third-${key}">–</dd></div>
        <div><dt>Round</dt><dd id="round-${key}">–</dd></div>
      </dl>
      <div class="traj-title"><span>Each line is one agent’s credence that ${CFG.bestName} is better</span></div>
      <div class="traj-wrap"><canvas id="traj-${key}"></canvas></div>
      <div class="strip-title"><span>Agents on ${CFG.bestName} each round${CFG.stripNote ? '; ' + CFG.stripNote : ''}</span></div>
      <div class="strip-wrap"><canvas id="strip-${key}"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, type: d.type, pp: d.value,
      select: $('net-' + key), ppInput: $('pp-' + key), ppOut: $('out-pp-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      out: { onbest: $('onbest-' + key), believe: $('believe-' + key), third: $('third-' + key), round: $('round-' + key) },
      net: new V.NetView($('graph-' + key)), traj: new V.TrajView($('traj-' + key)), strip: new V.StripView($('strip-' + key)),
      graph: null, run: null, againstHistory: [], trajHover: null,
    };
    side.tipNet = V.tooltip(side.net.cv.parentElement);
    side.tipTraj = V.tooltip(side.traj.cv.parentElement);
    for (const t of CFG.networks) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = CFG.networkLabels?.[t] || NETS.TYPES[t].label;
      side.select.appendChild(o);
    }
    side.select.addEventListener('change', () => { side.type = side.select.value; clearScenario(); rebuild(); });
    side.ppInput.addEventListener('input', () => { side.pp = P.steps[+side.ppInput.value]; clearScenario(); sync(); restart(); });
    return side;
  });

  let hover = -1, pinned = -1;
  const focus = () => (hover >= 0 ? hover : pinned);

  function netParams(type) { return Object.assign(NETS.defaultParams(type), CFG.networkParams?.[type] || {}); }
  function rebuild() {
    for (const side of sides) {
      side.graph = NETS.make(side.type, S.N, netParams(side.type), S.seed);
      side.net.setGraph(side.graph, NETS.layout(side.graph));
    }
    restart();
  }
  function restart() {
    if (T) T.setPlaying(false);
    for (const side of sides) {
      side.run = BB.createRun(Object.assign({ graph: side.graph, seed: S.seed, maxRounds: S.rounds }, CFG.runOptions(S, side.pp)));
      side.againstHistory = [0];
      side.blurb.textContent = CFG.blurb(side.pp, side.type);
    }
    readouts();
    if (T) T.invalidate();
  }
  const running = () => sides.some((s) => s.run.status === 'running');
  function step() {
    for (const side of sides) {
      const run = side.run;
      if (run.status !== 'running') continue;
      run.step();
      let against = 0;
      for (let i = 0; i < run.graph.n; i++) if (run.action[i] !== run.believed(i)) against++;
      side.againstHistory.push(against);
    }
    readouts();
  }

  function readouts() {
    let maxRound = 0;
    for (const side of sides) {
      const run = side.run;
      const N = run.graph.n;
      let onBest = 0, believe = 0, against = 0;
      for (let i = 0; i < N; i++) {
        const bel = run.believed(i);
        if (bel === run.best) believe++;
        if (run.round > 0) { if (run.action[i] === run.best) onBest++; if (run.action[i] !== bel) against++; }
      }
      side.out.onbest.textContent = run.round > 0 ? `${onBest} / ${N}` : '–';
      side.out.believe.textContent = `${believe} / ${N}`;
      side.out.third.textContent = run.round > 0 ? `${against} / ${N}` : '–';
      side.out.round.textContent = run.round.toLocaleString();
      const [cls, label, title] = CFG.status(run);
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      side.status.title = title || '';
      maxRound = Math.max(maxRound, run.round);
    }
    $('round').textContent = maxRound.toLocaleString();
  }

  function draw() {
    for (const side of sides) {
      const run = side.run;
      const fresh = run.round > 0;
      side.net.draw({
        value: (i) => run.credenceBest(i),
        filled: (i) => (fresh ? run.action[i] === run.best : run.believed(i) === run.best),
        mark: (i) => fresh && run.action[i] !== run.believed(i),
        focus: focus(),
      });
    }
    return false;
  }
  const xMax = () => Math.max(20, ...sides.map((s) => s.run.round));
  function trajOpts(side) {
    return { history: side.run.history, xMax: xMax(), scale: S.scale, focus: focus(), hoverRound: side.trajHover,
      refs: [{ v: 0.5, label: 'favours ' + CFG.bestName + ' above 0.5' }] };
  }
  function drawSlow() {
    for (const side of sides) {
      side.traj.draw(trajOpts(side));
      const run = side.run;
      side.strip.draw({
        tested: run.bestShareHistory.map((v, r) => (r === 0 ? 0 : v)),
        explorers: CFG.stripOverlay ? side.againstHistory : null,
        trap: run.bestShareHistory.map((v, r) => r > 0 && v === 0),
        N: run.graph.n, xMax: xMax(), hoverRound: side.trajHover,
      });
    }
  }

  // hover
  for (const side of sides) {
    side.net.cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.net.hit(ev);
      if (i !== hover) { hover = i; T.invalidate(); }
      if (i < 0) return side.tipNet.hide();
      const run = side.run;
      let rows = '';
      for (let j = run.M - 1; j >= 0; j--) {
        const q = i * run.M + j;
        rows += `<div class="t-row"><span>${CFG.armName(j, run.M)} (true ${run.probs[j]})</span><span>${run.mean(i, j).toFixed(4)} <span class="r">from ${(run.a[q] + run.b[q]).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span></div>`;
      }
      const act = run.round > 0 ? CFG.armName(run.action[i], run.M) : '–';
      side.tipNet.show(`<div class="t-head">Agent ${i + 1}</div>${rows}
        <div class="t-row"><span>Doing</span><span>${act}</span></div>
        <div class="t-row"><span>Believes best</span><span>${CFG.armName(run.believed(i), run.M)}</span></div>`, x, y);
    });
    side.net.cv.addEventListener('pointerleave', () => { hover = -1; side.tipNet.hide(); T.invalidate(); });
    side.net.cv.addEventListener('click', (ev) => { const { i } = side.net.hit(ev); pinned = i === pinned ? -1 : i; T.invalidate(); });
    side.traj.cv.addEventListener('pointermove', (ev) => {
      const { round, agent, x, y } = side.traj.pick(ev, trajOpts(side));
      side.trajHover = round;
      if (agent !== hover) hover = agent;
      const h = side.run.history[round];
      let html = `<div class="t-head">Round ${round.toLocaleString()}</div><div class="t-row"><span>On ${CFG.bestName}</span><span>${side.run.bestShareHistory[round]} / ${h.length}</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Agent ${agent + 1}</span><span>${h[agent].toFixed(4)}</span></div>`;
      side.tipTraj.show(html, x, y);
      T.invalidate();
    });
    side.traj.cv.addEventListener('pointerleave', () => { side.trajHover = null; hover = -1; side.tipTraj.hide(); T.invalidate(); });
  }

  // ------------------------------------------------------------ controls
  function sync() {
    for (const [id, key, steps, fmt] of CFG.rail) {
      const el = $(id);
      if (!el) continue;
      el.value = steps ? Math.max(0, steps.indexOf(S[key])) : S[key];
      const out = $('out-' + id.replace(/^in-/, ''));
      if (out) out.textContent = fmt ? fmt(S[key]) : S[key];
    }
    if ($('in-seed')) $('in-seed').value = S.seed;
    if (CFG.hint) CFG.hint(S);
    for (const side of sides) {
      side.select.value = side.type;
      side.ppInput.value = Math.max(0, CFG.panelParam.steps.indexOf(side.pp));
      side.ppOut.textContent = CFG.panelParam.format(side.pp);
    }
  }
  function clearScenario() { document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); }
  for (const [id, key, steps] of CFG.rail) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', () => { S[key] = steps ? steps[+el.value] : +el.value; clearScenario(); sync(); rebuild(); });
  }
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); setNote(''); sync(); rebuild(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); setNote(''); sync(); rebuild(); });
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    S.scale = b.dataset.scale;
    document.querySelectorAll('[data-scale]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    T.invalidate();
  }));
  document.querySelectorAll('[data-scenario]').forEach((chip) => chip.addEventListener('click', () => {
    const sc = CFG.scenarios[chip.dataset.scenario];
    Object.assign(S, sc.shared);
    [sides[0].type, sides[0].pp] = sc.a;
    [sides[1].type, sides[1].pp] = sc.b;
    clearScenario();
    chip.setAttribute('aria-pressed', 'true');
    setNote(sc.note);
    sync();
    rebuild();
  }));

  function setNote(t) { $('find-note').textContent = t; }
  let finding = null;
  $('btn-find').addEventListener('click', () => {
    if (finding) { finding.stop = true; return; }
    T.setPlaying(false);
    const btn = $('btn-find');
    const label = btn.textContent;
    const job = (finding = { seed: S.seed + 1, tried: 0, stop: false, limit: 400 });
    btn.textContent = 'Stop searching';
    const outcome = (side, seed) => {
      const g = NETS.make(side.type, S.N, netParams(side.type), seed);
      const run = BB.createRun(Object.assign({ graph: g, seed, maxRounds: S.rounds, recordHistory: false }, CFG.runOptions(S, side.pp)));
      while (run.step());
      return CFG.verdict(run);
    };
    const done = (msg) => { finding = null; btn.textContent = label; setNote(msg); };
    (function tick() {
      const t0 = performance.now();
      while (performance.now() - t0 < 40 && job.tried < job.limit && !job.stop) {
        const seed = job.seed++;
        job.tried++;
        const a = outcome(sides[0], seed), b = outcome(sides[1], seed);
        if (a !== b) {
          S.seed = seed;
          sync();
          rebuild();
          return done(`Seed ${seed}: left ${a}, right ${b}. Found after ${job.tried} ${job.tried === 1 ? 'try' : 'tries'}.`);
        }
      }
      if (job.stop) return done(`Stopped after ${job.tried} seeds.`);
      if (job.tried >= job.limit) return done(`No difference in ${job.limit} seeds with these settings.`);
      setNote(`Searching… ${job.tried} seeds tried`);
      setTimeout(tick, 0);
    })();
  });

  // ------------------------------------------------------------ boot
  let T = null;
  theme.read();
  T = LAB.transport({ speeds: [1, 2, 4, 8, 15, 30, 60, 250, Infinity], speed: CFG.defaults.speed ?? 6, step, restart, running, draw, drawSlow, animateUpTo: 0 });
  theme.onChange(() => T.invalidate());
  V.watchSize(sides.flatMap((s) => [s.net.cv, s.traj.cv, s.strip.cv]), () => T.invalidate());
  const first = document.querySelector('#scenarios .chip');
  if (first) first.setAttribute('aria-pressed', 'true');
  if (CFG.defaults.note) setNote(CFG.defaults.note);
  sync();
  rebuild();
})();
