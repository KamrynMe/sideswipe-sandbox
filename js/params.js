/*
 * params.js -- the single versioned parameter object for the physics engine.
 *
 * EVERY tunable value in the simulation lives here. Nothing tunable should
 * be hardcoded anywhere else (physics.js, renderer.js, input.js, ui.js).
 * This is load-bearing per directives/app_build.md guardrail #5: parameter
 * sets are first-class data, named/saveable/loadable/exportable.
 *
 * Initial values are starting estimates from directives/physics_spec.md.
 * The user tunes them live via the parameter panel in M8+. The signed-off
 * final values get exported as physics_params_v1.json at M10 -- the Phase 2
 * handoff artifact.
 *
 * Coordinate convention (PHYSICS INTERNAL): standard math; X right, Y UP,
 * gravity pulls -Y. Renderer flips Y for canvas display.
 */

(function (root) {
  'use strict';

  const DEFAULT_PARAMS = Object.freeze({
    // Metadata
    version: 1,
    name: 'default-v1',

    // ---- Arena ----
    arenaWidth:     4096,    // world units
    arenaHeight:    2048,
    cornerRadius:    256,
    goalWidth:       800,    // height of the goal opening (vertical span on left/right walls)
    goalBottomY:     400,    // bottom edge of goal opening (Y up)
    goalTopY:       1200,    // top edge of goal opening

    // ---- Car ----
    carWidth:        200,
    carHeight:        80,
    carMass:           1,
    carBoostAccel:  1500,    // when boost held
    carDriveAccel:   800,    // when d-pad horizontal held, no boost
    carTopSpeed:    2300,
    carFriction:     0.6,    // velocity-proportional drag on the ground

    // ---- Jump ----
    jumpImpulse:     600,    // vy delta on ground jump
    aerialJumpImpulse: 500,  // vy delta on aerial jump

    // ---- Rotation PD controller (MOST FRAGILE) ----
    rotationStiffness: 25,
    rotationDamping:    8,

    // ---- 180-degree flip ----
    flipDuration:    0.1,    // seconds for heading += pi to complete
    flipCooldown:    0.5,    // seconds before another flip allowed

    // ---- Auto-orient ----
    autoOrientProximity: 100,    // pixel-distance to nearest surface

    // ---- Ball ----
    ballRadius:         80,
    ballMass:          0.5,
    ballRestitution:   0.7,
    ballDrag:         0.05,    // per second (continuous)
    ballAngularDrag:  0.10,
    ballSpeedCap:    4000,
    ballSpinTransfer: 0.3,
    ballMagnus:    0.0001,

    // ---- Gravity ----
    gravity:        1500,    // world units / s^2, pulls -Y

    // ---- Boost ----
    boostMax:           100,
    boostUseRate:        33, // per second while boosting
    boostFloorRegen:      5, // per second while grounded and not boosting
    ballBottomBoostGain: 20, // on ball-bottom contact
    whiteShotBoostGain:  30, // on white-shot trigger

    // ---- Car-ball contact ----
    contactRestitution: 0.5,
    spinTransferCoeff:  0.3,
    shotPowerMultiplier: 1.0,

    // ---- Simulation ----
    physicsHz:        120,   // fixed timestep frequency
  });

  /**
   * Deep-clone-with-overrides factory. Returns a NEW frozen object so
   * call sites can't mutate the active set in place. Use this whenever
   * you need a modified parameter set (e.g., user slider change).
   */
  function withOverrides(overrides) {
    const merged = Object.assign({}, DEFAULT_PARAMS, overrides || {});
    return Object.freeze(merged);
  }

  /**
   * Validate a parameter set has all required keys. Returns array of
   * missing keys (empty if OK). Useful when loading from JSON.
   */
  function missingKeys(params) {
    const keys = Object.keys(DEFAULT_PARAMS);
    const missing = [];
    for (const k of keys) {
      if (!(k in params)) missing.push(k);
    }
    return missing;
  }

  const exports = {
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    withOverrides: withOverrides,
    missingKeys: missingKeys,
  };

  // Dual export: window global for the browser, CommonJS for Node tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  }
  if (root) {
    root.PARAMS = exports;
  }
})(typeof window !== 'undefined' ? window : null);
