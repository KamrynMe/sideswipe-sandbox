/*
 * physics.js -- PURE physics engine for the Sideswipe sandbox.
 *
 * LOAD-BEARING INVARIANTS (do not violate; audit at every milestone):
 *   1. NO DOM access. No `document`, `window`, `requestAnimationFrame`,
 *      `Image`, `Audio`, `localStorage`, `navigator`, `performance`.
 *      This module must `require()` in Node with zero errors. That is
 *      the Phase 2 portability test -- the Python port will mirror this
 *      file 1:1.
 *   2. NO non-determinism. No `Math.random()` (any randomness must be a
 *      seeded generator passed in via params). No `Date.now()` or
 *      `performance.now()`. Same inputs -> same outputs, every time.
 *   3. NO global state mutation. Every step takes (state, action, params)
 *      and returns a new state (or mutates a state object that the caller
 *      owns). The module exports functions; it stores no state itself.
 *   4. Fixed timestep. The caller passes dt; we never derive it internally.
 *      The accumulator pattern lives in app.js's render loop, not here.
 *
 * Milestone 1 scope (this file, current commit):
 *   - State factory: makeState({...overrides}) -> { car, ball, t }
 *   - step(state, action, params, dt): integrates kinematics + gravity,
 *     clamps car/ball to arena, applies axis-aligned floor/ceiling/wall
 *     bounce (rounded corners come in M5, contact physics in M6).
 *   - Smoke-testable: free-fall integrates to 0.5*g*t^2 within rounding.
 *
 * Coordinate convention: math-standard, X right, Y UP, gravity pulls -Y.
 * Heading in radians, 0 = facing +X. Renderer is the one that flips Y for
 * canvas (canvas Y grows down). DO NOT bake canvas conventions into this
 * file.
 */

