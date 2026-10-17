/**
 * PS TELECOM — minimal PWA service worker.
 *
 * Strategy (deliberately conservative — the app keeps ALL business data in
 * IndexedDB and syncs to Cloudflare D1, so the SW only needs to make the
 * APP SHELL reliable on flaky shop Wi-Fi, never to cache business data):
 *
 *   • navigation requests (HTML) → network-first, fall back to the cached
 *     shell so an offline tap on the installed icon still opens the app
 *   • /_next/static/* and icons → cache-first (immutable, hashed URLs)
 *   • everything else (API, sync, dev assets) → straight network, untouched
 *
 * Registered by src/components/PwaRegister.tsx on PRODUCTION, non-localhost
 * origins only — never in `next dev` (a stale SW would break HMR/preview).
 */

const CACHE = 'ps-telecom-v1';
const PRECACHE = ['/', '/manifest.json', '/pwa-192.png', '/pwa-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Cloudflare sync etc. — never touch

  // Immutable, hashed build assets + icons → cache-first
  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  // Navigations → network-first with cached-shell fallback (offline open)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
  }
});
