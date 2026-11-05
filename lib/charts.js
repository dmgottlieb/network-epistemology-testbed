/*
 * Small SVG line chart with hover tooltip, legend and optional interval bands.
 * Colours are CSS custom properties so charts follow the page theme.
 */
(function (root) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, style) {
    const node = document.createElementNS(SVGNS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (style) node.setAttribute('style', style);
    return node;
  }

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
  }

  function linearTicks(lo, hi, count) {
    const step = niceStep(hi - lo, count);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function logTicks(lo, hi) {
    const out = [];
    const a = Math.floor(Math.log10(lo));
    const b = Math.ceil(Math.log10(hi));
    for (let e = a; e <= b; e++) {
      for (const m of b - a <= 2 ? [1, 2, 5] : [1]) {
        const v = m * Math.pow(10, e);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      }
    }
    return out;
  }

  function fmtCompact(v) {
    if (v >= 10000) return (v / 1000).toFixed(0) + 'K';
    if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'K';
    return String(+v.toPrecision(4));
  }

  /*
   * cfg: {
   *   xs, xLog, xFormat, xLabel,
   *   yLog, yDomain: [lo, hi], yFormat, yLabel,
   *   series: [{ key, label, color, ys, lo?, hi? }],
   *   valueText(series, i) -> string for tooltip,
   *   height
   * }
   */
  function lineChart(container, cfg) {
    container._cfg = cfg;
    if (!container._ro) {
      container._ro = new ResizeObserver(() => {
        if (container._cfg && container.clientWidth !== container._lastW) render(container);
      });
      container._ro.observe(container);
    }
    render(container);
  }

  function render(container) {
    const cfg = container._cfg;
    const W = Math.max(280, container.clientWidth || 560);
    container._lastW = container.clientWidth;
    const H = cfg.height || 260;
    const m = { l: 52, r: 18, t: 12, b: 44 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    container.innerHTML = '';

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.ariaLabel || '' });
    container.appendChild(svg);

    const xs = cfg.xs;
    if (!xs.length) return;
    const xMin = Math.min.apply(null, xs);
    const xMax = Math.max.apply(null, xs);
    const xLog = cfg.xLog && xMin > 0;
    const tx = xLog ? Math.log10 : (v) => v;
    let x0 = tx(xMin), x1 = tx(xMax);
    if (x0 === x1) { x0 -= 0.5; x1 += 0.5; }
    const pad = (x1 - x0) * 0.04;
    x0 -= pad; x1 += pad;
    const X = (v) => m.l + ((tx(v) - x0) / (x1 - x0)) * pw;

    let [y0, y1] = cfg.yDomain;
    const yLog = !!cfg.yLog;
    const ty = yLog ? Math.log10 : (v) => v;
    const Y = (v) => m.t + ph - ((ty(v) - ty(y0)) / (ty(y1) - ty(y0))) * ph;

    // grid + y ticks
    const yTicks = yLog ? logTicks(y0, y1) : linearTicks(y0, y1, 5);
    const gGrid = el('g', {});
    for (const v of yTicks) {
      const y = Y(v);
      gGrid.appendChild(el('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y }, 'stroke: var(--rule); stroke-width: 1'));
      const t = el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, 'fill: var(--muted); font: 11px var(--mono)');
      t.textContent = cfg.yFormat ? cfg.yFormat(v) : fmtCompact(v);
      gGrid.appendChild(t);
    }
    svg.appendChild(gGrid);
    // baseline
    svg.appendChild(el('line', { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph }, 'stroke: var(--axis); stroke-width: 1'));

    // x ticks at the sampled values, dropping labels that would collide
    let lastX = -Infinity;
    const xi = xs.map((v, i) => i);
    for (const i of xi) {
      const x = X(xs[i]);
      svg.appendChild(el('line', { x1: x, x2: x, y1: m.t + ph, y2: m.t + ph + 4 }, 'stroke: var(--axis)'));
      const isLast = i === xs.length - 1;
      if (x - lastX < 34 && !isLast) continue;
      if (isLast && x - lastX < 34 && i > 0) continue;
      lastX = x;
      const t = el('text', { x, y: m.t + ph + 17, 'text-anchor': 'middle' }, 'fill: var(--muted); font: 11px var(--mono)');
      t.textContent = cfg.xFormat ? cfg.xFormat(xs[i]) : fmtCompact(xs[i]);
      svg.appendChild(t);
    }
    if (cfg.xLabel) {
      const t = el('text', { x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, 'fill: var(--ink-2); font: 12px var(--body)');
      t.textContent = cfg.xLabel;
      svg.appendChild(t);
    }

    const clampY = (v) => Math.max(y0, Math.min(y1, v));

    // bands
    for (const s of cfg.series) {
      if (!s.lo || !s.hi) continue;
      let top = '', bottom = '';
      const pts = [];
      xs.forEach((x, i) => { if (s.ys[i] != null) pts.push(i); });
      if (pts.length < 1) continue;
      for (const i of pts) top += (top ? 'L' : 'M') + X(xs[i]).toFixed(1) + ',' + Y(clampY(s.hi[i])).toFixed(1);
      for (let q = pts.length - 1; q >= 0; q--) bottom += 'L' + X(xs[pts[q]]).toFixed(1) + ',' + Y(clampY(s.lo[pts[q]])).toFixed(1);
      if (pts.length === 1) {
        const i = pts[0];
        svg.appendChild(el('line', { x1: X(xs[i]), x2: X(xs[i]), y1: Y(clampY(s.lo[i])), y2: Y(clampY(s.hi[i])) }, `stroke: ${s.color}; stroke-width: 6; stroke-opacity: 0.18; stroke-linecap: round`));
      } else {
        svg.appendChild(el('path', { d: top + bottom + 'Z' }, `fill: ${s.color}; fill-opacity: 0.12; stroke: none`));
      }
    }
    // lines + markers
    for (const s of cfg.series) {
      let d = '';
      let pen = false;
      xs.forEach((x, i) => {
        const v = s.ys[i];
        if (v == null || !isFinite(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(x).toFixed(1) + ',' + Y(clampY(v)).toFixed(1);
        pen = true;
      });
      if (d) svg.appendChild(el('path', { d }, `fill: none; stroke: ${s.color}; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round${s.dash ? '; stroke-dasharray: 5 4' : ''}`));
      if (cfg.markers !== false) xs.forEach((x, i) => {
        const v = s.ys[i];
        if (v == null || !isFinite(v)) return;
        svg.appendChild(el('circle', { cx: X(x), cy: Y(clampY(v)), r: 4 }, `fill: ${s.color}; stroke: var(--surface); stroke-width: 2`));
      });
    }

    // hover layer
    const guide = el('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, visibility: 'hidden' }, 'stroke: var(--ink-2); stroke-width: 1');
    svg.appendChild(guide);
    const hit = el('rect', { x: m.l - 10, y: 0, width: pw + 20, height: m.t + ph + 6 }, 'fill: transparent; cursor: crosshair');
    svg.appendChild(hit);
    let tip = container.querySelector('.tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.hidden = true;
      container.appendChild(tip);
    }
    const scale = () => container.clientWidth / W;
    function move(ev) {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) / scale();
      let best = 0, bd = Infinity;
      xs.forEach((x, i) => { const dd = Math.abs(X(x) - px); if (dd < bd) { bd = dd; best = i; } });
      const gx = X(xs[best]);
      guide.setAttribute('x1', gx);
      guide.setAttribute('x2', gx);
      guide.setAttribute('visibility', 'visible');
      let html = `<div class="t-head">${cfg.xName ? cfg.xName + ' = ' : ''}${cfg.xFormat ? cfg.xFormat(xs[best]) : xs[best]}</div>`;
      for (const s of cfg.series) {
        const txt = s.ys[best] == null ? '–' : cfg.valueText ? cfg.valueText(s, best) : String(s.ys[best]);
        html += `<div class="t-row"><span><span class="sw" style="background:${s.color}"></span>${s.label}</span><span>${txt}</span></div>`;
      }
      tip.innerHTML = html;
      tip.hidden = false;
      const cw = container.clientWidth;
      const left = gx * scale();
      const tw = tip.offsetWidth;
      tip.style.left = (left + 14 + tw > cw ? Math.max(0, left - tw - 14) : left + 14) + 'px';
      tip.style.top = '8px';
    }
    function leave() {
      guide.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  function legend(container, series) {
    container.innerHTML = series
      .map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`)
      .join('');
  }

  const api = { lineChart, legend, linearTicks, logTicks, niceStep };
  root.NET = root.NET || {};
  root.NET.charts = api;
})(typeof self !== 'undefined' ? self : this);
