// GIG POS — lets the till open even when the internet is down.
// Network first: online, every file comes fresh from the website (so updates show straight away);
// offline, the copy saved last time is used. Sales made offline wait on the device (see js/pos/state.js).
const CACHE = 'gig-pos-v1';
const KEEP = [location.origin, 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !KEEP.some((o) => req.url.startsWith(o))) return; // the server's API is never cached
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone()).catch(() => {});
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw new Error('offline');
    }
  })());
});
