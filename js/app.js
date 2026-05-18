/*
 * app.js -- Milestone 0 entry point.
 *
 * Responsibilities for M0:
 *   - Register the service worker (PWA installability).
 *   - Set up the canvas at device pixel ratio.
 *   - Run a minimal render loop that clears the canvas, draws the M0 banner,
 *     and updates the FPS counter in #fps-line.
 *
 * No physics. No input. No game state. Those land in later milestones.
 *
 * Architectural guardrails (carry forward into later milestones, per
 * directives/app_build.md):
 *   - Vanilla JS, classic script tag, no ES modules.
 *   - All future modules attach to window globals (e.g. window.PHYS).
 *   - physics.js (to be added in M1) MUST remain DOM-free.
 *   - Render loop and physics loop will be DECOUPLED via accumulator pattern
 *     starting M1+; M0 is render-only so plain rAF is fine.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Service worker registration
  // ---------------------------------------------------------------------

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[ss-sandbox] Service workers not supported.');
      return;
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .then((reg) => {
          console.log('[ss-sandbox] SW registered, scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[ss-sandbox] SW registration failed:', err);
        });
    });
  }

  // ---------------------------------------------------------------------
  // Canvas setup with devicePixelRatio
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // FPS tracker (EMA over last 30 frames for stable readout)
  // ---------------------------------------------------------------------

  function makeFpsTracker(updateEveryMs) {
    let lastT = performance.now();
    let emaFps = 60;
    let lastUiUpdate = 0;
    const el = document.getElementById('fps-line');
    const alpha = 0.1; // EMA smoothing factor
    return function tick(now) {
      const dt = now - lastT;
      lastT = now;
      if (dt > 0) {
        const inst = 1000 / dt;
        emaFps = alpha * inst + (1 - alpha) * emaFps;
      }
      if (now - lastUiUpdate > updateEveryMs) {
        lastUiUpdate = now;
        if (el) el.textContent = 'FPS: ' + emaFps.toFixed(1);
      }
    };
  }

  // ---------------------------------------------------------------------
  // Render loop -- M0 placeholder
  // ---------------------------------------------------------------------

  function startRenderLoop(ctx, canvas, fpsTrackerTick) {
    function frame(now) {
      fpsTrackerTick(now);

      // Clear in CSS pixel space (setTransform already scaled by DPR).
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);

      // Background
      ctx.fillStyle = '#0b1115';
      ctx.fillRect(0, 0, w, h);

      // Center text -- M0 visual proof of life.
      ctx.fillStyle = '#1d2a36';
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.fillStyle = '#e8eef5';
      ctx.font = '600 22px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Sideswipe Physics Sandbox', w / 2, h / 2 - 18);
      ctx.font = '400 14px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#9eb2c6';
      ctx.fillText('Milestone 0 — PWA shell installed', w / 2, h / 2 + 16);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function boot() {
    const { canvas, ctx } = setupCanvas();
    const fpsTick = makeFpsTracker(250);
    startRenderLoop(ctx, canvas, fpsTick);
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
