// protech-final/public/sw.js
// Service worker for the Protech dashboard PWA.
//
// Provides two things:
//   1. Install-to-home-screen support (the presence of a valid worker + the
//      manifest is enough for Chrome/Edge to offer the "install" prompt).
//   2. A push handler that displays a system notification when the server
//      sends a Web Push message — this is what lets order alerts pop up even
//      when the app is closed or the phone is locked.
//
// Deliberately no offline caching yet: the dashboard is data-heavy, and
// stale caches would mislead admins. Add a runtime cache later if needed.

const SW_VERSION = 'v1-2026-08';

self.addEventListener('install', (event) => {
  // Activate immediately on new deploys rather than waiting for all tabs to
  // close — the admin dashboard is usually one open tab.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Web Push handler. The push payload is a JSON blob shaped like:
//   { title, body, url, tag, orderCode }
// Fallback to a generic message if the server sent no payload.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    try { data = { body: event.data.text() }; } catch (_) {}
  }
  const title = data.title || '🛒 طلب جديد وصل!';
  const body = data.body || 'افتح لوحة التحكم لعرض الطلب.';
  const url = data.url || '/';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: data.tag || 'protech-order',
      renotify: true,
      vibrate: [200, 80, 200, 80, 200],
      data: { url, orderCode: data.orderCode || null },
      requireInteraction: false,
      dir: 'rtl',
      lang: 'ar',
    });
    // Tell any open dashboard tabs / installed-PWA windows to play the
    // cash-register sound (the system push notification itself can't
    // trigger custom audio, but a foreground client can).
    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) c.postMessage({ type: 'play-cash-sound' });
    } catch (_) {}
  })());
});

// Focus (or open) the dashboard tab when the notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
