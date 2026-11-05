/* UI for biased.html: Holman & Bruner's intransigently biased agent. */
(function () {
  'use strict';

  const { biased: HB, networks: NETS, views: V, lab: LAB } = window.NET;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;
  const BIAS = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15];
  const NS = [50, 100, 250, 500, 1000, 5000];
  const S = { bias: 0.08, N: 1000, D: 6, rounds: 2000, seed: 1 };
  const NETWORKS = [['wheel', 'Static: wheel (company at hub)'], ['extra3', 'Static: wheel + 3 links'], ['extra6', 'Static: wheel + 6 links'], ['complete', 'Static: complete'], ['dynamic', 'Dynamic: doctors choose whom to trust']];
  const BLURB = {
    wheel: 'Every doctor hears the company and two colleagues, and counts every result in full.',
    extra3: 'Three more links between doctors: more honest results reach each of them.',
    extra6: 'Six more links between doctors.',
    complete: 'Every doctor hears every other doctor, and still hears the company in full.',
    dynamic: 'Doctors weigh each source by trust, and trust falls when a source’s results look statistically implausible.',
  };

  const panelsEl = $('panels');
  const sides = ['a', 'b'].map((key, idx) => {
    const el = document.createElement('article');
    el.className = 'panel';
    el.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <select id="net-${key}" aria-label="Panel ${idx + 1} network">${NETWORKS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <span class="pill running" id="status-${key}"><span class="dot"></span><span>Ready</span></span>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap"><canvas id="graph-${key}"></canvas></div>
      <dl class="readout">
        <div><dt>On better</dt><dd id="on-${key}">–</dd></div>
        <div><dt title="Share of doctor-rounds on the better drug since round 1,000">Late share</dt><dd id="late-${key}">–</dd></div>
        <div><dt title="Average weight doctors give the company’s results">Company weight</dt><dd id="trust-${key}">–</dd></div>
        <div><dt>Round</dt><dd id="round-${key}">–</dd></div>
      </dl>
      <div class="traj-title"><span>Each line is one doctor’s credence that the better drug is better</span></div>
      <div class="traj-wrap"><canvas id="traj-${key}"></canvas></div>
      <div class="strip-title"><span>Doctors prescribing the better drug each round</span></div>
      <div class="strip-wrap"><canvas id="strip-${key}"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, net: idx === 0 ? 'wheel' : 'dynamic',
      select: $('net-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      out: { on: $('on-' + key), late: $('late-' + key), trust: $('trust-' + key), round: $('round-' + key) },
      view: new V.NetView($('graph-' + key)), traj: new V.TrajView($('traj-' + key)), strip: new V.StripView($('strip-' + key)),
      run: null, trajHover: null,
    };
    side.tip = V.tooltip(side.view.cv.parentElement);
    side.select.addEventListener('change', () => { side.net = side.select.value; clearScenario(); restart(); });
    return side;
  });
  let hover = -1;

  function runOpts(side) {
    const n = side.net;
    return {
      D: S.D, N: S.N, bias: S.bias, rounds: S.rounds, seed: S.seed,
      network: n === 'dynamic' ? 'dynamic' : n === 'complete' ? 'complete' : n === 'wheel' ? 'wheel' : 'extra',
      extraLinks: n === 'extra3' ? 3 : n === 'extra6' ? 6 : 0,
    };
  }
  function positions(D) {
    const pts = [];
    for (let i = 0; i < D; i++) { const a = -Math.PI / 2 + (2 * Math.PI * i) / D; pts.push({ x: 0.5 + 0.4 * Math.cos(a), y: 0.5 + 0.4 * Math.sin(a) }); }
    pts.push({ x: 0.5, y: 0.5 });
    return pts;
  }
  function restart() {
    if (T) T.setPlaying(false);
    for (const side of sides) {
      side.run = HB.createRun(runOpts(side));
      const D = S.D, edges = [];
      if (side.run.dynamic) { for (let i = 0; i < D; i++) for (let j = i + 1; j <= D; j++) edges.push([i, j]); }
      else { side.run.adj.forEach((set, i) => set.forEach((j) => { if (j > i) edges.push([i, j]); })); for (let i = 0; i < D; i++) edges.push([i, D]); }
      side.view.setGraph(NETS.buildGraph(D + 1, edges), positions(D));
      side.blurb.textContent = BLURB[side.net];
    }
    readouts();
    if (T) T.invalidate();
  }
  const running = () => sides.some((s) => !s.run.done);
  function step() { for (const side of sides) if (!side.run.done) side.run.step(); readouts(); }

  function readouts() {
    let round = 0;
    for (const side of sides) {
      const run = side.run, D = S.D;
      const on = run.round ? run.betterHistory[run.betterHistory.length - 1] : null;
      side.out.on.textContent = on == null ? '–' : `${on} / ${D}`;
      side.out.late.textContent = run.lateRounds ? (run.onBetterLate / run.lateRounds).toFixed(2) : '–';
      let cw = 0;
      if (run.dynamic) for (let i = 0; i < D; i++) cw += run.weight(i, D);
      side.out.trust.textContent = run.dynamic ? (cw / D).toFixed(2) : 'full';
      side.out.round.textContent = run.round.toLocaleString();
      const late = run.lateRounds ? run.onBetterLate / run.lateRounds : null;
      let cls = 'running', label = run.round ? 'Running' : 'Ready';
      if (run.done) { cls = late > 0.5 ? 'correct' : 'incorrect'; label = `Done · better drug ${Math.round(100 * late)}% of late rounds`; }
      side.status.className = 'pill ' + cls;
      side.status.innerHTML = `<span class="dot"></span><span>${label}</span>`;
      round = Math.max(round, run.round);
    }
    $('round').textContent = round.toLocaleString();
  }

  function draw() {
    for (const side of sides) {
      const run = side.run, D = S.D;
      const fresh = run.round > 0;
      side.view.draw({
        value: (i) => (i < D ? run.credence(i) : 0),
        filled: (i) => (i < D ? (fresh ? run.drug[i] === HB.BETTER : run.prefers(i) === HB.BETTER) : true),
        shape: (i) => (i === D ? 'diamond' : 'circle'),
        size: (i) => (i === D ? 1.3 : 1),
        color: (i) => (i === D ? theme.T.bad : null),
        edgeWeight: (i, j) => {
          const hi = Math.max(i, j), lo = Math.min(i, j);
          if (!run.dynamic) return hi === D ? -0.7 : 1;
          if (hi === D) return -Math.min(1, run.weight(lo, D) * (D + 1));
          return Math.min(1, ((run.weight(i, j) + run.weight(j, i)) / 2) * (D + 1));
        },
        focus: hover,
      });
    }
    return false;
  }
  const xMax = () => Math.max(20, ...sides.map((s) => s.run.round));
  function trajOpts(side) {
    return { history: side.run.history, xMax: xMax(), scale: 'credence', focus: hover < S.D ? hover : -1, hoverRound: side.trajHover, refs: [{ v: 0.5, label: 'prefers the better drug above 0.5' }] };
  }
  function drawSlow() {
    for (const side of sides) {
      side.traj.draw(trajOpts(side));
      side.strip.draw({ tested: [0].concat(side.run.betterHistory), explorers: null, trap: [0].concat(side.run.betterHistory).map((v, r) => r > 0 && v === 0), N: S.D, xMax: xMax(), hoverRound: side.trajHover });
    }
  }

  for (const side of sides) {
    side.view.cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.view.hit(ev);
      if (i !== hover) { hover = i; T.invalidate(); }
      if (i < 0) return side.tip.hide();
      const run = side.run, D = S.D;
      if (i === D) return side.tip.show(`<div class="t-head">The company</div><div class="t-row"><span>Always prescribes</span><span>its own drug</span></div><div class="t-row"><span>Reports success rate</span><span>${(run.probs[0] + run.bias).toFixed(3)} (true ${run.probs[0]})</span></div>`, x, y);
      let trust = '';
      if (run.dynamic) {
        const ws = Array.from({ length: D + 1 }, (_, j) => [j, run.weight(i, j)]).sort((p, q) => q[1] - p[1]);
        trust = ws.slice(0, 3).map(([j, w]) => `<div class="t-row"><span>Weighs ${j === D ? 'the company' : j === i ? 'itself' : 'doctor ' + (j + 1)}</span><span>${Math.round(100 * w)}%</span></div>`).join('');
      }
      side.tip.show(`<div class="t-head">Doctor ${i + 1}</div>
        <div class="t-row"><span>Better drug (true ${run.probs[1]})</span><span>${run.mean(i, 1).toFixed(4)}</span></div>
        <div class="t-row"><span>Company’s drug (true ${run.probs[0]})</span><span>${run.mean(i, 0).toFixed(4)}</span></div>${trust}`, x, y);
    });
    side.view.cv.addEventListener('pointerleave', () => { hover = -1; side.tip.hide(); T.invalidate(); });
    side.traj.cv.addEventListener('pointermove', (ev) => {
      const { round, agent, x, y } = side.traj.pick(ev, trajOpts(side));
      side.trajHover = round;
      hover = agent;
      const h = side.run.history[round];
      side.tip.hide();
      let html = `<div class="t-head">Round ${round.toLocaleString()}</div><div class="t-row"><span>On better drug</span><span>${round ? side.run.betterHistory[round - 1] : '–'} / ${S.D}</span></div>`;
      if (agent >= 0) html += `<div class="t-row"><span>Doctor ${agent + 1}</span><span>${h[agent].toFixed(3)}</span></div>`;
      if (!side.tipT) side.tipT = V.tooltip(side.traj.cv.parentElement);
      side.tipT.show(html, x, y);
      T.invalidate();
    });
    side.traj.cv.addEventListener('pointerleave', () => { side.trajHover = null; hover = -1; if (side.tipT) side.tipT.hide(); T.invalidate(); });
  }

  const RAIL = [['in-bias', 'bias', BIAS], ['in-N', 'N', NS]];
  function sync() {
    for (const [id, key, steps] of RAIL) { $(id).value = Math.max(0, steps.indexOf(S[key])); $('out-' + id.slice(3)).textContent = S[key].toLocaleString(); }
    $('hint-bias').textContent = `The company’s drug really works ${(50).toFixed(0)}% of the time; it reports ${((0.5 + S.bias) * 100).toFixed(0)}%. The better drug works 51%.`;
    $('in-seed').value = S.seed;
    for (const side of sides) side.select.value = side.net;
  }
  function clearScenario() { document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); }
  for (const [id, key, steps] of RAIL) $(id).addEventListener('input', () => { S[key] = steps[+$(id).value]; clearScenario(); sync(); restart(); });
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); restart(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); sync(); restart(); });
  const SCENARIOS = {
    trust: { s: { bias: 0.08, N: 1000 }, a: 'wheel', b: 'dynamic', note: 'Bias 0.08. On the static wheel the company’s results always count, and the doctors drift onto its drug. With dynamic trust they soon find its results implausible and stop listening.' },
    links: { s: { bias: 0.03, N: 5000 }, a: 'wheel', b: 'complete', note: 'Bias 0.03, the paper’s Fig. 2 setting. Every doctor is a debunker for whoever hears them, so more links help, the reverse of the Zollman effect.' },
    subtle: { s: { bias: 0.02, N: 100 }, a: 'complete', b: 'dynamic', note: 'A small bias and small studies: the company’s results look plausible, and even trust-learning doctors keep listening.' },
  };
  document.querySelectorAll('[data-scenario]').forEach((chip) => chip.addEventListener('click', () => {
    const sc = SCENARIOS[chip.dataset.scenario];
    Object.assign(S, sc.s);
    sides[0].net = sc.a;
    sides[1].net = sc.b;
    clearScenario();
    chip.setAttribute('aria-pressed', 'true');
    $('note').textContent = sc.note;
    sync();
    restart();
  }));

  let T = null;
  theme.read();
  T = LAB.transport({ speeds: [2, 5, 10, 30, 100, 300, Infinity], speed: 4, step, restart, running, draw, drawSlow, animateUpTo: 0 });
  theme.onChange(() => T.invalidate());
  V.watchSize(sides.flatMap((s) => [s.view.cv, s.traj.cv, s.strip.cv]), () => T.invalidate());
  document.querySelector('[data-scenario="trust"]').setAttribute('aria-pressed', 'true');
  $('note').textContent = SCENARIOS.trust.note;
  sync();
  restart();
})();
