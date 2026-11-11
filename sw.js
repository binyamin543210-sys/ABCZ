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

const CACHE_NAME = 'bnapp-v4-4-3-live';
const swTimers = new Map();
const firedKeys = new Set();
let swSnoozeMinutes = 10;

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
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
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
    url.includes('theme.css') ||
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
async function showSwReminderNotification(key, title, body, soundMode = 'ring', snoozeMinsOverride = null) {
  if (soundMode === 'silent') return;
  const notifTitle = title || "⏰ תזכורת BNAPP";
  const notifBody = body || "הגיע זמן התזכורת שהגדרת";
  const tag = key ? `bnapp-rem-${key}` : `bnapp-rem-${Date.now()}`;
  const snoozeMins = Number(snoozeMinsOverride || swSnoozeMinutes || 10);

  try {
    await self.registration.showNotification(notifTitle, {
      body: notifBody,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: soundMode === 'vibrate' ? [350, 180, 350, 180, 500] : [250, 150, 250],
      silent: false,
      requireInteraction: true,
      renotify: true,
      tag,
      actions: [
        { action: 'mute', title: '🔇 השתק' },
        { action: 'snooze', title: `😴 נודניק (${snoozeMins} דק׳)` }
      ],
      data: {
        url: "./",
        key: key || tag,
        title: notifTitle,
        body: notifBody,
        soundMode,
        snoozeMinutes: snoozeMins
      }
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

function scheduleSwReminderInternal(key, title, body, targetTs, soundMode = 'ring', snoozeMins = 10, waitUntilEvent = null) {
  if (!key || !targetTs) return;

  if (swTimers.has(key)) {
    const existing = swTimers.get(key);
    clearTimeout(existing.timerId);
    if (existing.resolve) existing.resolve();
    swTimers.delete(key);
  }

  const delay = Math.max(0, Number(targetTs) - Date.now() + 1200);
  if (delay <= 60 * 60 * 1000) {
    const p = new Promise((resolve) => {
      const timerId = setTimeout(async () => {
        swTimers.delete(key);
        const dedupKey = `${key}_${Math.floor(Date.now() / 30000)}`;
        if (!firedKeys.has(dedupKey)) {
          firedKeys.add(dedupKey);
          await showSwReminderNotification(key, title, body, soundMode || 'ring', snoozeMins);
        }
        resolve();
      }, delay);
      swTimers.set(key, { timerId, resolve, targetTs });
    });
    if (waitUntilEvent && typeof waitUntilEvent.waitUntil === 'function') {
      waitUntilEvent.waitUntil(p);
    }
  }
}

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'SET_SNOOZE_MINUTES') {
    const m = Number(msg.snoozeMinutes);
    if (m > 0 && m <= 240) swSnoozeMinutes = m;
    return;
  }

  if (msg.type === 'TRIGGER_SW_NOTIFICATION_NOW') {
    const { key, title, body, soundMode, snoozeMinutes } = msg;
    if (snoozeMinutes > 0) swSnoozeMinutes = Number(snoozeMinutes);
    if (key) firedKeys.add(`${key}_${Math.floor(Date.now() / 30000)}`);
    event.waitUntil(showSwReminderNotification(key, title, body, soundMode || 'ring', swSnoozeMinutes));
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
    const { key, title, body, targetTs, soundMode, snoozeMinutes } = msg;
    if (snoozeMinutes > 0) swSnoozeMinutes = Number(snoozeMinutes);
    scheduleSwReminderInternal(key, title, body, targetTs, soundMode || 'ring', swSnoozeMinutes, event);
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
  const title = notif.title || d.title || data.title || "⏰ BNAPP – תזכורת";
  const body = notif.body || d.body || data.body || "יש תזכורת חדשה";
  const snoozeMins = Number(d.snoozeMinutes || swSnoozeMinutes || 10);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [400, 150, 400, 150, 600],
      requireInteraction: true,
      actions: [
        { action: 'mute', title: '🔇 השתק' },
        { action: 'snooze', title: `😴 נודניק (${snoozeMins} דק׳)` }
      ],
      data: {
        url: d.url || data.url || "./",
        key: d.key || `push_${Date.now()}`,
        title,
        body,
        snoozeMinutes: snoozeMins
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const notifData = event.notification.data || {};
  const targetUrl = typeof notifData === 'string' ? notifData : (notifData.url || "./");
  const snoozeMins = Number((typeof notifData === 'object' && notifData.snoozeMinutes) || swSnoozeMinutes || 10);
  const key = (typeof notifData === 'object' && notifData.key) || `snooze_${Date.now()}`;
  const title = (typeof notifData === 'object' && notifData.title) || event.notification.title || "⏰ תזכורת BNAPP";
  const body = (typeof notifData === 'object' && notifData.body) || event.notification.body || "הגיע זמן התזכורת";
  const soundMode = (typeof notifData === 'object' && notifData.soundMode) || 'ring';

  event.notification.close();

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // תמיד משתיקים את הצלצול הפעיל בלחיצה על ההתראה או כפתוריה
    for (const client of windowClients) {
      try {
        client.postMessage({ type: 'MUTE_ALARM_NOW' });
      } catch (e) {}
    }

    // לחיצה על "🔇 השתק" -> משתיקה מיד מבלי להיכנס לאפליקציה!
    if (event.action === 'mute') {
      return;
    }

    // לחיצה על "😴 נודניק" -> מתזמנת נודניק לפי זמן ברירת המחדל מבלי להיכנס לאפליקציה!
    if (event.action === 'snooze') {
      const snoozeTargetTs = Date.now() + snoozeMins * 60 * 1000;
      for (const client of windowClients) {
        try {
          client.postMessage({
            type: 'SNOOZE_ALARM_FROM_SW',
            key,
            title,
            body,
            snoozeMinutes: snoozeMins,
            targetTs: snoozeTargetTs
          });
        } catch (e) {}
      }
      scheduleSwReminderInternal(`${key}_snooze`, title, body, snoozeTargetTs, soundMode, snoozeMins, event);
      return;
    }

    // לחיצה על גוף ההתראה עצמה -> פותחת את האפליקציה
    if (windowClients.length > 0) {
      const client = windowClients[0];
      if ('focus' in client) await client.focus();
      return;
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