(function (root) {
  'use strict';

  // -------------------------------------------------------------------
  // Action object schema (mirrors directives/physics_spec.md)
  // -------------------------------------------------------------------
  //   action = {
  //     dpad: { x, y },           // each in [-1, 1]
  //     jump: bool,               // held
  //     boostedJump: bool,        // held (compound = jump + boost)
  //     boost: bool,              // held (boost alone)
  //     flip180: bool,            // edge-triggered (caller dedups)
  //     airRollToggle: bool,      // edge-triggered (caller dedups)
  //   }
  // -------------------------------------------------------------------

  /**
   * Construct a fresh action object with all controls neutral.
   * Useful for headless tests and as a base for partial overrides.
   */
  function makeAction(overrides) {
    const a = {
      dpad: { x: 0, y: 0 },
      jump: false,
      boostedJump: false,
      boost: false,
      flip180: false,
      airRollToggle: false,
    };
    if (overrides) {
      if (overrides.dpad) {
        a.dpad.x = overrides.dpad.x || 0;
        a.dpad.y = overrides.dpad.y || 0;
      }
      for (const k of ['jump','boostedJump','boost','flip180','airRollToggle']) {
        if (k in overrides) a[k] = !!overrides[k];
      }
    }
    return a;
  }

  /**
   * Construct a fresh simulation state with default-ish positions.
   * Caller supplies params (or undefined; we'll use sensible fallbacks
   * for arena center positioning). The returned state is a plain
   * object the caller owns and mutates via step().
   *
   * State shape:
   *   {
   *     t: 0,                                         // seconds since start
   *     car: {
   *       pos: {x, y}, vel: {x, y},
   *       heading, angVel,
   *       boost, grounded, aerialJumpAvailable,
   *       flipCooldown, flipInProgress, flipProgress,
   *       airRollOn,
   *     },
   *     ball: {
   *       pos: {x, y}, vel: {x, y}, angVel,
   *     },
   *     lastContact: null,                            // populated by M6
   *   }
   */
  function makeState(overrides, params) {
    const p = params || {};
    const aw = p.arenaWidth || 4096;
    const ah = p.arenaHeight || 2048;
    const carH = p.carHeight || 80;
    const ballR = p.ballRadius || 80;
    const boostMax = (p.boostMax != null) ? p.boostMax : 100;

    // Car: midfield, on the floor, facing right.
    // Ball: centered horizontally, dropped from upper area.
    const state = {
      t: 0,
      car: {
        pos: { x: aw * 0.30, y: carH / 2 },
        vel: { x: 0, y: 0 },
        heading: 0,
        angVel: 0,
        boost: boostMax * 0.33,
        grounded: true,
        aerialJumpAvailable: false,
        flipCooldown: 0,
        flipInProgress: false,
        flipProgress: 0,
        airRollOn: false,
      },
      ball: {
        pos: { x: aw * 0.50, y: ah * 0.75 },
        vel: { x: 0, y: 0 },
        angVel: 0,
      },
      lastContact: null,
    };

    if (overrides) {
      _mergeInto(state, overrides);
    }
    return state;
  }

  function _mergeInto(target, src) {
    for (const k of Object.keys(src)) {
      const sv = src[k];
      if (sv !== null && typeof sv === 'object' && !Array.isArray(sv)
          && k in target && typeof target[k] === 'object') {
        _mergeInto(target[k], sv);
      } else {
        target[k] = sv;
      }
    }
  }

  function _clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  /**
   * Integrate one fixed timestep.
   *
   * M1 mechanics (this commit):
   *   - Ball: gravity, linear drag, angular drag, position integration,
   *     speed cap, axis-aligned bounce off floor/ceiling/walls with
   *     restitution (rounded corners deferred to M5).
   *   - Car: position integration, axis-aligned arena clamp, grounded
   *     flag refresh. No driving / no jump / no rotation yet -- those
   *     come in M3+. Caller can still pre-set car velocity for tests.
   *
   * Returns the same state object (mutated). Caller owns the state.
   */
  function step(state, action, params, dt) {
    if (!state || !params || typeof dt !== 'number' || dt <= 0) {
      throw new Error('physics.step: invalid args');
    }
    _stepBall(state, params, dt);
    _stepCar(state, params, dt);
    state.t += dt;
    return state;
  }

  function _stepBall(state, p, dt) {
    const b = state.ball;

    // Continuous integration: gravity, drag, angular drag.
    b.vel.y += -p.gravity * dt;
    // Drag as exponential decay per second (clamp to non-negative factor).
    const linDecay = Math.max(0, 1 - p.ballDrag * dt);
    const angDecay = Math.max(0, 1 - p.ballAngularDrag * dt);
    b.vel.x *= linDecay;
    b.vel.y *= linDecay;
    b.angVel *= angDecay;

    // Speed cap.
    const sp = Math.hypot(b.vel.x, b.vel.y);
    if (sp > p.ballSpeedCap && sp > 0) {
      const s = p.ballSpeedCap / sp;
      b.vel.x *= s;
      b.vel.y *= s;
    }

    // Position integrate.
    b.pos.x += b.vel.x * dt;
    b.pos.y += b.vel.y * dt;

    // Axis-aligned bounce off floor / ceiling / walls.
    // (Rounded corners + goal openings land in M5.)
    const r = p.ballRadius;
    const e = p.ballRestitution;
    if (b.pos.y - r < 0 && b.vel.y < 0) {
      b.pos.y = r;
      b.vel.y = -b.vel.y * e;
    } else if (b.pos.y + r > p.arenaHeight && b.vel.y > 0) {
      b.pos.y = p.arenaHeight - r;
      b.vel.y = -b.vel.y * e;
    }
    if (b.pos.x - r < 0 && b.vel.x < 0) {
      b.pos.x = r;
      b.vel.x = -b.vel.x * e;
    } else if (b.pos.x + r > p.arenaWidth && b.vel.x > 0) {
      b.pos.x = p.arenaWidth - r;
      b.vel.x = -b.vel.x * e;
    }
  }

  function _stepCar(state, p, dt) {
    const c = state.car;
    // M1: passive integration only. No driving/jump/rotation yet.
    c.pos.x += c.vel.x * dt;
    c.pos.y += c.vel.y * dt;
    if (!c.grounded) {
      c.vel.y += -p.gravity * dt;
    }

    // Arena clamp (axis-aligned).
    const halfW = p.carWidth / 2;
    const halfH = p.carHeight / 2;
    c.pos.x = _clamp(c.pos.x, halfW, p.arenaWidth - halfW);
    if (c.pos.y - halfH <= 0) {
      c.pos.y = halfH;
      if (c.vel.y < 0) c.vel.y = 0;
      c.grounded = true;
      c.aerialJumpAvailable = false;
    } else {
      c.grounded = false;
    }
    if (c.pos.y + halfH >= p.arenaHeight) {
      c.pos.y = p.arenaHeight - halfH;
      if (c.vel.y > 0) c.vel.y = 0;
    }

    // Tick down flip cooldown (no-op in M1 but harmless).
    if (c.flipCooldown > 0) {
      c.flipCooldown = Math.max(0, c.flipCooldown - dt);
    }
  }

  /**
   * Run N fixed steps and return the final state. Useful for headless
   * smoke tests.
   */
  function simulate(initialState, actionStream, params, dt, nSteps) {
    let state = initialState;
    for (let i = 0; i < nSteps; i++) {
      const action = (typeof actionStream === 'function')
        ? actionStream(i, state) : actionStream;
      state = step(state, action || makeAction(), params, dt);
    }
    return state;
  }

  // -------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------
  const exports = {
    makeAction: makeAction,
    makeState: makeState,
    step: step,
    simulate: simulate,
    // Versioning so saved replays can tag the physics they were played
    // under. Bump when behavior changes (M2+).
    VERSION: 1,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
  if (root) {
    root.PHYS = exports;
  }
})(typeof window !== 'undefined' ? window : null);
