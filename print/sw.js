// GIG Print Hub — tiny service worker for new-order notifications:
// pop-ups on Android while the Print Hub is open, and push notifications that arrive even when it's closed.
// (It doesn't cache anything or work offline.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// A new order (or a test) pushed by the GIG server.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'New print order', {
    body: d.body || 'Open the Print Hub to see it.',
    tag: d.tag || 'gig-order',
    icon: new URL('../icons/print-192.png', self.registration.scope).href,
    badge: new URL('../icons/print-192.png', self.registration.scope).href,
    data: { url: d.orderId ? 'index.html#/order/' + d.orderId : 'index.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './index.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { await open.focus(); open.navigate?.(url); } else await self.clients.openWindow(url);
  })());
});
