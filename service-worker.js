// Sideswipe Physics Sandbox -- PWA service worker.
//
// Minimal app-shell cache for offline launch. On every code change, BUMP the
// CACHE_VERSION below so phones fetch the new code on next launch.
//
// Strategy:
//   install   -> precache the shell listed in SHELL_ASSETS
//   activate  -> delete old caches that don't match CACHE_VERSION
//   fetch     -> cache-first for same-origin GETs, network fallback;
//                navigation requests fall back to index.html if offline

const CACHE_VERSION = 'ss-sandbox-v0.2.0-m1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/params.js',
  './js/physics.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // For navigations (HTML page loads), serve index.html offline-fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // For everything else: cache-first, network fallback, opportunistic cache update.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networked = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networked;
    })
  );
});
