/* UI for freerider.html: Kummerfeld & Zollman's Choose-Your-epsilon game. */
(function () {
  'use strict';

  const { rng, networks: NETS, kz: KZ, views: V, lab: LAB, charts: CH } = window.NET;
  const D = window.NET.freeriderPresets;
  const $ = (id) => document.getElementById(id);
  const theme = V.theme;
  const S = { N: 8, net: 'complete', epsG: 0.18, epsH: 0.05, seed: 1 };

  // ------------------------------------------------------------ one episode
  const view = new V.NetView($('graph'));
  const traj = new V.TrajView($('traj'));
  const tip = V.tooltip(view.cv.parentElement);
  let graph = null, ep = null, hist = [], hover = -1;
  const favour = (i) => { const e = ep.estimate(i); return e == null ? 0.75 : 1 / (1 + Math.exp(-1.2 * e)); };

  function rebuild() {
    graph = NETS.make(S.net, S.N);
    view.setGraph(graph, NETS.layout(graph));
    restart();
  }
  function restart() {
    if (T) T.setPlaying(false);
    const noise = KZ.makeNoise(S.N, 50, rng.mulberry32(rng.mix(S.seed, S.N, 0x667265)));
    ep = KZ.createEpisode(graph, (i) => (i === 0 ? S.epsH : S.epsG), noise);
    hist = [Float32Array.from({ length: S.N }, (_, i) => favour(i))];
    readouts();
    if (T) T.invalidate();
  }
  const running = () => !ep.done();
  function step() {
    if (!ep.step()) return;
    hist.push(Float32Array.from({ length: S.N }, (_, i) => favour(i)));
    readouts();
  }
  function readouts() {
    const r = Math.max(1, ep.round);
    let g = 0, ge = 0;
    for (let i = 1; i < S.N; i++) { g += ep.payoff[i]; ge += 0; }
    $('o-round').textContent = `${ep.round} / 50`;
    $('o-hero').textContent = ep.round ? (ep.payoff[0] / r).toFixed(2) : '–';
    $('o-group').textContent = ep.round ? (g / (S.N - 1) / r).toFixed(2) : '–';
    $('o-risky').textContent = ep.round ? `${ep.pulls[0]} vs ${(Array.from(ep.pulls).slice(1).reduce((s, v) => s + v, 0) / (S.N - 1)).toFixed(1)}` : '–';
    $('round').textContent = ep.round;
  }
  function draw() {
    const fresh = ep.round > 0;
    view.draw({
      value: (i) => favour(i),
      filled: (i) => (fresh ? ep.risky[i] === 1 : true),
      mark: (i) => fresh && ep.explored[i] === 1,
      shape: (i) => (i === 0 ? 'diamond' : 'circle'),
      size: (i) => (i === 0 ? 1.15 : 1),
      focus: hover,
    });
    return false;
  }
  function drawSlow() {
    traj.draw({ history: hist, xMax: 50, scale: 'credence', focus: hover,
      refs: [{ v: 0.5, label: 'favours risky above 0.5' }] });
  }
  view.cv.addEventListener('pointermove', (ev) => {
    const { i, x, y } = view.hit(ev);
    if (i !== hover) { hover = i; T.invalidate(); }
    if (i < 0) return tip.hide();
    const e = ep.estimate(i);
    tip.show(`<div class="t-head">${i === 0 ? 'The hero' : 'Scientist ' + (i + 1)}</div>
      <div class="t-row"><span>Exploration rate</span><span>${i === 0 ? S.epsH : S.epsG}</span></div>
      <div class="t-row"><span>Risky arm, average seen</span><span>${e == null ? 'no data' : e.toFixed(2)} <span class="r">from ${ep.cnt[i]}</span></span></div>
      <div class="t-row"><span>Payoff so far</span><span>${ep.payoff[i].toFixed(1)}</span></div>`, x, y);
  });
  view.cv.addEventListener('pointerleave', () => { hover = -1; tip.hide(); T.invalidate(); });

  function sync() {
    $('in-N').value = S.N; $('out-N').textContent = S.N;
    $('in-epsG').value = S.epsG; $('out-epsG').textContent = S.epsG.toFixed(2);
    $('in-epsH').value = S.epsH; $('out-epsH').textContent = S.epsH.toFixed(2);
    $('in-net').value = S.net;
    $('in-seed').value = S.seed;
  }
  $('in-N').addEventListener('input', () => { S.N = +$('in-N').value; sync(); rebuild(); });
  $('in-epsG').addEventListener('input', () => { S.epsG = +$('in-epsG').value; sync(); restart(); });
  $('in-epsH').addEventListener('input', () => { S.epsH = +$('in-epsH').value; sync(); restart(); });
  $('in-net').addEventListener('change', () => { S.net = $('in-net').value; rebuild(); });
  $('in-seed').addEventListener('change', () => { S.seed = Math.max(0, Math.floor(+$('in-seed').value || 0)); restart(); });
  $('btn-reseed').addEventListener('click', () => { S.seed = Math.floor(Math.random() * 100000); sync(); restart(); });

  // many episodes: hero vs. the average other scientist
  let batch = null;
  $('btn-many').addEventListener('click', () => {
    if (batch) { batch.stop = true; return; }
    const g = NETS.make(S.net, S.N);
    const rand = rng.mulberry32(rng.randomSeed());
    batch = { stop: false, n: 0, h: 0, h2: 0, o: 0, d: 0, d2: 0, target: 4000 };
    $('btn-many').textContent = 'Stop';
    (function tick() {
      const t0 = performance.now();
      while (performance.now() - t0 < 30 && batch.n < batch.target && !batch.stop) {
        const pulls = KZ.playWithNoise(g, (i) => (i === 0 ? S.epsH : S.epsG), KZ.makeNoise(S.N, 50, rand), KZ.DEFAULTS);
        const h = pulls[0] / 50;
        let o = 0;
        for (let i = 1; i < S.N; i++) o += pulls[i] / 50;
        o /= S.N - 1;
        batch.n++; batch.h += h; batch.o += o; batch.d += h - o; batch.d2 += (h - o) ** 2;
      }
      const n = batch.n, mh = batch.h / n, mo = batch.o / n, md = batch.d / n;
      const se = Math.sqrt(Math.max(0, batch.d2 / n - md * md) / n);
      $('many-out').innerHTML = `
        <div class="stat"><div class="k">The hero (ε = ${S.epsH})</div><div class="v">${mh.toFixed(3)}</div><div class="d">expected payoff per pull</div></div>
        <div class="stat"><div class="k">Each other scientist (ε = ${S.epsG})</div><div class="v">${mo.toFixed(3)}</div><div class="d">expected payoff per pull</div></div>
        <div class="stat"><div class="k">Hero’s advantage</div><div class="v">${md >= 0 ? '+' : '−'}${Math.abs(md).toFixed(3)}</div><div class="d">± ${(1.96 * se).toFixed(3)} (95%), ${n.toLocaleString()} episodes</div></div>`;
      if (batch.stop || n >= batch.target) { batch = null; $('btn-many').textContent = 'Run 4,000 episodes'; return; }
      setTimeout(tick, 0);
    })();
  });

  let T = null;
  theme.read();
  T = LAB.transport({ speeds: [1, 2, 4, 8, 15, 30, 60, Infinity], speed: 3, step, restart, running, draw, drawSlow, animateUpTo: 0 });
  theme.onChange(() => T.invalidate());
  V.watchSize([view.cv, traj.cv], () => T.invalidate());
  sync();
  rebuild();

  // ------------------------------------------------------------ charts from precomputed data
  if (!D) return;
  const COLORS = { 2: 'var(--s4)', 4: 'var(--s3)', 6: 'var(--s2)', 8: 'var(--s1)' };
  const sizes = Object.keys(D.sizes).map(Number);
  function nash(eg, br) {
    for (let i = 0; i < eg.length - 1; i++) {
      const d0 = br[i] - eg[i], d1 = br[i + 1] - eg[i + 1];
      if (d0 >= 0 && d1 < 0) return eg[i] + (d0 / (d0 - d1)) * (eg[i + 1] - eg[i]);
    }
    return null;
  }
  function optimum(xs, ys) {
    let k = 0;
    ys.forEach((y, i) => { if (y > ys[k]) k = i; });
    return KZ.bestResponse(xs, ys);
  }
  let brNet = 'complete';
  function drawBR() {
    const series = sizes.filter((N) => D.sizes[N][brNet] || (brNet === 'cycle' && N === 2)).map((N) => {
      const d = D.sizes[N][brNet] || D.sizes[N].complete;
      return { key: String(N), label: `${N} scientists`, color: COLORS[N], ys: d.br };
    });
    series.push({ key: 'xy', label: 'Hero matches the group (x = y)', color: 'var(--muted)', ys: D.eg.slice(), dash: true });
    CH.legend($('br-legend'), series);
    CH.lineChart($('br-chart'), {
      xs: D.eg, xFormat: (v) => v.toFixed(2), xName: 'group ε', xLabel: 'Exploration rate everyone else uses',
      yDomain: [0, 0.4], yFormat: (v) => v.toFixed(1), series, height: 300, markers: true,
      ariaLabel: 'Best response', valueText: (s, i) => (s.key === 'xy' ? s.ys[i].toFixed(2) : `hero’s best ε ${s.ys[i].toFixed(2)}`),
    });
  }
  document.querySelectorAll('[data-brnet]').forEach((b) => b.addEventListener('click', () => {
    brNet = b.dataset.brnet;
    document.querySelectorAll('[data-brnet]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawBR();
  }));
  function drawGap() {
    const xs = sizes;
    const get = (net, f) => xs.map((N) => { const d = D.sizes[N][net]; return d ? f(d) : null; });
    const series = [
      { key: 'co', label: 'Complete: best for the community', color: 'var(--s1)', ys: get('complete', (d) => optimum(D.ec, d.perf)) },
      { key: 'cn', label: 'Complete: what scientists choose (Nash)', color: 'var(--s1)', ys: get('complete', (d) => nash(D.eg, d.br)), dash: true },
      { key: 'ro', label: 'Ring: best for the community', color: 'var(--s2)', ys: get('cycle', (d) => optimum(D.ec, d.perf)) },
      { key: 'rn', label: 'Ring: what scientists choose (Nash)', color: 'var(--s2)', ys: get('cycle', (d) => nash(D.eg, d.br)), dash: true },
    ];
    CH.legend($('gap-legend'), series);
    CH.lineChart($('gap-chart'), {
      xs, xName: 'scientists', xLabel: 'Number of scientists', yDomain: [0, 0.35], yFormat: (v) => v.toFixed(2), series, height: 280,
      ariaLabel: 'Community optimum and Nash equilibrium', valueText: (s, i) => (s.ys[i] == null ? '–' : 'ε ' + s.ys[i].toFixed(3)),
    });
    let html = '<thead><tr><th>Scientists</th><th>Complete: optimum</th><th>Complete: Nash</th><th>Ring: optimum</th><th>Ring: Nash</th></tr></thead><tbody>';
    xs.forEach((N, i) => {
      const c = (s) => (s.ys[i] == null ? '–' : s.ys[i].toFixed(3));
      html += `<tr><td>${N}</td><td>${c(series[0])}</td><td>${c(series[1])}</td><td>${c(series[2])}</td><td>${c(series[3])}</td></tr>`;
    });
    $('gap-table').innerHTML = html + '</tbody>';
  }
  let curveN = 8, curveG = 6; // index into D.eg
  function drawCurve() {
    const d = D.sizes[curveN].complete;
    const ys = d.hero[curveG];
    const eg = D.eg[curveG];
    const gi = D.eh.indexOf(eg);
    const match = gi >= 0 ? ys[gi] : null;
    const series = [
      { key: 'h', label: 'Hero’s payoff', color: 'var(--s1)', ys },
      { key: 'g', label: 'Hero’s payoff if it matched the group', color: 'var(--muted)', ys: D.eh.map(() => match), dash: true },
    ];
    CH.legend($('curve-legend'), series);
    const lo = Math.floor(Math.min(...ys) * 20) / 20, hi = Math.ceil(Math.max(...ys) * 20) / 20;
    CH.lineChart($('curve-chart'), {
      xs: D.eh, xFormat: (v) => v.toFixed(2), xName: 'hero ε', xLabel: 'Hero’s own exploration rate', yDomain: [lo, hi], yFormat: (v) => v.toFixed(2), series, height: 260,
      ariaLabel: 'Hero payoff curve', valueText: (s, i) => (s.ys[i] == null ? '–' : s.ys[i].toFixed(3)),
    });
    $('out-curveG').textContent = eg.toFixed(2);
    $('curve-note').textContent = `With ${curveN} fully connected scientists all exploring at ${eg.toFixed(2)}, the hero does best at ε ≈ ${d.br[curveG].toFixed(2)}.`;
  }
  $('in-curveG').max = D.eg.length - 1;
  $('in-curveG').value = curveG;
  $('in-curveG').addEventListener('input', () => { curveG = +$('in-curveG').value; drawCurve(); });
  document.querySelectorAll('[data-curven]').forEach((b) => b.addEventListener('click', () => {
    curveN = +b.dataset.curven;
    document.querySelectorAll('[data-curven]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawCurve();
  }));
  drawBR();
  drawGap();
  drawCurve();
})();
