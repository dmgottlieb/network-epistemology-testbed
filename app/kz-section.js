/* The Kummerfeld & Zollman (2016) section of exchange.html. */
(function () {
  'use strict';

  const { charts: CH } = window.NET;
  const D = window.NET.kzPresets;
  const $ = (id) => document.getElementById(id);
  if (!D) return;

  let N = 8;
  const sizes = Object.keys(D.sizes).map(Number).sort((a, b) => a - b);
  const seg = $('kz-sizes');
  for (const s of sizes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${s} agents`;
    b.setAttribute('aria-pressed', String(s === N));
    b.addEventListener('click', () => {
      N = s;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    });
    seg.appendChild(b);
  }

  // best eps on the grid, refined with a parabola through the top three points
  function optimum(xs, ys) {
    let k = 0;
    ys.forEach((y, i) => { if (y > ys[k]) k = i; });
    if (k === 0 || k === ys.length - 1) return { x: xs[k], y: ys[k] };
    const [x0, x1, x2] = [xs[k - 1], xs[k], xs[k + 1]];
    const [y0, y1, y2] = [ys[k - 1], ys[k], ys[k + 1]];
    const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
    const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
    const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
    if (a >= 0) return { x: x1, y: y1 };
    const xv = Math.min(x2, Math.max(x0, -b / (2 * a)));
    return { x: xv, y: ys[k] };
  }
  // eps at which the rising part of curve ys first reaches level v
  function reach(xs, ys, v) {
    for (let i = 0; i < ys.length - 1; i++) {
      if (ys[i] <= v && ys[i + 1] >= v) return xs[i] + ((v - ys[i]) / (ys[i + 1] - ys[i])) * (xs[i + 1] - xs[i]);
    }
    return null;
  }
  function crossing(xs, a, b) {
    for (let i = 0; i < xs.length - 1; i++) {
      const d0 = a[i] - b[i], d1 = a[i + 1] - b[i + 1];
      if (d0 < 0 && d1 >= 0) return xs[i] + (-d0 / (d1 - d0)) * (xs[i + 1] - xs[i]);
    }
    return null;
  }

  function render() {
    const xs = D.eps;
    const S = D.sizes[N];
    const mk = (key, label, color) => {
      const ys = S[key].map((p) => p[0]);
      return { key, label, color, ys, lo: S[key].map((p) => p[0] - 1.96 * p[1]), hi: S[key].map((p) => p[0] + 1.96 * p[1]) };
    };
    const series = [mk('cycle', 'Ring', 'var(--s2)'), mk('complete', 'Complete', 'var(--s1)')];
    const all = series.flatMap((s) => s.ys);
    const lo = Math.floor(Math.min(...all) * 20) / 20, hi = Math.ceil(Math.max(...all) * 20) / 20;
    CH.legend($('kz-legend'), series);
    CH.lineChart($('kz-chart'), {
      xs, xFormat: (v) => v.toFixed(2), xName: 'ε', xLabel: 'Exploration rate ε, used by every agent',
      yDomain: [lo, hi], yFormat: (v) => v.toFixed(2), series, height: 280,
      ariaLabel: 'Payoff per pull against exploration rate for ring and complete networks',
      valueText: (s, i) => s.ys[i].toFixed(3),
    });
    const ring = series[0].ys, comp = series[1].ys;
    const oR = optimum(xs, ring), oC = optimum(xs, comp);
    const match = reach(xs, comp, ring[0]);
    const cross = crossing(xs, comp, ring);
    $('kz-stats').innerHTML = `
      <div class="stat"><div class="k">Best ε, ring</div><div class="v">${oR.x.toFixed(2)}</div><div class="d">payoff ${oR.y.toFixed(3)} per pull</div></div>
      <div class="stat"><div class="k">Best ε, complete</div><div class="v">${oC.x.toFixed(2)}</div><div class="d">payoff ${oC.y.toFixed(3)} per pull</div></div>
      <div class="stat"><div class="k">Ring with no exploration</div><div class="v">≈ ε ${match != null ? match.toFixed(3) : '–'}</div><div class="d">the complete network’s matching exploration rate</div></div>`;
    $('kz-sub').textContent = `Ring vs. complete network, ${N} agents, ${D.rounds} rounds; ${D.runs.toLocaleString()} simulated communities per point, bands are 95% intervals. The paper’s Fig. 6 shows the 8-agent case.`;
    if (N === 8) {
      if (cross != null) $('kz-cross').textContent = cross.toFixed(2);
      if (match != null) $('kz-match').textContent = match.toFixed(2);
      $('kz-gap').textContent = Math.max(0, oC.x - oR.x).toFixed(2);
    }
  }
  render();
})();
