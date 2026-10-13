// GIG Print Hub — tiny service worker so "new order" pop-ups also work on Android phones.
// (It only shows notifications; it doesn't cache anything or work offline.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './index.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { await open.focus(); open.navigate?.(url); } else await self.clients.openWindow(url);
  })());
});
