/*
 * app.js -- Milestone 2 entry point.
 *
 * Responsibilities:
 *   - Register the service worker.
 *   - Maintain physics state.
 *   - Run the fixed-timestep accumulator: physics ticks at params.physicsHz,
 *     render runs at requestAnimationFrame rate. NEVER call step with a
 *     variable dt; that breaks determinism + reproducibility.
 *   - Handle "tap to reset" so the user can repeatedly drop the ball.
 *   - Drive the FPS HUD line.
 *
 * No driving / input forces yet -- those land in M3. M2 is for the user
 * to feel-test ball bounce: gravity, ballRestitution, ballDrag.
 *
 * Architectural guardrails (carry forward):
 *   - physics.js must remain DOM-free. We import it via window.PHYS.
 *   - All tunable values come from params.js. No magic numbers here.
 */

(function () {
  'use strict';

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
  // FPS tracker (EMA, throttled UI updates)
  // -------------------------------------------------------------------

  function makeFpsTracker(updateEveryMs) {
    let lastT = performance.now();
    let emaFps = 60;
    let lastUiUpdate = 0;
    const el = document.getElementById('fps-line');
    const alpha = 0.1;
    return function tick(now) {
      const dt = now - lastT;
      lastT = now;
      if (dt > 0) emaFps = alpha * (1000 / dt) + (1 - alpha) * emaFps;
      if (now - lastUiUpdate > updateEveryMs) {
        lastUiUpdate = now;
        if (el) el.textContent = 'FPS: ' + emaFps.toFixed(1);
      }
    };
  }

  // -------------------------------------------------------------------
  // World state + reset preset
  // -------------------------------------------------------------------

  // Drop preset: ball high, slight horizontal velocity so the bounce has
  // visible character; car off to one side.
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
  // Status line update
  // -------------------------------------------------------------------

  function updateStatus(state) {
    const el = document.getElementById('status-line');
    if (!el) return;
    el.textContent = 'M2 — tap to reset · t=' + state.t.toFixed(2) + 's';
  }

  // -------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------

  function boot() {
    const { canvas, ctx } = setupCanvas();
    const fpsTick = makeFpsTracker(250);
    const PHYS = window.PHYS;
    const REND = window.REND;
    const PARAMS = window.PARAMS;
    if (!PHYS || !REND || !PARAMS) {
      console.error('[ss-sandbox] missing module(s); check script order');
      return;
    }
    const params = PARAMS.DEFAULT_PARAMS;
    const dt = 1 / params.physicsHz;
    let state = makeFreshState(params);
    const action = PHYS.makeAction();

    // Tap / click anywhere to reset (drop ball again).
    function reset() {
      state = makeFreshState(params);
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      reset();
    }, { passive: false });

    // Accumulator loop. Cap accumulator to avoid "spiral of death" if a
    // tab is backgrounded and dt jumps to many seconds.
    let lastNow = performance.now();
    let accumulator = 0;
    const MAX_ACCUM = 0.25;        // seconds; clamp to avoid catastrophe

    function frame(now) {
      fpsTick(now);
      let elapsed = (now - lastNow) / 1000;
      lastNow = now;
      if (elapsed > MAX_ACCUM) elapsed = MAX_ACCUM;
      accumulator += elapsed;
      let safety = 1000;
      while (accumulator >= dt && safety-- > 0) {
        PHYS.step(state, action, params, dt);
        accumulator -= dt;
      }
      const cssW = canvas.width / (window.devicePixelRatio || 1);
      const cssH = canvas.height / (window.devicePixelRatio || 1);
      REND.render(ctx, state, params, cssW, cssH);
      updateStatus(state);
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
