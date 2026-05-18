/*
 * ui.js -- the slider tuning panel + notes + copy-diagnostics button.
 *
 * This is the user's primary interaction surface. Everything they need
 * to do during a feel-test session lives here:
 *   - Drawer toggle (chevron, top-right).
 *   - Sliders for every milestone-relevant parameter.
 *   - "Reset to default" per-param double-tap + a global reset.
 *   - User notes textarea ("ball feels too floaty when it bounces off
 *     the wall first").
 *   - "COPY DIAGNOSTICS" button: composes the payload and writes to
 *     clipboard. Shows a brief toast on success.
 *
 * Architecturally: thin wrapper. Reads/writes the params object via a
 * controller object passed in from app.js. UI knows nothing about
 * physics, replay, or diagnostics internals; it just calls
 *   controller.getParams()
 *   controller.setParam(key, value)
 *   controller.copyDiagnostics()
 *   controller.setUserNotes(text)
 *   controller.resetSimulation()
 *
 * Per directives/parameter_calibration.md: which sliders are exposed
 * depends on the current milestone. At M2 we expose only the ball-feel
 * parameters; driving/aerial come in M3/M4.
 */

(function (root) {
  'use strict';

  /**
   * Slider definitions per milestone. Each entry:
   *   { key, label, min, max, step, group }
   * Groups are visual section dividers in the panel.
   */
  const SLIDERS_M2 = [
    // Gravity + ball motion
    { key: 'gravity',         label: 'Gravity',           min: 200,   max: 5000, step: 25,    group: 'Ball' },
    { key: 'ballRestitution', label: 'Ball bounciness',   min: 0,     max: 1,    step: 0.01,  group: 'Ball' },
    { key: 'ballDrag',        label: 'Ball air drag',     min: 0,     max: 0.5,  step: 0.005, group: 'Ball' },
    { key: 'ballAngularDrag', label: 'Ball spin drag',    min: 0,     max: 0.5,  step: 0.005, group: 'Ball' },
    { key: 'ballSpeedCap',    label: 'Ball speed cap',    min: 500,   max: 8000, step: 50,    group: 'Ball' },
    { key: 'ballRadius',      label: 'Ball radius',       min: 20,    max: 200,  step: 1,     group: 'Visual scale' },
    { key: 'ballMass',        label: 'Ball mass',         min: 0.1,   max: 5,    step: 0.05,  group: 'Ball' },
    // Arena
    { key: 'arenaWidth',      label: 'Arena width',       min: 1024,  max: 8192, step: 64,    group: 'Visual scale' },
    { key: 'arenaHeight',     label: 'Arena height',      min: 512,   max: 4096, step: 32,    group: 'Visual scale' },
  ];

  function slidersForMilestone(m) {
    if (m === 'M2') return SLIDERS_M2;
    return SLIDERS_M2;  // expand in M3+
  }

  /**
   * Mount the UI inside the document. Returns a handle to update FPS
   * and trigger toast messages externally.
   */
  function mount(controller, milestone) {
    const sliders = slidersForMilestone(milestone);

    // Container
    const root = document.createElement('div');
    root.id = 'ui-root';
    root.innerHTML = _shellHTML();
    document.body.appendChild(root);

    const panel = root.querySelector('#tune-panel');
    const toggle = root.querySelector('#tune-toggle');
    const closeBtn = root.querySelector('#tune-close');
    const sliderHost = root.querySelector('#tune-sliders');
    const notesEl = root.querySelector('#tune-notes');
    const copyBtn = root.querySelector('#tune-copy');
    const resetBtn = root.querySelector('#tune-reset');
    const fpsEl = document.getElementById('fps-line');
    const toast = root.querySelector('#tune-toast');

    // Build slider rows.
    const currentParams = controller.getParams();
    const groupOrder = [];
    const groupMap = {};
    for (const def of sliders) {
      if (!groupMap[def.group]) {
        groupMap[def.group] = [];
        groupOrder.push(def.group);
      }
      groupMap[def.group].push(def);
    }
    const refs = {};
    for (const g of groupOrder) {
      const header = document.createElement('div');
      header.className = 'tune-group-header';
      header.textContent = g;
      sliderHost.appendChild(header);
      for (const def of groupMap[g]) {
        const row = _makeSliderRow(def, currentParams[def.key], controller);
        sliderHost.appendChild(row.el);
        refs[def.key] = row;
      }
    }

    // Open/close drawer.
    function open() {
      panel.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      panel.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', open);
    closeBtn.addEventListener('click', close);

    // Stop physics tap-to-reset while interacting with the panel.
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    // Notes textarea piped to controller.
    notesEl.addEventListener('input', () => {
      controller.setUserNotes(notesEl.value);
    });

    // Copy button.
    copyBtn.addEventListener('click', async () => {
      copyBtn.disabled = true;
      copyBtn.textContent = 'Copying...';
      const ok = await controller.copyDiagnostics();
      copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
      _flashToast(toast,
        ok ? 'Diagnostics copied to clipboard. Paste in chat to Claude.'
           : 'Copy failed -- check clipboard permission.');
      setTimeout(() => {
        copyBtn.textContent = 'Copy diagnostics';
        copyBtn.disabled = false;
      }, 1800);
    });

    // Reset-to-default button.
    resetBtn.addEventListener('click', () => {
      if (!confirm('Reset all parameters to defaults?')) return;
      controller.resetParams();
      const fresh = controller.getParams();
      for (const k of Object.keys(refs)) refs[k].setValue(fresh[k]);
    });

    return {
      onFps(fps) { if (fpsEl) fpsEl.textContent = 'FPS: ' + fps.toFixed(1); },
      onParamChangedExternally(key, value) {
        if (refs[key]) refs[key].setValue(value);
      },
    };
  }

  function _makeSliderRow(def, initial, controller) {
    const row = document.createElement('div');
    row.className = 'tune-row';
    row.innerHTML = `
      <div class="tune-row-head">
        <label class="tune-label">${def.label}</label>
        <span class="tune-value" data-key="${def.key}"></span>
      </div>
      <input type="range" class="tune-slider"
             min="${def.min}" max="${def.max}" step="${def.step}"
             value="${initial}" data-key="${def.key}" />
    `;
    const slider = row.querySelector('input');
    const valueEl = row.querySelector('.tune-value');
    function paint(v) {
      const digits = def.step < 1 ? Math.max(2, -Math.floor(Math.log10(def.step))) : 0;
      valueEl.textContent = Number(v).toFixed(digits);
    }
    paint(initial);
    slider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      paint(v);
      controller.setParam(def.key, v);
    });
    return {
      el: row,
      setValue(v) { slider.value = v; paint(v); },
    };
  }

  function _flashToast(toastEl, msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function _shellHTML() {
    return `
      <button id="tune-toggle" aria-expanded="false" title="Open tuning panel">
        <span class="chev">⚙</span>
      </button>
      <div id="tune-panel" role="dialog" aria-label="Tuning panel">
        <div class="tune-header">
          <span>Tune physics</span>
          <button id="tune-close" aria-label="Close">×</button>
        </div>
        <div id="tune-sliders"></div>
        <div class="tune-group-header">Notes for Claude</div>
        <textarea id="tune-notes" placeholder="What does it feel like? e.g. 'bounce dies too fast', 'ball falls too slowly', 'too floaty'..." rows="3"></textarea>
        <div class="tune-actions">
          <button id="tune-reset" class="tune-btn-secondary">Reset to default</button>
          <button id="tune-copy" class="tune-btn-primary">Copy diagnostics</button>
        </div>
        <div id="tune-toast"></div>
      </div>
    `;
  }

  const exports = { mount: mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  if (root) root.UI = exports;
})(typeof window !== 'undefined' ? window : null);
