/*
 * replay.js -- recording + summarization of physics sessions.
 *
 * Two responsibilities:
 *   1. Capture enough information per session that the agent (Claude) can
 *      DETERMINISTICALLY REPRODUCE what the user saw on their phone:
 *      initial state, parameter set, full action timeline, plus a snapshot
 *      of state at every meaningful event (bounce, reset, contact).
 *   2. Compute summary statistics that are useful at-a-glance for
 *      diagnosis ("ball bounced 7 times, peak height 1820, average bounce
 *      decay factor 0.62, hit speed cap 0 times, etc.").
 *
 * Architectural notes:
 *   - DOM-free. Module operates on plain objects + numbers; the UI layer
 *     calls it.
 *   - Ring-buffered: bounded memory regardless of session length. Default
 *     keeps the last ~60 seconds at 120 Hz physics + the most recent 200
 *     events. Old entries fall off the back when the buffer fills.
 *   - Captures the ENTIRE parameter set at session start. If params
 *     change mid-session (slider tuning), a `params_changed` event is
 *     emitted into the timeline -- so the agent can see exactly when
 *     the user tweaked what.
 *
 * Schema of one recording:
 *   {
 *     id, startedAt,                            // ISO timestamp + epoch
 *     paramsAtStart: {...},                     // full param snapshot
 *     initialState: {...},                      // physics state at t=0
 *     events: [                                 // ring-buffered
 *       { t, type, payload }
 *     ],
 *     summary: {...},                           // computed by summarize()
 *   }
 *
 * Event types we record:
 *   - reset           (user tapped to reset)
 *   - params_changed  (slider moved, before/after diff)
 *   - bounce_floor    (ball y-velocity sign flipped at floor)
 *   - bounce_ceiling, bounce_left, bounce_right
 *   - frame_snapshot  (every Nth frame, e.g. 6 per second)
 *   - note            (user freetext)
 */

