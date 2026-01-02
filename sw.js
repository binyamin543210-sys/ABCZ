const CACHE_NAME = 'bnapp-v3-5-2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        './',
        './index.html',
        './styles.css',
        './app.js',
        './firebase-config.js',
        './manifest.webmanifest',
        './favicon.ico',
        './icon-192.png',
        './icon-512.png'
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      const copy = response.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, copy);
      return response;
    } catch (e) {
      // offline fallback
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});



// ===============================
// PUSH NOTIFICATIONS
// ===============================
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};

  self.registration.showNotification(
    data.title || "BNAPP",
    {
      body: data.body || "יש תזכורת חדשה",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data.url || "/"
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data)
  );
});
