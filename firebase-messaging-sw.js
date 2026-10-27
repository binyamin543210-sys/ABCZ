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

messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification || {};
  const d = payload.data || {};
  self.registration.showNotification(
    notif.title || d.title || "BNAPP – תזכורת",
    {
      body: notif.body || d.body || "יש לך תזכורת",
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      vibrate: [200, 100, 200],
      requireInteraction: true
    }
  );
});
