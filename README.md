# Sideswipe Physics Sandbox -- App

The playable PWA for Phase 1 of the Sideswipe project. This `app/`
subfolder is the deliverable: a single-page vanilla-JS Canvas-2D
PWA that the user installs on their phone and uses to feel-tune
Sideswipe physics until a signed-off `physics_params_v1.json` falls out.

For project-wide context see `../PROJECT_BRIEF_PHASE1.md` and
`../BACKGROUND_PHASE1.md`. The build SOP is in
`../directives/app_build.md`. The physics spec is in
`../directives/physics_spec.md`.

## Current Milestone
**M0 -- PWA Shell.** This commit produces a runnable PWA with:
- App shell (`index.html`, manifest, service worker)
- Black canvas + "Sideswipe Physics Sandbox -- Milestone 0" text
- Live FPS counter (top-left HUD)
- Installable on phone via Safari/Chrome "Add to Home Screen"
- Service worker caches the shell for offline launch

No physics, no input, no game state. That all comes in M1+.

## Run Locally (Desktop)
Serve `app/` over HTTP (service workers don't run from `file://`):

```bash
cd app/
python -m http.server 8000
# then open http://localhost:8000/ in Chrome or Edge
```

You should see the M0 splash + a live FPS counter. Open
DevTools -> Application -> Service Workers to verify the SW registered.

## Install on Phone

### Same-LAN dev install (no deploy needed for M0 verification)
1. From your laptop, run `python -m http.server 8000 --bind 0.0.0.0`
   inside this folder.
2. Find your laptop's LAN IP (`ipconfig` / `ifconfig`), e.g. `192.168.1.42`.
3. On your phone, open `http://192.168.1.42:8000/` in Safari (iOS) or
   Chrome (Android).
4. iOS: tap the share icon -> "Add to Home Screen".
   Android: tap the menu -> "Install app" / "Add to Home Screen".
5. Launch from the home screen. The app should open fullscreen
   landscape with no browser chrome.

> Note: iOS Safari requires HTTPS for service workers to register from
> a remote host. On LAN HTTP the install works but the SW may stay
> unregistered until you serve over HTTPS (e.g. via GitHub Pages).

### Deploy to GitHub Pages (full PWA install)
Run from inside `app/`:

```bash
git init -b main
git add .
git commit -m "M0 PWA shell"
gh repo create sideswipe-sandbox --public --source=. --remote=origin --push
gh api -X POST repos/<USERNAME>/sideswipe-sandbox/pages \
  -f "source[branch]=main" -f "source[path]=/"
```

Live at `https://<username>.github.io/sideswipe-sandbox/` in
1-2 minutes. Open on phone; full PWA install works on HTTPS.

## Iteration Loop
1. Edit files locally.
2. Test in desktop browser (DevTools -> Console for errors).
3. **Bump `CACHE_VERSION` in `service-worker.js`** so phones fetch
   the new code on next launch (otherwise the old cached shell loads).
4. Commit and push.
5. On phone, hard-close the app and reopen -- the SW will activate
   the new cache and reload.

## File Layout
```
app/
├── index.html             entry point
├── manifest.json          PWA manifest
├── service-worker.js      offline cache + SW lifecycle
├── README.md              this file
├── icons/
│   ├── icon-192.png       placeholder, replace with real logo later
│   └── icon-512.png       placeholder
├── css/styles.css         all styles
└── js/app.js              M0 entry: SW registration, canvas, FPS, render loop
```

Subsequent milestones add files under `js/`:
- `physics.js` (M1) -- pure physics engine, no DOM
- `params.js` (M1) -- DEFAULT_PARAMS + preset constants
- `renderer.js` (M2) -- canvas rendering of physics state
- `input.js` (M3) -- touch + keyboard -> action object
- `ui.js` (M3+) -- debug overlay, tuning panel, menus
- `storage.js` (M8) -- IndexedDB wrapper
- `replay.js` (M9) -- recording, playback
- `presets.js` (M9) -- starting-state presets

See `../directives/app_build.md` for the full milestone breakdown.

## Architectural Guardrails (from `directives/app_build.md`)
- Vanilla JS / HTML / CSS only -- no bundler, no framework.
- `physics.js` must remain DOM-free (importable in Node).
- Fixed 120 Hz physics, accumulator pattern, decoupled from render.
- Determinism mandatory (no `Math.random`, no `Date.now` in physics).
- All tunable values in a single versioned parameter object.
- Shot type labels are post-hoc, never coded as branches.
- Auto-record every session to IndexedDB.

## After M0 Sign-Off
The user confirms phone install + landscape launch. Then the agent
proceeds to M1 (`physics.js` + headless test). Do not advance without
explicit M0 sign-off per `../directives/parameter_calibration.md`.
