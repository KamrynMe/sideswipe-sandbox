/*
 * renderer.js -- canvas-2D rendering of physics state.
 *
 * Pure presentation: takes (ctx, state, params, viewport) and draws.
 * Reads physics state; never mutates it. Knows about canvas, world->screen
 * transform, and visual styling -- nothing else.
 *
 * Coordinate handling:
 *   - physics uses standard math (X right, Y UP, gravity -Y)
 *   - canvas Y grows DOWN
 *   - this module is the only place that flips Y. physics.js MUST NOT
 *     know about canvas.
 *
 * View fit:
 *   - The arena is fit-letterboxed into the viewport at uniform scale.
 *   - On phones the canvas covers the whole screen; the world is centered
 *     with black bars filling any unused canvas region.
 */

(function (root) {
  'use strict';

  /**
   * Compute the world->screen transform for letterboxed fit.
   * Returns { scale, offsetX, offsetY } such that:
   *   screen_x = offsetX + world_x * scale
   *   screen_y = offsetY + (arenaHeight - world_y) * scale   // Y flip
   */
  function computeFit(cssW, cssH, p) {
    const sx = cssW / p.arenaWidth;
    const sy = cssH / p.arenaHeight;
    const scale = Math.min(sx, sy);
    const usedW = p.arenaWidth * scale;
    const usedH = p.arenaHeight * scale;
    return {
      scale: scale,
      offsetX: (cssW - usedW) / 2,
      offsetY: (cssH - usedH) / 2,
      cssW: cssW,
      cssH: cssH,
    };
  }

  /** world coords -> canvas pixel coords (Y flipped) */
  function w2s(fit, p, wx, wy) {
    return {
      x: fit.offsetX + wx * fit.scale,
      y: fit.offsetY + (p.arenaHeight - wy) * fit.scale,
    };
  }

  function drawBackground(ctx, fit, p) {
    // Letterbox background (deep navy).
    ctx.fillStyle = '#0b1115';
    ctx.fillRect(0, 0, fit.cssW, fit.cssH);

    // Arena interior (slightly lighter, matches the "grey arena" palette).
    ctx.fillStyle = '#1b2530';
    ctx.fillRect(fit.offsetX, fit.offsetY,
                 p.arenaWidth * fit.scale, p.arenaHeight * fit.scale);

    // Subtle grid (every 256 world units).
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 256;
    ctx.beginPath();
    for (let x = step; x < p.arenaWidth; x += step) {
      const s = w2s(fit, p, x, 0);
      const e = w2s(fit, p, x, p.arenaHeight);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
    for (let y = step; y < p.arenaHeight; y += step) {
      const s = w2s(fit, p, 0, y);
      const e = w2s(fit, p, p.arenaWidth, y);
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
    ctx.restore();

    // Arena border (axis-aligned for now; rounded corners come in M5).
    ctx.strokeStyle = '#3a4d62';
    ctx.lineWidth = Math.max(2, 4 * fit.scale);
    ctx.strokeRect(fit.offsetX, fit.offsetY,
                   p.arenaWidth * fit.scale, p.arenaHeight * fit.scale);

    // Floor line accent.
    ctx.strokeStyle = '#4a6378';
    ctx.lineWidth = Math.max(2, 4 * fit.scale);
    const f1 = w2s(fit, p, 0, 0);
    const f2 = w2s(fit, p, p.arenaWidth, 0);
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.stroke();
  }

  function drawCar(ctx, fit, p, state) {
    const c = state.car;
    const center = w2s(fit, p, c.pos.x, c.pos.y);
    const w = p.carWidth * fit.scale;
    const h = p.carHeight * fit.scale;
    ctx.save();
    ctx.translate(center.x, center.y);
    // physics heading: 0 = +X. canvas Y is flipped, so rotate by -heading.
    ctx.rotate(-c.heading);

    // Body (rounded rect).
    const r = Math.min(w, h) * 0.18;
    ctx.fillStyle = '#e8eef5';
    _roundRect(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fill();

    // Nose marker (front edge).
    ctx.fillStyle = '#48b6ff';
    ctx.fillRect(w / 2 - Math.max(2, w * 0.08), -h / 2,
                 Math.max(2, w * 0.08), h);
    ctx.restore();
  }

  function _roundRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawBall(ctx, fit, p, state) {
    const b = state.ball;
    const c = w2s(fit, p, b.pos.x, b.pos.y);
    const r = p.ballRadius * fit.scale;

    // Ball body.
    ctx.fillStyle = '#f1d27a';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Spin indicator: a small dot offset by the spin direction. Rotates
    // with angVel so you can see the ball spinning. Sign: physics angVel
    // positive = CCW; canvas Y is flipped so we negate.
    const spinAngle = -b.angVel * 0.0;   // placeholder; M6 will animate spin
    const dotR = r * 0.18;
    const dx = Math.cos(spinAngle) * r * 0.55;
    const dy = Math.sin(spinAngle) * r * 0.55;
    ctx.fillStyle = '#c98f29';
    ctx.beginPath();
    ctx.arc(c.x + dx, c.y + dy, dotR, 0, Math.PI * 2);
    ctx.fill();

    // Outline.
    ctx.strokeStyle = '#9a7615';
    ctx.lineWidth = Math.max(1, 2 * fit.scale);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Top-level draw call. Caller supplies ctx + state + params + cssW/cssH.
   */
  function render(ctx, state, params, cssW, cssH) {
    const fit = computeFit(cssW, cssH, params);
    drawBackground(ctx, fit, params);
    drawBall(ctx, fit, params, state);
    drawCar(ctx, fit, params, state);
  }

  const exports = {
    render: render,
    computeFit: computeFit,
    w2s: w2s,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
  if (root) {
    root.REND = exports;
  }
})(typeof window !== 'undefined' ? window : null);
