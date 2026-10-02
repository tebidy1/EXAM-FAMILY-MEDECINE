/* ============================================================
   Service worker — makes the app installable and quick to reopen.

   - Pages: network first, cached copy when offline.
   - App files (css/js/icons) and the question bank: cached copy at
     once, refreshed in the background. index.html names its assets
     with ?v=N, so a deploy that bumps N is picked up on first load.
   - Supabase calls are never touched.
   ============================================================ */
'use strict';

const SHELL = 'em-shell-v1';
const DATA = 'em-data-v1';
const FONTS = 'em-fonts-v1';
const KEEP = [SHELL, DATA, FONTS];
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

// cache the page plus every stylesheet/script/icon it names, so the next launch works offline
async function precache() {
  const cache = await caches.open(SHELL);
  const res = await fetch('index.html', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('index.html', res);
  const assets = [...html.matchAll(/(?:href|src)="((?:css|js|icons)\/[^"]+|manifest\.json)"/g)].map((m) => m[1]);
  await Promise.all([...new Set(assets)].map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('em-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req) || (fallbackUrl && await cache.match(fallbackUrl));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName, e) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
  if (!hit) return fresh;
  e.waitUntil(fresh.catch(() => {}));
  return hit;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req, FONTS, e));
    return;
  }
  if (url.origin !== self.location.origin) return;                 // Supabase and anything else: straight to network
  if (/^\/(auth|rest|storage)\/v1\//.test(url.pathname)) return;   // the local dev stand-in for Supabase

  if (req.mode === 'navigate') {
    const isApp = !/admin\.html$/.test(url.pathname);
    e.respondWith(networkFirst(req, SHELL, isApp ? 'index.html' : null));
    return;
  }
  if (!/\.(css|js|json|png|svg|ico|woff2?)$/.test(url.pathname)) return;
  const cacheName = url.pathname.includes('/data/') ? DATA : SHELL;
  e.respondWith(DEV ? networkFirst(req, cacheName) : staleWhileRevalidate(req, cacheName, e));
});
