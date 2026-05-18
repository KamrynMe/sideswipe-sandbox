/*
 * diagnostics.js -- compose the single JSON blob the user copies and
 * pastes into chat. Optimized for AGENT-SIDE ANALYSIS, not human reading.
 *
 * Design goals:
 *   - Self-describing. The agent on the other end may have ZERO context
 *     about which milestone is live, what params shipped as defaults,
 *     how the schema works. The blob carries enough metadata to be
 *     interpreted cold.
 *   - Reproducible. Includes the full param set, initial state, and
 *     event timeline so the agent can REPLAY the session deterministically
 *     by piping the events through physics.js.
 *   - Diagnostic. Pre-computes summary stats so quick-feel questions
 *     ("why are bounces dying so fast?") can be answered without
 *     re-deriving from the raw events.
 *   - Robust to schema drift. Includes physics.VERSION + params.version
 *     so older blobs can still be interpreted after upgrades.
 *
 * Privacy: no personal data, no IP, no user agent details beyond device
 * pixel ratio + screen dims + iOS-or-not. Nothing leaves the phone except
 * by user explicit copy.
 */

(function (root) {
  'use strict';

  function nowIso() { return new Date().toISOString(); }

  /**
   * Compose the payload from app components. All args are required:
   *   params           current parameter set (live, post-tuning)
   *   currentState     current physics state at moment of copy
   *   recorder         REPLAY.makeRecorder() instance
   *   userNotes        string typed by the user in the panel
   *   meta             { milestone: 'M2', fpsAvg, devicePixelRatio,
   *                      screenW, screenH, platform, paramsDirtySince }
   */
  function composePayload(params, currentState, recorder, userNotes, meta) {
    const rec = recorder.snapshot();
    return {
      schema: 'sideswipe-sandbox/diagnostics@1',
      generatedAt: nowIso(),
      milestone: (meta && meta.milestone) || 'unknown',
      simVersion: (root && root.PHYS && root.PHYS.VERSION) || null,
      paramsVersion: params && params.version || null,
      paramsName: params && params.name || null,
      device: {
        userAgentSummary: _uaSummary(),
        devicePixelRatio: meta && meta.devicePixelRatio,
        screen: { w: meta && meta.screenW, h: meta && meta.screenH },
        platform: (meta && meta.platform) || _detectPlatform(),
        fpsAvg: meta && meta.fpsAvg != null ? meta.fpsAvg : null,
      },
      paramsLive: params,                              // FULL set, not diff
      paramsAtSessionStart: rec.paramsAtStart,
      paramsDirtySince: meta && meta.paramsDirtySince || null,
      sessionId: rec.id,
      sessionStartedAt: rec.startedAt,
      initialState: rec.initialState,
      finalState: _snapState(currentState),
      events: rec.events,                              // full ring buffer
      summary: rec.summary,
      userNotes: String(userNotes || ''),
      hints: {
        replayInstructions: [
          'Use physics.js (window.PHYS) to replay events deterministically.',
          'Load paramsLive into params. Start from initialState.',
          'Step at dt = 1/params.physicsHz; apply actions from events when',
          'an action_changed event is encountered; record divergence vs',
          'frame_snapshot entries to verify reproduction.',
        ],
        feelGlossary: {
          bounce_floor: 'ball velocity y-sign flipped near y = ballRadius',
          frame_snapshot: 'periodic state capture; cadence in summary',
          params_changed: 'user moved a slider; payload is { before, after }',
          note: 'user typed something in the notes textarea',
        },
      },
    };
  }

  function _snapState(state) {
    if (!state) return null;
    return {
      t: state.t,
      car: {
        pos: { x: state.car.pos.x, y: state.car.pos.y },
        vel: { x: state.car.vel.x, y: state.car.vel.y },
        heading: state.car.heading,
        angVel: state.car.angVel,
        grounded: !!state.car.grounded,
        boost: state.car.boost,
      },
      ball: {
        pos: { x: state.ball.pos.x, y: state.ball.pos.y },
        vel: { x: state.ball.vel.x, y: state.ball.vel.y },
        angVel: state.ball.angVel,
      },
    };
  }

  function _uaSummary() {
    if (typeof navigator === 'undefined') return null;
    const ua = navigator.userAgent || '';
    // Keep it short: just OS family + browser family. No fingerprinting.
    const os =
      /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Android/.test(ua) ? 'Android'
      : /Macintosh/.test(ua) ? 'macOS'
      : /Windows/.test(ua) ? 'Windows'
      : /Linux/.test(ua) ? 'Linux'
      : 'unknown';
    const browser =
      /CriOS/.test(ua) ? 'Chrome-iOS'
      : /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Safari'
      : /Chrome/.test(ua) ? 'Chrome'
      : /Firefox/.test(ua) ? 'Firefox'
      : 'unknown';
    return os + '/' + browser;
  }

  function _detectPlatform() {
    if (typeof navigator === 'undefined') return null;
    return navigator.platform || null;
  }

  /**
   * Stringify with deterministic ordering. The exact byte format isn't
   * critical (the agent will re-parse), but stable keys mean diffs across
   * sessions are readable.
   */
  function stringify(payload) {
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Async copy-to-clipboard. Resolves true on success, false on failure.
   * Falls back to a textarea trick for older browsers.
   */
  function copyToClipboard(text) {
    return new Promise(function (resolve) {
      if (typeof navigator !== 'undefined' && navigator.clipboard
          && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(_fallbackCopy(text)); }
        );
      } else {
        resolve(_fallbackCopy(text));
      }
    });
  }

  function _fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  const exports = {
    composePayload: composePayload,
    stringify: stringify,
    copyToClipboard: copyToClipboard,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  if (root) root.DIAG = exports;
})(typeof window !== 'undefined' ? window : null);