(function (root) {
  'use strict';

  const DEFAULT_MAX_EVENTS = 4000;
  const DEFAULT_SNAPSHOT_HZ = 6;            // 6 state samples per second
  const DEFAULT_REWIND_SECONDS = 60;        // ring window in seconds

  function nowIso() { return new Date().toISOString(); }

  /**
   * Create a recorder. Call .observe(state, action, params) once per
   * physics step. The recorder figures out what's interesting to log.
   */
  function makeRecorder(opts) {
    opts = opts || {};
    const maxEvents = opts.maxEvents || DEFAULT_MAX_EVENTS;
    const snapshotHz = opts.snapshotHz || DEFAULT_SNAPSHOT_HZ;
    const rewindSeconds = opts.rewindSeconds || DEFAULT_REWIND_SECONDS;

    let id = _shortId();
    let startedAt = nowIso();
    let paramsAtStart = null;
    let initialState = null;
    let events = [];
    let lastSnapshotT = -Infinity;
    let prevState = null;
    let prevParams = null;
    let stepCount = 0;

    function _shortId() {
      // 8-char base36 from timestamp (no Math.random for portability).
      const t = (typeof performance !== 'undefined'
                 && performance.now ? performance.now() : Date.now());
      return Math.floor(t * 1000 % 1e10).toString(36);
    }

    function _push(ev) {
      events.push(ev);
      // Ring-trim: keep events from at most rewindSeconds ago AND cap count.
      const cutoff = ev.t - rewindSeconds;
      while (events.length && events[0].t < cutoff) events.shift();
      while (events.length > maxEvents) events.shift();
    }

    function _snapshotState(state) {
      // Plain-object snapshot for serialization. Only what we need.
      const c = state.car, b = state.ball;
      return {
        car: {
          pos: { x: round(c.pos.x), y: round(c.pos.y) },
          vel: { x: round(c.vel.x), y: round(c.vel.y) },
          heading: round(c.heading, 5),
          angVel: round(c.angVel, 5),
          grounded: !!c.grounded,
          boost: round(c.boost, 2),
        },
        ball: {
          pos: { x: round(b.pos.x), y: round(b.pos.y) },
          vel: { x: round(b.vel.x), y: round(b.vel.y) },
          angVel: round(b.angVel, 5),
        },
      };
    }

    function round(v, digits) {
      if (v == null || !isFinite(v)) return v;
      const d = digits == null ? 2 : digits;
      const m = Math.pow(10, d);
      return Math.round(v * m) / m;
    }

    function _shallowDiff(before, after) {
      const diff = {};
      for (const k of Object.keys(after)) {
        if (before[k] !== after[k]) {
          diff[k] = { before: before[k], after: after[k] };
        }
      }
      return diff;
    }

    function reset(params, state) {
      id = _shortId();
      startedAt = nowIso();
      paramsAtStart = JSON.parse(JSON.stringify(params));
      initialState = _snapshotState(state);
      events = [];
      lastSnapshotT = -Infinity;
      prevState = _snapshotState(state);
      prevParams = paramsAtStart;
      stepCount = 0;
      _push({ t: 0, type: 'reset', payload: { id: id } });
    }

    function noteParamChange(newParams, currentT) {
      if (!prevParams) { prevParams = newParams; return; }
      const diff = _shallowDiff(prevParams, newParams);
      if (Object.keys(diff).length === 0) return;
      _push({ t: round(currentT, 4), type: 'params_changed', payload: diff });
      prevParams = JSON.parse(JSON.stringify(newParams));
    }

    /**
     * Observe one physics tick. Detect bounces by velocity-sign change on
     * the relevant axis, log periodic snapshots, etc.
     */
    function observe(state, action, params) {
      stepCount++;
      const t = state.t;

      // Snapshot pacing.
      if (t - lastSnapshotT >= 1 / snapshotHz) {
        lastSnapshotT = t;
        _push({ t: round(t, 4), type: 'frame_snapshot',
                payload: _snapshotState(state) });
      }

      // Bounce detection from the previous step.
      if (prevState) {
        const pv = prevState.ball.vel, nv = state.ball.vel;
        const pp = prevState.ball.pos, np = state.ball.pos;
        const r = params.ballRadius;
        if (pv.y < 0 && nv.y > 0 && np.y < r * 1.5) {
          _push({ t: round(t, 4), type: 'bounce_floor',
                  payload: { vyBefore: round(pv.y), vyAfter: round(nv.y),
                             height: round(pp.y) } });
        } else if (pv.y > 0 && nv.y < 0 && np.y > params.arenaHeight - r * 1.5) {
          _push({ t: round(t, 4), type: 'bounce_ceiling',
                  payload: { vyBefore: round(pv.y), vyAfter: round(nv.y) } });
        }
        if (pv.x < 0 && nv.x > 0 && np.x < r * 1.5) {
          _push({ t: round(t, 4), type: 'bounce_left',
                  payload: { vxBefore: round(pv.x), vxAfter: round(nv.x) } });
        } else if (pv.x > 0 && nv.x < 0 && np.x > params.arenaWidth - r * 1.5) {
          _push({ t: round(t, 4), type: 'bounce_right',
                  payload: { vxBefore: round(pv.x), vxAfter: round(nv.x) } });
        }
      }
      prevState = _snapshotState(state);
    }

    /** Annotate the recording with a user-typed note. */
    function note(text, currentT) {
      _push({ t: round(currentT, 4), type: 'note',
              payload: { text: String(text || '') } });
    }

    /**
     * Compute summary stats from current events. Cheap; safe to call every
     * second for live-HUD readout if desired.
     */
    function summarize() {
      const bounces = events.filter((e) => e.type.startsWith('bounce_'));
      const floors = bounces.filter((e) => e.type === 'bounce_floor');
      let peakBounceHeight = -Infinity;
      let firstFloorVy = null;
      let lastFloorVy = null;
      const bounceDecay = [];
      for (const ev of floors) {
        if (ev.payload.height > peakBounceHeight) {
          peakBounceHeight = ev.payload.height;
        }
        if (firstFloorVy == null) firstFloorVy = Math.abs(ev.payload.vyBefore);
        lastFloorVy = Math.abs(ev.payload.vyBefore);
        bounceDecay.push(Math.abs(ev.payload.vyAfter) /
                         Math.max(1e-6, Math.abs(ev.payload.vyBefore)));
      }
      const avgDecay = bounceDecay.length
        ? bounceDecay.reduce((a, b) => a + b, 0) / bounceDecay.length
        : null;

      return {
        steps: stepCount,
        events: events.length,
        bounces: {
          floor: floors.length,
          ceiling: bounces.filter((e) => e.type === 'bounce_ceiling').length,
          left: bounces.filter((e) => e.type === 'bounce_left').length,
          right: bounces.filter((e) => e.type === 'bounce_right').length,
        },
        firstFloorBounceVy: firstFloorVy,
        lastFloorBounceVy: lastFloorVy,
        avgFloorBounceDecay: avgDecay != null ? round(avgDecay, 3) : null,
        peakBounceHeight: isFinite(peakBounceHeight)
          ? round(peakBounceHeight) : null,
        windowSeconds: events.length
          ? round(events[events.length - 1].t - events[0].t, 3) : 0,
      };
    }

    function snapshot() {
      return {
        id: id,
        startedAt: startedAt,
        paramsAtStart: paramsAtStart,
        initialState: initialState,
        events: events.slice(),
        summary: summarize(),
      };
    }

    return {
      reset: reset,
      noteParamChange: noteParamChange,
      observe: observe,
      note: note,
      summarize: summarize,
      snapshot: snapshot,
    };
  }

  const exports = {
    makeRecorder: makeRecorder,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  if (root) root.REPLAY = exports;
})(typeof window !== 'undefined' ? window : null);
