const CACHE_NAME = "protech-admin-v1";
const ASSETS = ["/", "/index.html", "/js/app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "بروتيك", body: "طلب جديد!" };
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/favicon.png",
    badge: "/favicon.png",
    vibrate: [200, 100, 200],
    tag: "protech-order",
    renotify: true,
  });
});
