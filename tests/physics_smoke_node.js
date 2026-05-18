/*
 * physics_smoke_node.js -- M1 acceptance test.
 *
 * Two checks:
 *   1. physics.js + params.js require() cleanly under Node with ZERO
 *      browser APIs available. (The Phase 2 portability test.)
 *   2. A dropped ball under gravity integrates within tolerance of the
 *      analytic free-fall solution: y(t) = y0 - 0.5*g*t^2 (assuming
 *      no drag and no surface contact).
 *
 * Run: node app/tests/physics_smoke_node.js
 * Exit 0 = pass, non-zero = fail.
 */
'use strict';

// -------------------------------------------------------------------
// 1. Import test: physics.js + params.js must require() cleanly under
//    Node. (Node 21+ exposes `navigator` etc. as globals, so we can't
//    sandbox via global-absence -- the source-level audit in step 2
//    is the actual purity guarantee.)
// -------------------------------------------------------------------
const PHYS = require('../js/physics.js');
const PARAMS = require('../js/params.js');

console.log('require()d physics.js v' + PHYS.VERSION);
console.log('require()d params.js with', Object.keys(PARAMS.DEFAULT_PARAMS).length, 'fields');

// -------------------------------------------------------------------
// 2. Source-level audit: read physics.js and grep for forbidden tokens.
// -------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'physics.js'), 'utf8');
const banned = [
  /\bdocument\b/, /\bwindow\.(?!devicePixel)/, /\brequestAnimationFrame\b/,
  /\blocalStorage\b/, /\bperformance\.now\b/, /\bDate\.now\b/,
  /\bMath\.random\b/, /\bnavigator\b/,
];
let bannedHits = 0;
for (const re of banned) {
  // Allow these tokens only inside comments (handled by stripping
  // comments before matching).
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (re.test(stripped)) {
    console.error('  FAIL: physics.js references banned token:', re);
    bannedHits++;
  }
}
if (bannedHits === 0) {
  console.log('source-level purity audit: OK (no DOM/random/time refs in physics.js)');
} else {
  process.exit(3);
}

// -------------------------------------------------------------------
// 3. Free-fall integration test.
//    Ball at y0 in midair (well clear of ceiling/floor), v=0, no drag.
//    Step at dt=1/120 for N steps. Compare to analytic y0 - 0.5*g*t^2.
// -------------------------------------------------------------------
const p = PARAMS.withOverrides({
  // Disable drag for clean analytic comparison.
  ballDrag: 0,
  ballAngularDrag: 0,
});

const dt = 1 / p.physicsHz;
const ySimStart = p.arenaHeight * 0.6;       // well below ceiling
const state = PHYS.makeState({
  ball: {
    pos: { x: p.arenaWidth * 0.5, y: ySimStart },
    vel: { x: 0, y: 0 },
    angVel: 0,
  },
}, p);

const nSteps = 30;                            // 0.25 s of simulation
const action = PHYS.makeAction();
let s = state;
for (let i = 0; i < nSteps; i++) {
  s = PHYS.step(s, action, p, dt);
}
const tElapsed = nSteps * dt;
const ySimEnd = s.ball.pos.y;
const yAnalytic = ySimStart - 0.5 * p.gravity * tElapsed * tElapsed;

// Tolerance: explicit-Euler integration of constant gravity accumulates
// a small bias proportional to g*dt^2*N/2. For our values:
//   bias ~ 0.5 * 1500 * (1/120)^2 * 30 ~ 0.78 world units
// Allow 2.0 units of slack to be safe.
const err = Math.abs(ySimEnd - yAnalytic);
const tol = 2.0;
console.log('free-fall test:');
console.log('  start y           = ' + ySimStart.toFixed(4));
console.log('  steps             = ' + nSteps + ' x dt=' + dt.toFixed(6));
console.log('  elapsed t         = ' + tElapsed.toFixed(4) + ' s');
console.log('  sim y             = ' + ySimEnd.toFixed(4));
console.log('  analytic y        = ' + yAnalytic.toFixed(4));
console.log('  abs error         = ' + err.toFixed(4) + ' (tol ' + tol + ')');
if (err > tol) {
  console.error('FAIL: free-fall integration exceeded tolerance');
  process.exit(4);
}

// -------------------------------------------------------------------
// 4. Floor bounce test.
//    Drop ball from height; after enough time, ball must end up above
//    the floor and have positive vy at least once.
// -------------------------------------------------------------------
const s2 = PHYS.makeState({
  ball: {
    pos: { x: p.arenaWidth * 0.5, y: p.ballRadius + 200 },
    vel: { x: 0, y: 0 },
    angVel: 0,
  },
}, p);
let sawBounce = false;
let cur = s2;
for (let i = 0; i < 1000; i++) {
  const prevVy = cur.ball.vel.y;
  cur = PHYS.step(cur, action, p, dt);
  if (prevVy < 0 && cur.ball.vel.y > 0) sawBounce = true;
  if (cur.ball.pos.y < p.ballRadius - 1e-3) {
    console.error('FAIL: ball penetrated floor at step', i, 'y=', cur.ball.pos.y);
    process.exit(5);
  }
}
if (!sawBounce) {
  console.error('FAIL: ball never bounced off floor in 1000 steps');
  process.exit(6);
}
console.log('floor bounce test: OK (ball bounced and never penetrated)');

// -------------------------------------------------------------------
// 5. Determinism test: same inputs -> identical state.
// -------------------------------------------------------------------
function runOnce() {
  let s = PHYS.makeState({
    ball: { pos: { x: 100, y: 1500 }, vel: { x: 200, y: 300 }, angVel: 0.5 },
  }, p);
  for (let i = 0; i < 500; i++) s = PHYS.step(s, action, p, dt);
  return s;
}
const r1 = runOnce();
const r2 = runOnce();
const same =
  r1.ball.pos.x === r2.ball.pos.x &&
  r1.ball.pos.y === r2.ball.pos.y &&
  r1.ball.vel.x === r2.ball.vel.x &&
  r1.ball.vel.y === r2.ball.vel.y;
if (!same) {
  console.error('FAIL: non-determinism detected', r1.ball, r2.ball);
  process.exit(7);
}
console.log('determinism test: OK (two independent runs produced bit-identical state)');

console.log('');
console.log('ALL SMOKE TESTS PASS (M1 acceptance)');
process.exit(0);
