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
const ROOT = new URL('./', self.location).pathname;   // the folder the app is served from

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

// Pages carry no ?v= in their URL, so ask the server every time: left to guess a
// lifetime, a browser keeps opening the previous deploy for hours after a new one.
const fresh = (req) => (req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', redirect: 'manual' }) : req);

// `saveAs`: the cache key the page is kept under (and reopened from) instead of its own URL.
// `ms`: a connected-but-dead network must not hold the launch — after `ms` open the saved copy.
async function networkFirst(req, cacheName, saveAs, ms) {
  const cache = await caches.open(cacheName);
  const saved = async () => await cache.match(req) || (saveAs ? await cache.match(saveAs) : undefined);
  const net = fetch(fresh(req)).then((res) => {
    if (res.ok) cache.put(saveAs || req, res.clone());
    return res;
  });
  try {
    if (!ms) return await net;
    const res = await Promise.race([net, new Promise((r) => setTimeout(r, ms))]);
    if (res) return res;
    const hit = await saved();
    if (hit) { net.catch(() => {}); return hit; }
    return await net;
  } catch (err) {
    const hit = await saved();
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
    // only the app's own page is kept as index.html: /get and admin.html are other pages,
    // and saving them under that key would reopen the wrong page when offline
    const isApp = url.pathname === ROOT || url.pathname === ROOT + 'index.html';
    e.respondWith(networkFirst(req, SHELL, isApp ? 'index.html' : null, 4000));
    return;
  }
  if (!/\.(css|js|json|png|svg|ico|woff2?)$/.test(url.pathname)) return;
  const cacheName = url.pathname.includes('/data/') ? DATA : SHELL;
  e.respondWith(DEV ? networkFirst(req, cacheName) : staleWhileRevalidate(req, cacheName, e));
});
