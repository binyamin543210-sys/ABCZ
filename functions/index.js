const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

/**
 * מחזיר "YYYY-MM-DD" לפי Asia/Jerusalem
 */
function dateKeyIsrael(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(d); // en-CA => YYYY-MM-DD
}

/**
 * מחזיר תאריך של מחר לפי Asia/Jerusalem
 */
function dateKeyTomorrowIsrael() {
  const now = new Date();
  // מוסיפים 26 שעות כדי להיות בטוחים שלא ניפול על מעבר יום/שעון
  const t = new Date(now.getTime() + 26 * 60 * 60 * 1000);
  return dateKeyIsrael(t);
}

/**
 * ממיר "HH:MM" לדקות
 */
function timeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * מחזיר epoch-ms של זמן ההתחלה של אירוע לפי dateKey + startTime, Asia/Jerusalem
 * (עובד טוב מספיק לתזכורות אישיות)
 */
function eventStartEpochIsrael(dateKey, startTime) {
  // dateKey: YYYY-MM-DD
  const [y, mo, da] = dateKey.split("-").map(Number);
  const [hh, mm] = (startTime || "00:00").split(":").map(Number);

  // טריק: בונים תאריך "מקומי" ואז מתקנים לפי timezone דרך formatToParts.
  // בפועל: לתזכורת דקה-דקה זה מספיק.
  const dt = new Date(Date.UTC(y, mo - 1, da, hh, mm, 0, 0));

  // נחשב את offset של Israel באותו רגע:
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(dt);

  const get = (type) => Number(parts.find(p => p.type === type)?.value);
  const iy = get("year");
  const im = get("month");
  const id = get("day");
  const ih = get("hour");
  const imin = get("minute");
  const isec = get("second");

  // תאריך "ישראל" → epoch ע"י בניית Date מקומי ואז UTC תיקון
  // נבנה Date ב־UTC עם אותם רכיבים ונשתמש בו כקירוב.
  return Date.UTC(iy, im - 1, id, ih, imin, isec, 0);
}

/**
 * קורא את כל ה־tokens ששמרת ב־notificationTokens/{token}
 */
async function loadAllTokens() {
  const snap = await admin.database().ref("notificationTokens").get();
  const val = snap.val() || {};
  return Object.keys(val);
}

/**
 * שולח push לטוקנים
 */
async function sendPush(tokens, payload) {
  if (!tokens.length) return { sent: 0 };

  // Firebase Admin: sendEachForMulticast (מקסימום 500 בכל פעם)
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      notification: payload.notification,
      data: payload.data,
      webpush: payload.webpush
    });
    sent += res.successCount;
  }
  return { sent };
}

/**
 * רץ כל דקה:
 * - קורא אירועים של היום + מחר (Israel)
 * - מחשב מי צריך תזכורת עכשיו (חלון דקה)
 * - שולח Push
 * - מסמן remindedAt כדי לא לחזור
 */
exports.remindersTick = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Jerusalem",
    region: "europe-west1"
  },
  async () => {
    const now = Date.now();
    const windowMs = 60 * 1000; // דקה
    const from = now - 15 * 1000; // מרווח קטן אחורה (לסובלנות)
    const to = now + windowMs;

    const todayKey = dateKeyIsrael(new Date());
    const tomorrowKey = dateKeyTomorrowIsrael();

    const [todaySnap, tomorrowSnap] = await Promise.all([
      admin.database().ref(`events/${todayKey}`).get(),
      admin.database().ref(`events/${tomorrowKey}`).get()
    ]);

    const all = [
      { dateKey: todayKey, data: todaySnap.val() || {} },
      { dateKey: tomorrowKey, data: tomorrowSnap.val() || {} }
    ];

    const due = [];

    for (const day of all) {
      const items = day.data || {};
      for (const [id, ev] of Object.entries(items)) {
        if (!ev) continue;

        // חייב להיות תזכורת + שעה
        const reminderMinutes = Number(ev.reminderMinutes);
        if (!Number.isFinite(reminderMinutes) || reminderMinutes <= 0) continue;
        if (!ev.startTime) continue;

        // לא שולחים אם בוצע
        if (ev.completed === true) continue;

        // לא שולחים פעמיים
        if (ev.remindedAt) continue;

        const startEpoch = eventStartEpochIsrael(day.dateKey, ev.startTime);
        const remindAt = startEpoch - reminderMinutes * 60 * 1000;

        if (remindAt >= from && remindAt < to) {
          due.push({ id, dateKey: day.dateKey, ev, remindAt });
        }
      }
    }

    if (!due.length) return;

    // טוקנים
    const tokens = await loadAllTokens();
    if (!tokens.length) return;

    // שולחים אחת-אחת (כדי שכל תזכורת תכיל טקסט מתאים)
    for (const item of due) {
      const title = "BNAPP – תזכורת";
      const body =
        (item.ev.title ? item.ev.title : "יש לך תזכורת") +
        (item.ev.startTime ? ` • ${item.ev.startTime}` : "");

      const payload = {
        notification: { title, body },
        data: {
          url: "/" // אצלך sw.js פותח את זה בלחיצה
        },
        webpush: {
          fcmOptions: {
            link: "/" // למובייל/כרום
          }
        }
      };

      await sendPush(tokens, payload);

      // סימון "נשלח"
      await admin
        .database()
        .ref(`events/${item.dateKey}/${item.id}`)
        .update({
          remindedAt: Date.now()
        });
    }
  }
);
