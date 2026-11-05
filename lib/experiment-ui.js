/*
 * A reusable Monte Carlo experiment panel: presets, "vary x / compare
 * series / hold the rest fixed" controls, a chart of a chosen metric, and a
 * results table. Built from a spec supplied by each model page.
 *
 * spec = {
 *   variables: { key: { name, label, kind: 'int' | 'num' | 'enum',
 *                        options?: [[value, label]], min?, max?, defaults: '1, 2, 3' } },
 *   varyKeys: [...], seriesKeys: [...],
 *   fixed: { key: value },                 default values
 *   metrics: { key: { label, sub, value(acc), prop?: outcomeKey, log?, fmt(v) } },
 *   defaultMetric, runs, runOne(params, rand, cache),
 *   tableCell(acc) -> html string,  tableHead -> html string,
 *   presets: { key: { title, note, metric, vary, xs, seriesBy, series, fixed, runs, acc } },
 *   defaultPreset,
 * }
 */
(function (root) {
  'use strict';

  const { charts: CH, sweep: SW, rng } = root.NET;
  const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];

  function mount(rootEl, spec) {
    const id = (s) => `${rootEl.id}-${s}`;
    const V = spec.variables;
    const opt = (keys) => keys.map((k) => `<option value="${k}">${V[k].label}</option>`).join('');
    const fixedInputs = Object.keys(V).map((k) => {
      const v = V[k];
      if (v.kind === 'enum') {
        return `<div class="field"><label class="hint" for="${id('f-' + k)}">${v.name}</label><select id="${id('f-' + k)}">${v.options.map(([val, lab]) => `<option value="${val}">${lab}</option>`).join('')}</select></div>`;
      }
      return `<div class="field"><label class="hint" for="${id('f-' + k)}">${v.name}</label><input type="number" id="${id('f-' + k)}" step="any"${v.min != null ? ` min="${v.min}"` : ''}${v.max != null ? ` max="${v.max}"` : ''}></div>`;
    }).join('');

    rootEl.innerHTML = `
      <div class="exp-controls">
        <div class="field span-all">
          <p class="group-label">Presets</p>
          <div class="chips" id="${id('presets')}"></div>
          <p class="note" id="${id('note')}"></p>
        </div>
        <div class="field">
          <label for="${id('vary')}">Vary</label>
          <select id="${id('vary')}">${opt(spec.varyKeys)}</select>
          <input type="text" class="mono" id="${id('xs')}" aria-label="Values to try">
        </div>
        <div class="field">
          <label for="${id('series')}">Compare</label>
          <select id="${id('series')}">${opt(spec.seriesKeys)}</select>
          <input type="text" class="mono" id="${id('ss')}" aria-label="Values to compare">
          <span class="hint">Separate values with commas.</span>
        </div>
        <div class="field span-all">
          <span class="label">Hold the others at</span>
          <div class="pair" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))">${fixedInputs}</div>
        </div>
        <div class="run-row span-all">
          <div class="field" style="flex:0 0 140px"><label class="hint" for="${id('runs')}">Runs per point</label><input type="number" id="${id('runs')}" min="10" step="10"></div>
          <button class="btn primary" type="button" id="${id('run')}">Run experiment</button>
          <div class="progress">
            <div class="progress-track"><div class="progress-fill" id="${id('fill')}"></div></div>
            <span class="progress-text" id="${id('progress')}" aria-live="polite"></span>
          </div>
        </div>
      </div>
      <div class="exp-out" style="grid-template-columns: minmax(0, 1fr)">
        <div class="chart-card">
          <div class="field-top" style="align-items:center; flex-wrap:wrap">
            <h3 id="${id('title')}"></h3>
            <select id="${id('metric')}" aria-label="What to plot" style="width:auto">${Object.entries(spec.metrics).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('')}</select>
          </div>
          <p class="sub" id="${id('sub')}"></p>
          <div class="chart-legend" id="${id('legend')}"></div>
          <div class="chart-box" id="${id('chart')}"></div>
        </div>
      </div>
      <div class="effect-strip">
        <div class="field-top"><h3 style="font-family:var(--body); font-size:15px">Results table</h3><span class="source-tag" id="${id('source')}"></span></div>
        <div class="table-scroll"><table class="results" id="${id('table')}"></table></div>
      </div>`;
    const $ = (s) => document.getElementById(id(s));

    function label(key, val) {
      const v = V[key];
      if (v.kind === 'enum') { const o = v.options.find((p) => String(p[0]) === String(val)); return o ? o[1] : String(val); }
      return `${v.name} = ${val}`;
    }
    const fmtX = (key) => (val) => (V[key].kind === 'enum' ? label(key, val) : (Math.abs(val) >= 1000 ? val / 1000 + 'K' : String(val)));

    function parse(key, text) {
      const v = V[key];
      const raw = text.split(/[\s,;]+/).filter(Boolean);
      if (v.kind === 'enum') return raw.filter((t) => v.options.some((o) => String(o[0]) === t));
      let xs = raw.map(Number).filter(isFinite);
      if (v.kind === 'int') xs = xs.map(Math.round);
      if (v.min != null) xs = xs.filter((x) => x >= v.min);
      if (v.max != null) xs = xs.filter((x) => x <= v.max);
      return Array.from(new Set(xs)).sort((a, b) => a - b);
    }
    function readFixed() {
      const f = {};
      for (const k of Object.keys(V)) {
        const el = $('f-' + k);
        f[k] = V[k].kind === 'enum' ? el.value : +el.value;
        if (V[k].kind === 'int') f[k] = Math.round(f[k]);
      }
      return f;
    }
    function apply(cfg) {
      $('vary').value = cfg.vary;
      $('xs').value = cfg.xs.join(', ');
      $('series').value = cfg.seriesBy;
      $('ss').value = cfg.series.join(', ');
      for (const k of Object.keys(V)) if (cfg.fixed[k] != null) $('f-' + k).value = cfg.fixed[k];
      $('runs').value = cfg.runs;
      if (cfg.metric) $('metric').value = cfg.metric;
    }
    $('vary').addEventListener('change', () => { $('xs').value = V[$('vary').value].defaults; });
    $('series').addEventListener('change', () => { $('ss').value = V[$('series').value].defaults; });

    let shown = null;
    function render(res) {
      shown = res;
      const mk = $('metric').value;
      const M = spec.metrics[mk];
      $('title').textContent = M.label;
      const fixedBits = Object.keys(V).filter((k) => k !== res.vary && k !== res.seriesBy).map((k) => label(k, res.fixed[k]));
      $('sub').textContent = `${M.sub || ''}${M.prop ? ' Bands are 95% intervals.' : ''} Fixed: ${fixedBits.join(', ')}.`;
      const series = res.series.map((s, i) => {
        const accs = res.acc[String(s)];
        const out = { key: String(s), label: label(res.seriesBy, s), color: COLORS[i % COLORS.length], ys: accs.map((a) => M.value(a)), accs };
        if (M.prop) {
          const ci = accs.map((a) => SW.wilson(a.n[M.prop] || 0, a.runs));
          out.lo = ci.map((c) => c[0]);
          out.hi = ci.map((c) => c[1]);
        }
        return out;
      });
      let domain = M.domain || [0, 1];
      if (M.log || M.auto) {
        const vals = series.flatMap((s) => s.ys.filter((v) => v != null && (!M.log || v > 0)));
        if (vals.length) {
          if (M.log) {
            const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...vals))));
            let hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...vals))));
            if (hi <= lo) hi = lo * 10;
            domain = [lo, hi];
          } else {
            const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.1 || 0.05;
            domain = [Math.min(lo - pad, M.floor ?? Infinity), hi + pad];
          }
        }
      }
      const V0 = V[res.vary];
      const numericX = V0.kind !== 'enum';
      const xs = numericX ? res.xs : res.xs.map((_, i) => i + 1);
      const xLog = numericX && V0.log && Math.min(...res.xs) > 0;
      CH.legend($('legend'), series);
      CH.lineChart($('chart'), {
        xs, xLog, xFormat: numericX ? fmtX(res.vary) : (i) => label(res.vary, res.xs[i - 1]),
        xName: V0.name, xLabel: V0.label, yLog: !!M.log, yDomain: domain,
        yFormat: M.log ? undefined : M.yFormat || ((v) => v.toFixed(domain[1] - domain[0] < 0.5 ? 2 : 1)),
        series, height: 300, ariaLabel: M.label,
        valueText: (s, i) => (M.fmt ? M.fmt(s.ys[i], s.accs[i]) : String(s.ys[i])),
      });
      let html = `<thead><tr><th>${V0.name}</th>`;
      for (const s of series) html += `<th><span class="th-sw" style="background:${s.color}"></span>${s.label}<br><span style="font-weight:400">${spec.tableHead}</span></th>`;
      html += '</tr></thead><tbody>';
      res.xs.forEach((x, i) => {
        html += `<tr><td>${fmtX(res.vary)(x)}</td>`;
        for (const s of series) html += `<td>${s.accs[i].runs ? spec.tableCell(s.accs[i]) : '–'}</td>`;
        html += '</tr>';
      });
      $('table').innerHTML = html + '</tbody>';
    }
    $('metric').addEventListener('change', () => shown && render(shown));

    const presetsEl = $('presets');
    function showPreset(key) {
      const p = spec.presets[key];
      apply(p);
      render(p);
      presetsEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === key)));
      $('note').textContent = p.note || '';
      $('source').textContent = `Precomputed with this code: ${p.runs.toLocaleString()} runs per point. Press Run experiment to recompute.`;
      $('progress').textContent = '';
      $('fill').style.width = '0';
    }
    for (const [key, p] of Object.entries(spec.presets || {})) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.preset = key;
      b.textContent = p.title;
      b.addEventListener('click', () => { if (job) job.stop = true; showPreset(key); });
      presetsEl.appendChild(b);
    }

    let job = null;
    $('run').addEventListener('click', () => {
      if (job) { job.stop = true; return; }
      const vary = $('vary').value, seriesBy = $('series').value;
      if (vary === seriesBy) { $('progress').textContent = 'Choose different variables to vary and to compare.'; return; }
      const xs = parse(vary, $('xs').value), series = parse(seriesBy, $('ss').value).slice(0, 8);
      if (!xs.length || !series.length) { $('progress').textContent = 'Enter at least one valid value in each list.'; return; }
      const cfg = { vary, xs, seriesBy, series, fixed: readFixed(), runs: Math.max(10, Math.round(+$('runs').value || 200)) };
      presetsEl.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      $('note').textContent = '';
      const sw = SW.createSweep(cfg, rng.randomSeed(), spec.runOne);
      const res = Object.assign({}, cfg, { acc: sw.acc });
      job = { stop: false, t0: performance.now(), last: 0 };
      $('run').textContent = 'Stop';
      $('source').textContent = 'Computing in your browser…';
      render(res);
      (function tick() {
        const finished = sw.next(30);
        const now = performance.now();
        $('fill').style.width = ((100 * sw.done) / sw.total).toFixed(1) + '%';
        if (finished || job.stop || now - job.last > 400) { render(res); job.last = now; }
        if (finished || job.stop) {
          $('progress').textContent = job.stop ? `Stopped after ${sw.done.toLocaleString()} of ${sw.total.toLocaleString()} runs.` : `Done: ${sw.total.toLocaleString()} runs in ${((now - job.t0) / 1000).toFixed(1)} s.`;
          $('source').textContent = job.stop ? 'Partial results computed in your browser.' : `Computed in your browser: ${cfg.runs.toLocaleString()} runs per point.`;
          $('run').textContent = 'Run experiment';
          job = null;
          return;
        }
        $('progress').textContent = `Running… ${sw.done.toLocaleString()} of ${sw.total.toLocaleString()} runs`;
        setTimeout(tick, 0);
      })();
    });

    // initial state
    for (const k of Object.keys(V)) if (spec.fixed[k] != null) $('f-' + k).value = spec.fixed[k];
    $('runs').value = spec.runs || 200;
    if (spec.defaultMetric) $('metric').value = spec.defaultMetric;
    if (spec.defaultPreset && spec.presets[spec.defaultPreset]) showPreset(spec.defaultPreset);
    else { $('vary').value = spec.varyKeys[0]; $('xs').value = V[spec.varyKeys[0]].defaults; $('series').value = spec.seriesKeys[0]; $('ss').value = V[spec.seriesKeys[0]].defaults; }
    return { showPreset, render };
  }

  root.NET.experimentUI = { mount };
})(typeof self !== 'undefined' ? self : this);
