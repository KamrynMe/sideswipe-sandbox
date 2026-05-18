/*
 * app.js -- Milestone 2.5 entry point.
 *
 * Responsibilities:
 *   - Register the service worker.
 *   - Hold the live params object (mutable; the UI mutates it). Note: this
 *     is the ONE place we deviate from "params is frozen": we keep a mutable
 *     working copy here so sliders can update values in-place without
 *     allocating new objects per frame. The frozen DEFAULT_PARAMS in
 *     params.js remains untouched.
 *   - Run the fixed-timestep accumulator (physics at params.physicsHz,
 *     render at requestAnimationFrame).
 *   - Persist the live params to localStorage so they survive reloads.
 *   - Wire UI controller: sliders set params, button copies diagnostics,
 *     reset reverts to DEFAULT_PARAMS.
 *   - Feed the REPLAY recorder every physics tick so we capture bounces,
 *     periodic snapshots, and parameter changes for the diagnostics blob.
 *   - Tap-to-reset on the canvas re-drops the ball with the live params.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'ss-sandbox:params';

  // -------------------------------------------------------------------
  // Service worker registration
  // -------------------------------------------------------------------

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .then((reg) => console.log('[ss-sandbox] SW registered:', reg.scope))
        .catch((err) => console.warn('[ss-sandbox] SW reg failed:', err));
    });
  }

  // -------------------------------------------------------------------
  // Canvas setup with DPR
  // -------------------------------------------------------------------

  function setupCanvas() {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    return { canvas, ctx };
  }

  // -------------------------------------------------------------------
  // FPS tracker
  // -------------------------------------------------------------------

  function makeFpsTracker() {
    let lastT = performance.now();
    let emaFps = 60;
    const alpha = 0.1;
    return {
      tick(now) {
        const dt = now - lastT;
        lastT = now;
        if (dt > 0) emaFps = alpha * (1000 / dt) + (1 - alpha) * emaFps;
        return emaFps;
      },
      get value() { return emaFps; },
    };
  }

  // -------------------------------------------------------------------
  // Params: mutable working copy + localStorage persistence
  // -------------------------------------------------------------------

  function makeLiveParams() {
    const base = window.PARAMS.DEFAULT_PARAMS;
    // Mutable copy (NOT frozen).
    const live = Object.assign({}, base);
    // Restore from localStorage if present.
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // Only restore keys present in defaults to avoid stale schema cruft.
        for (const k of Object.keys(base)) {
          if (k in saved && typeof saved[k] === typeof base[k]) live[k] = saved[k];
        }
      }
    } catch (e) {
      console.warn('[ss-sandbox] failed to restore params:', e);
    }
    return live;
  }

  function persistParams(live) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(live)); }
    catch (e) { /* ignore */ }
  }

  function resetParamsToDefault(live) {
    const base = window.PARAMS.DEFAULT_PARAMS;
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, base);
  }

  // -------------------------------------------------------------------
  // Drop preset (the M2 free-fall ball drop)
  // -------------------------------------------------------------------

  function makeFreshState(params) {
    return window.PHYS.makeState({
      car: {
        pos: { x: params.arenaWidth * 0.20, y: params.carHeight / 2 },
        vel: { x: 0, y: 0 },
        heading: 0,
      },
      ball: {
        pos: { x: params.arenaWidth * 0.60, y: params.arenaHeight * 0.90 },
        vel: { x: -120, y: 0 },
        angVel: 1.2,
      },
    }, params);
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  function boot() {
    const { canvas, ctx } = setupCanvas();
    const PHYS = window.PHYS;
    const REND = window.REND;
    const PARAMS = window.PARAMS;
    const REPLAY = window.REPLAY;
    const DIAG = window.DIAG;
    const UI = window.UI;
    if (!PHYS || !REND || !PARAMS || !REPLAY || !DIAG || !UI) {
      console.error('[ss-sandbox] missing module(s)');
      return;
    }

    const params = makeLiveParams();
    let state = makeFreshState(params);
    const action = PHYS.makeAction();
    const fps = makeFpsTracker();
    const recorder = REPLAY.makeRecorder();
    recorder.reset(params, state);

    let paramsDirtySince = null;
    let userNotes = '';

    // Controller: exposed to the UI module so it can mutate params + copy.
    const controller = {
      getParams() { return params; },
      setParam(key, value) {
        if (typeof params[key] !== 'number' && typeof params[key] !== 'undefined') {
          // (We only have numeric tunables in M2.)
          return;
        }
        params[key] = value;
        paramsDirtySince = paramsDirtySince || new Date().toISOString();
        persistParams(params);
        recorder.noteParamChange(params, state.t);
      },
      resetParams() {
        resetParamsToDefault(params);
        paramsDirtySince = null;
        persistParams(params);
        recorder.noteParamChange(params, state.t);
      },
      setUserNotes(text) { userNotes = text; },
      async copyDiagnostics() {
        const meta = {
          milestone: 'M2.5',
          fpsAvg: fps.value,
          devicePixelRatio: window.devicePixelRatio || 1,
          screenW: window.innerWidth,
          screenH: window.innerHeight,
          paramsDirtySince: paramsDirtySince,
        };
        const payload = DIAG.composePayload(params, state, recorder,
                                            userNotes, meta);
        const text = DIAG.stringify(payload);
        return DIAG.copyToClipboard(text);
      },
      resetSimulation() {
        state = makeFreshState(params);
        recorder.reset(params, state);
      },
    };

    const uiHandle = UI.mount(controller, 'M2');

    // Tap-to-reset on the canvas only.
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      controller.resetSimulation();
    }, { passive: false });

    // Status HUD update throttling.
    const statusEl = document.getElementById('status-line');
    let lastStatusUpdate = 0;

    // Accumulator loop.
    let lastNow = performance.now();
    let accumulator = 0;
    const MAX_ACCUM = 0.25;

    function frame(now) {
      const fpsNow = fps.tick(now);

      let elapsed = (now - lastNow) / 1000;
      lastNow = now;
      if (elapsed > MAX_ACCUM) elapsed = MAX_ACCUM;
      accumulator += elapsed;

      const dt = 1 / params.physicsHz;
      let safety = 1000;
      while (accumulator >= dt && safety-- > 0) {
        PHYS.step(state, action, params, dt);
        recorder.observe(state, action, params);
        accumulator -= dt;
      }

      const cssW = canvas.width / (window.devicePixelRatio || 1);
      const cssH = canvas.height / (window.devicePixelRatio || 1);
      REND.render(ctx, state, params, cssW, cssH);

      // HUD updates throttled to ~4 Hz to avoid layout thrash on phone.
      if (now - lastStatusUpdate > 250) {
        lastStatusUpdate = now;
        if (statusEl) {
          const s = recorder.summarize();
          statusEl.textContent = 'M2.5 · tap canvas to reset · bounces='
            + s.bounces.floor + ' · t=' + state.t.toFixed(2) + 's';
        }
        uiHandle.onFps(fpsNow);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
