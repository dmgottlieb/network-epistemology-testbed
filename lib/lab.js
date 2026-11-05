/*
 * Playback for the model pages: Play / Step / Restart buttons, the speed
 * slider, keyboard shortcuts and the animation loop. Pages supply hooks.
 *
 * NET.lab.transport({
 *   speeds: [1, 2, 4, ..., Infinity], speed: index,
 *   step(animate, durationMs),   advance every run by one round
 *   restart(),                   rebuild runs at round 0
 *   running() -> bool,           any run still going
 *   draw(ts) -> bool,            draw; return true while still animating
 *   drawSlow(),                  charts redrawn at most ~20 times a second
 *   animateUpTo: rounds per second up to which steps are animated
 * })
 * Expects #btn-play, #btn-step, #btn-reset, #in-speed and #out-speed.
 */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);

  function transport(h) {
    const speeds = h.speeds || [1, 2, 4, 8, 15, 30, 60, Infinity];
    const st = { playing: false, speed: h.speed ?? 3, dirty: true, slowDirty: true, animate: true };
    let acc = 0, lastTs = 0, lastSlow = 0;

    function setPlaying(on) {
      if (on && !h.running()) h.restart();
      st.playing = on;
      const btn = $('btn-play');
      btn.querySelector('span').textContent = on ? 'Pause' : 'Play';
      btn.querySelector('svg').innerHTML = on
        ? '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/>'
        : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>';
      acc = 0;
    }
    function syncSpeed() {
      $('in-speed').max = speeds.length - 1;
      $('in-speed').value = st.speed;
      const sp = speeds[st.speed];
      $('out-speed').textContent = isFinite(sp) ? `${sp} / s` : 'Max';
    }
    function invalidate() { st.dirty = st.slowDirty = true; }
    function stepOnce(animate, dur) { h.step(animate, dur); invalidate(); }

    $('btn-play').addEventListener('click', () => setPlaying(!st.playing));
    $('btn-step').addEventListener('click', () => { setPlaying(false); stepOnce(st.animate, 600); });
    $('btn-reset').addEventListener('click', () => { setPlaying(false); h.restart(); invalidate(); });
    $('in-speed').addEventListener('input', () => { st.speed = +$('in-speed').value; syncSpeed(); });
    document.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === ' ') { ev.preventDefault(); setPlaying(!st.playing); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); setPlaying(false); stepOnce(st.animate, 600); }
      else if (ev.key === 'r' || ev.key === 'R') { setPlaying(false); h.restart(); invalidate(); }
    });

    function frame(ts) {
      const dt = lastTs ? Math.min(100, ts - lastTs) : 16;
      lastTs = ts;
      if (st.playing) {
        const sp = speeds[st.speed];
        if (!isFinite(sp)) {
          const t0 = performance.now();
          do h.step(false, 0); while (h.running() && performance.now() - t0 < 12);
          invalidate();
        } else {
          acc += dt;
          const interval = 1000 / sp;
          let k = 0;
          while (acc >= interval && k < 4) {
            acc -= interval;
            h.step(st.animate && sp <= (h.animateUpTo ?? 15), Math.min(800, interval * 0.92));
            k++;
          }
          if (k) invalidate();
          if (k === 4) acc = 0;
        }
        if (!h.running()) setPlaying(false);
      }
      if (st.dirty) st.dirty = !!h.draw(ts);
      if (st.slowDirty && (!st.playing || ts - lastSlow > 45)) { h.drawSlow && h.drawSlow(); st.slowDirty = false; lastSlow = ts; }
      requestAnimationFrame(frame);
    }
    syncSpeed();
    requestAnimationFrame(frame);
    return { setPlaying, invalidate, state: st };
  }

  root.NET = root.NET || {};
  root.NET.lab = { transport };
})(typeof self !== 'undefined' ? self : this);
