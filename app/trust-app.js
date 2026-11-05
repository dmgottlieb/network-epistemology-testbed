/* UI for trust.html: self-assembling networks of trust (Barrett, Skyrms & Mohseni; Pozzi). */
(function () {
  'use strict';

  const { networks: NETS, trust: TR, views: V, lab: LAB, charts: CH } = window.NET;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;
  const S = { N: 20, turnover: 0, rounds: 100, problems: 100, seed: 1 };
  const VS = [0, 0.25, 0.5, 0.75, 1];

  const panelsEl = $('panels');
  const sides = ['a', 'b'].map((key, idx) => {
    const el = document.createElement('article');
    el.className = 'panel';
    el.innerHTML = `
      <div class="panel-head">
        <div class="row">
          <select id="sc-${key}" aria-label="Panel ${idx + 1} scenario"><option value="credulous">Credulous</option><option value="sceptical">Sceptical</option></select>
          <span class="pill running" id="status-${key}"><span class="dot"></span><span>Ready</span></span>
        </div>
        <div class="panel-controls">
          <div class="field">
            <div class="field-top"><label for="v-${key}">Vigilance, V</label><output id="out-v-${key}" for="v-${key}"></output></div>
            <input type="range" id="v-${key}" min="0" max="${VS.length - 1}" step="1">
          </div>
        </div>
        <p class="net-blurb" id="blurb-${key}"></p>
      </div>
      <div class="net-wrap"><canvas id="graph-${key}" aria-label="Who consults whom"></canvas></div>
      <dl class="readout">
        <div><dt>Problem</dt><dd id="prob-${key}">–</dd></div>
        <div><dt>Right now</dt><dd id="acc-${key}">–</dd></div>
        <div><dt title="Mean share of agents with the true belief over the last 20 rounds of the last finished problem">Last problem</dt><dd id="k-${key}">–</dd></div>
        <div><dt title="Average share of urns given to observing nature">Ask nature</dt><dd id="nat-${key}">–</dd></div>
      </dl>
      <div class="strip-title"><span>Agents with the true belief, this problem</span></div>
      <div class="strip-wrap"><canvas id="strip-${key}"></canvas></div>`;
    panelsEl.appendChild(el);
    const side = {
      key, scenario: 'credulous', V: idx === 0 ? 0 : 1,
      sc: $('sc-' + key), vIn: $('v-' + key), vOut: $('out-v-' + key), blurb: $('blurb-' + key), status: $('status-' + key),
      out: { prob: $('prob-' + key), acc: $('acc-' + key), k: $('k-' + key), nat: $('nat-' + key) },
      net: new V.NetView($('graph-' + key)), strip: new V.StripView($('strip-' + key)),
      run: null, pos: null,
    };
    side.tip = V.tooltip(side.net.cv.parentElement);
    side.sc.addEventListener('change', () => { side.scenario = side.sc.value; clearScenario(); restart(); });
    side.vIn.addEventListener('input', () => { side.V = VS[+side.vIn.value]; clearScenario(); sync(); restart(); });
    return side;
  });
  let hover = -1;

  function blurb(side) {
    const v = side.V;
    if (side.scenario === 'credulous') return v === 1 ? 'Reinforce a source only when it turned out right (Barrett, Skyrms & Mohseni’s rule).' : `Always reinforce a source that was right; reinforce one that was wrong ${Math.round(100 * (1 - v))}% of the time.`;
    return v === 1 ? 'Reinforce a source only when it turned out right (Barrett, Skyrms & Mohseni’s rule).' : `Never reinforce a source that was wrong; reinforce one that was right only ${Math.round(100 * v)}% of the time.`;
  }
  function positions(N) {
    const pts = [];
    for (let i = 0; i < N; i++) { const a = -Math.PI / 2 + (2 * Math.PI * i) / N; pts.push({ x: 0.5 + 0.42 * Math.cos(a), y: 0.5 + 0.42 * Math.sin(a) }); }
    pts.push({ x: 0.5, y: 0.5 }); // nature
    return pts;
  }
  function restart() {
    if (T) T.setPlaying(false);
    for (const side of sides) {
      side.run = TR.createRun({ N: S.N, scenario: side.scenario, V: side.V, turnover: S.turnover, rounds: S.rounds, problems: S.problems, seed: S.seed });
      side.pos = positions(S.N);
      side.net.setGraph(NETS.buildGraph(S.N + 1, []), side.pos);
      side.net.minD = Math.min(0.12, (2 * Math.PI * 0.42) / S.N);
      side.blurb.textContent = blurb(side);
      side.stripHist = [0];
    }
    readouts();
    if (T) T.invalidate();
  }
  const running = () => sides.some((s) => !s.run.done);
  function step() {
    for (const side of sides) {
      const run = side.run;
      if (run.done) continue;
      const before = run.problem;
      run.step();
      if (run.problem !== before) side.stripHist = [0];
      else side.stripHist.push(Math.round(run.accurateHistory[run.accurateHistory.length - 1] * S.N));
    }
    readouts();
  }
  // trust edges: each agent's sources with at least 12% of its urn
  function refreshEdges(side) {
    const run = side.run, N = S.N, edges = [];
    side.wt = new Map();
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= N; j++) {
        if (j === i) continue;
        const w = run.trust(i, j);
        if (w < 0.12) continue;
        const key = Math.min(i, j) * (N + 1) + Math.max(i, j);
        side.wt.set(key, Math.max(side.wt.get(key) || 0, w));
        edges.push([i, j]);
      }
    }
    side.net.graph = NETS.buildGraph(N + 1, edges);
  }
  function inTrust(side) {
    const run = side.run, N = S.N, s = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) for (let j = 0; j <= N; j++) if (j !== i) s[j] += run.trust(i, j);
    return s;
  }
  function readouts() {
    let round = 0;
    for (const side of sides) {
      const run = side.run, N = S.N;
      let acc = 0, nat = 0;
      for (let i = 0; i < N; i++) { acc += run.belief[i]; nat += run.trust(i, N); }
      side.out.prob.textContent = `${Math.min(run.P, run.problem + (run.done ? 0 : 1))} / ${run.P}`;
      side.out.acc.textContent = `${acc} / ${N}`;
      side.out.k.textContent = run.knowledge.length ? run.knowledge[run.knowledge.length - 1].toFixed(2) : '–';
      side.out.nat.textContent = Math.round((100 * nat) / N) + '%';
      const k = run.knowledge.length ? run.knowledge[run.knowledge.length - 1] : null;
      side.status.className = 'pill ' + (run.done ? (k > 0.6 ? 'correct' : 'timeout') : 'running');
      side.status.innerHTML = `<span class="dot"></span><span>${run.done ? `Done · knowledge ${k.toFixed(2)}` : run.problem === 0 && run.round === 0 ? 'Ready' : 'Running'}</span>`;
      round = Math.max(round, run.problem * run.R + run.round);
    }
    $('round').textContent = round.toLocaleString();
  }
  function draw() {
    for (const side of sides) {
      const run = side.run, N = S.N;
      refreshEdges(side);
      const inT = inTrust(side);
      const maxIn = Math.max(1, ...Array.from(inT).slice(0, N));
      side.net.draw({
        value: (i) => (i < N ? run.rel[i] : 1),
        filled: (i) => (i < N ? run.belief[i] === 1 : true),
        shape: (i) => (i === N ? 'diamond' : 'circle'),
        size: (i) => (i === N ? 1.4 : 0.75 + 0.9 * (inT[i] / maxIn)),
        color: (i) => (i === N ? theme.T.good : null),
        edgeWeight: (i, j) => Math.min(1, 0.15 + (side.wt.get(Math.min(i, j) * (N + 1) + Math.max(i, j)) || 0)),
        focus: hover,
      });
    }
    return false;
  }
  function drawSlow() {
    for (const side of sides) side.strip.draw({ tested: side.stripHist, explorers: null, trap: null, N: S.N, xMax: S.rounds });
    const series = sides.map((side, i) => ({ key: side.key, label: `${i ? 'Right' : 'Left'}: ${side.scenario}, V = ${side.V}`, color: i ? 'var(--s2)' : 'var(--s1)', ys: Array.from({ length: S.problems }, (_, p) => (p < side.run.knowledge.length ? side.run.knowledge[p] : null)) }));
    CH.legend($('kn-legend'), series);
    CH.lineChart($('kn-chart'), {
      xs: Array.from({ length: S.problems }, (_, p) => p + 1), xName: 'problem', xLabel: 'Problem', yDomain: [0, 1], yFormat: (v) => v.toFixed(1),
      series, height: 220, markers: false, ariaLabel: 'Collective knowledge per problem', valueText: (s, i) => (s.ys[i] == null ? '–' : s.ys[i].toFixed(2)),
    });
  }

  for (const side of sides) {
    side.net.cv.addEventListener('pointermove', (ev) => {
      const { i, x, y } = side.net.hit(ev);
      if (i !== hover) { hover = i; T.invalidate(); }
      if (i < 0) return side.tip.hide();
      const run = side.run, N = S.N;
      if (i === N) {
        let c = 0;
        for (let a = 0; a < N; a++) if (run.trust(a, N) >= 0.5) c++;
        return side.tip.show(`<div class="t-head">Nature</div><div class="t-row"><span>Agents who mostly observe it</span><span>${c}</span></div>`, x, y);
      }
      const srcs = [];
      for (let j = 0; j <= N; j++) srcs.push([j, run.trust(i, j)]);
      srcs.sort((p, q) => q[1] - p[1]);
      const name = (j) => (j === N ? 'nature' : j === i ? 'itself' : `agent ${j + 1} (r ${run.rel[j].toFixed(2)})`);
      side.tip.show(`<div class="t-head">Agent ${i + 1}</div>
        <div class="t-row"><span>Reliability</span><span>${run.rel[i].toFixed(2)}</span></div>
        <div class="t-row"><span>Belief now</span><span>${run.belief[i] ? 'true' : 'false'}</span></div>
        ${srcs.slice(0, 3).map(([j, w]) => `<div class="t-row"><span>Consults ${name(j)}</span><span>${Math.round(100 * w)}%</span></div>`).join('')}`, x, y);
    });
    side.net.cv.addEventListener('pointerleave', () => { hover = -1; side.tip.hide(); T.invalidate(); });
  }

  const RAIL = [['in-N', 'N'], ['in-turn', 'turnover', [0, 0.02, 0.05, 0.1, 0.2]], ['in-problems', 'problems', [10, 25, 50, 100, 200]], ['in-rounds', 'rounds', [20, 50, 100, 200]]];
  function sync() {
    for (const [id, key, steps] of RAIL) {
      $(id).value = steps ? Math.max(0, steps.indexOf(S[key])) : S[key];
      $('out-' + id.slice(3)).textContent = S[key];
    }
    $('in-seed').value = S.seed;
    for (const side of sides) { side.sc.value = side.scenario; side.vIn.value = VS.indexOf(side.V); side.vOut.textContent = side.V; }
  }
  function clearScenario() { document.querySelectorAll('#scenarios .chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); }
  for (const [id, key, steps] of RAIL) $(id).addEventListener('input', () => { S[key] = steps ? steps[+$(id).value] : +$(id).value; clearScenario(); sync(); restart(); });
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); restart(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); sync(); restart(); });
  const SCENARIOS = {
    credulous: { s: { N: 20, turnover: 0 }, a: ['credulous', 0], b: ['credulous', 1], note: 'Left: agents who reinforce whoever they asked. Right: agents who reinforce only sources that were right. Watch the right panel’s trust converge on its reliable members.' },
    sceptical: { s: { N: 20, turnover: 0 }, a: ['sceptical', 0], b: ['sceptical', 1], note: 'Sceptics who never credit others fall back on themselves and nature; full vigilance lets them learn from the reliable.' },
    turnover: { s: { N: 20, turnover: 0.05 }, a: ['sceptical', 0.5], b: ['sceptical', 1], note: 'With turnover, earned trust can outlive the person who earned it.' },
  };
  document.querySelectorAll('[data-scenario]').forEach((chip) => chip.addEventListener('click', () => {
    const sc = SCENARIOS[chip.dataset.scenario];
    Object.assign(S, sc.s);
    [sides[0].scenario, sides[0].V] = sc.a;
    [sides[1].scenario, sides[1].V] = sc.b;
    clearScenario();
    chip.setAttribute('aria-pressed', 'true');
    $('note').textContent = sc.note;
    sync();
    restart();
  }));

  let T = null;
  theme.read();
  T = LAB.transport({ speeds: [2, 5, 10, 30, 100, 300, 1000, Infinity], speed: 4, step, restart, running, draw, drawSlow, animateUpTo: 0 });
  theme.onChange(() => T.invalidate());
  V.watchSize(sides.flatMap((s) => [s.net.cv, s.strip.cv]), () => T.invalidate());
  document.querySelector('[data-scenario="credulous"]').setAttribute('aria-pressed', 'true');
  $('note').textContent = SCENARIOS.credulous.note;
  sync();
  restart();
})();
