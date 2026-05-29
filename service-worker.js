// service-worker.js, offline shell for Catur 3D Realistik
// Strategy: cache-first for the app shell, network-first for everything else,
// with offline.html as the fallback when a navigation fails and isn't cached.
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'catur-3d-realistik-' + CACHE_VERSION;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './chess-engine.js',
  './ai.js',
  './pieces.js',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/three.module.js',
  './vendor/addons/controls/OrbitControls.js',
  './vendor/addons/utils/BufferGeometryUtils.js',
  './vendor/addons/environments/RoomEnvironment.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Navigations: try network, fall back to cache, then offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((r) => r || caches.match('./offline.html'))
      )
    );
    return;
  }

  // Shell assets: cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
