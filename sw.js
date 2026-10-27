importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCa808qwjJ8bayhjkTqZ8P9fRhfgi19xtY",
  authDomain: "bnapp-ddcbf.firebaseapp.com",
  projectId: "bnapp-ddcbf",
  messagingSenderId: "523128255450",
  appId: "1:523128255450:web:d29cdda3f21435f96686e3"
});

const messaging = firebase.messaging();

const CACHE_NAME = 'bnapp-v3-8-0-live';
const swTimers = new Map();
const firedKeys = new Set();

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        './manifest.webmanifest',
        './favicon.ico',
        './icon-192.png',
        './icon-512.png'
      ]).catch(() => {})
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();

    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      try {
        client.postMessage({ type: 'SW_FORCE_RELOAD', version: CACHE_NAME });
        if (typeof client.navigate === 'function') {
          await client.navigate(client.url);
        }
      } catch (e) {}
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url || '';
  const isCoreCode =
    event.request.mode === 'navigate' ||
    url.includes('index.html') ||
    url.includes('app.js') ||
    url.includes('styles.css') ||
    url.endsWith('/ABCZ/') ||
    url.endsWith('/ABCZ');

  event.respondWith((async () => {
    try {
      const fetchOpts = isCoreCode ? { cache: 'no-store' } : {};
      const response = await fetch(event.request, fetchOpts);
      if (response && response.ok) {
        const copy = response.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, copy);
      }
      return response;
    } catch (e) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});

// ===============================
// LOCAL & SCHEDULED SW REMINDERS
// ===============================
async function showSwReminderNotification(key, title, body) {
  const notifTitle = title || "🔔 תזכורת BNAPP";
  const notifBody = body || "הגיע זמן התזכורת שהגדרת";
  const tag = key ? `bnapp-rem-${key}` : `bnapp-rem-${Date.now()}`;

  try {
    await self.registration.showNotification(notifTitle, {
      body: notifBody,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [400, 150, 400, 150, 600],
      requireInteraction: true,
      renotify: true,
      tag,
      data: "./"
    });
  } catch (e) {}

  try {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      client.postMessage({
        type: 'SW_REMINDER_FIRED',
        key,
        title: notifTitle,
        body: notifBody
      });
    }
  } catch (e) {}
}

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'TRIGGER_SW_NOTIFICATION_NOW') {
    const { key, title, body } = msg;
    if (key) firedKeys.add(`${key}_${ Math.floor(Date.now() / 30000) }`);
    event.waitUntil(showSwReminderNotification(key, title, body));
    return;
  }

  if (msg.type === 'CANCEL_SW_NOTIFICATION') {
    const { key } = msg;
    if (key && swTimers.has(key)) {
      const existing = swTimers.get(key);
      clearTimeout(existing.timerId);
      if (existing.resolve) existing.resolve();
      swTimers.delete(key);
    }
    return;
  }

  if (msg.type === 'SCHEDULE_SW_NOTIFICATION') {
    const { key, title, body, targetTs } = msg;
    if (!key || !targetTs) return;

    if (swTimers.has(key)) {
      const existing = swTimers.get(key);
      clearTimeout(existing.timerId);
      if (existing.resolve) existing.resolve();
      swTimers.delete(key);
    }

    const delay = Math.max(0, Number(targetTs) - Date.now() + 1200);
    // שומרים את ה-Service Worker ער עד שהטיימר יפעל (עד 30 דקות קדימה)
    if (delay <= 30 * 60 * 1000) {
      event.waitUntil(new Promise((resolve) => {
        const timerId = setTimeout(async () => {
          swTimers.delete(key);
          const dedupKey = `${key}_${Math.floor(Date.now() / 30000)}`;
          if (!firedKeys.has(dedupKey)) {
            firedKeys.add(dedupKey);
            await showSwReminderNotification(key, title, body);
          }
          resolve();
        }, delay);
        swTimers.set(key, { timerId, resolve, targetTs });
      }));
    }
  }
});

// ===============================
// PUSH NOTIFICATIONS
// ===============================
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const notif = data.notification || {};
  const d = data.data || {};
  const title = notif.title || d.title || data.title || "BNAPP – תזכורת";
  const body = notif.body || d.body || data.body || "יש תזכורת חדשה";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [400, 150, 400, 150, 600],
      requireInteraction: true,
      data: d.url || data.url || "./"
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windowClients.length > 0) {
      const client = windowClients[0];
      if ('focus' in client) await client.focus();
      return;
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(event.notification.data || "./");
    }
  })());
});
