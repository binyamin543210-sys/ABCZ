// BNAPP V3.5.2 – לוגיקה ראשית
// דורש:
// - firebase-config.js (db)
// - Chart.js (global Chart)
// - hebcal.noloc.min.js (global Hebcal) - עם fallback אם לא נטען

function hasNativeAndroidBridge() {
  return typeof window.AndroidBridge !== "undefined" && window.AndroidBridge !== null;
}

function isUpdatedNativeApk() {
  return hasNativeAndroidBridge() && typeof window.AndroidBridge.getSnoozeMinutes === "function";
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js?v=blue26").then((reg) => {
    try { reg.update(); } catch (e) {}
  }).catch(() => {});

  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "MUTE_ALARM_NOW") {
      if (typeof stopAlarmLoop === "function") stopAlarmLoop();
      el("luxuryTopAlarmBanner")?.classList.add("hidden");
      return;
    }
    if (msg.type === "SNOOZE_ALARM_FROM_SW") {
      if (typeof stopAlarmLoop === "function") stopAlarmLoop();
      el("luxuryTopAlarmBanner")?.classList.add("hidden");
      el("reminderAlertModal")?.classList.add("hidden");
      const mins = Number(msg.snoozeMinutes) || (typeof getSnoozeMinutes === "function" ? getSnoozeMinutes() : 10);
      showToast(`😴 נודניק הופעל ל-${mins} דקות`);
      return;
    }
    if (msg.type === "SW_REMINDER_FIRED" && msg.key) {
      if (typeof window._onSwReminderFired === "function") {
        window._onSwReminderFired(msg);
      }
    }
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyCa808qwjJ8bayhjkTqZ8P9fRhfgi19xtY",
  authDomain: "bnapp-ddcbf.firebaseapp.com",
  databaseURL: "https://bnapp-ddcbf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bnapp-ddcbf",
  storageBucket: "bnapp-ddcbf.firebasedatabase.app",
  messagingSenderId: "523128255450",
  appId: "1:523128255450:web:d29cdda3f21435f96686e3",
  measurementId: "G-61DKZ1B5L2"
};

const firebaseApp = (window.firebase && firebase.apps && firebase.apps.length)
  ? firebase.app()
  : (window.firebase ? firebase.initializeApp(firebaseConfig) : null);

const db = firebaseApp && firebase.database ? firebase.database() : null;

const ref = (dbInst, path) => dbInst ? dbInst.ref(path) : null;
const onValue = (refObj, cb) => refObj ? refObj.on("value", cb) : null;
const set = (refObj, val) => refObj ? refObj.set(val) : Promise.resolve();
const push = (refObj) => refObj ? refObj.push() : { key: String(Date.now()) };
const update = (refObj, val) => refObj ? refObj.update(val) : Promise.resolve();
const remove = (refObj) => refObj ? refObj.remove() : Promise.resolve();

let messaging = null;
try {
  if (firebaseApp && firebase.messaging && (location.protocol === "https:" || location.hostname === "localhost")) {
    messaging = firebase.messaging();
  }
} catch (e) {
  console.warn("FCM not available:", e);
}

const onMessage = (msgInst, cb) => (msgInst && typeof msgInst.onMessage === "function") ? msgInst.onMessage(cb) : null;
const getToken = (msgInst, opts) => (msgInst && typeof msgInst.getToken === "function") ? msgInst.getToken(opts) : Promise.resolve(null);

// ===============================
// FCM – foreground messages (in-app toast)
// ===============================
if (messaging && typeof onMessage === "function") {
  onMessage(messaging, (payload) => {
    try {
      const title = payload.notification?.title || "BNAPP";
      const body =
        payload.notification?.body ||
        payload.data?.body ||
        "יש התראה חדשה";

      // מציג טוסט קטן בתוך האפליקציה
      showToast(`${title}: ${body}`);
    } catch (e) {
      console.warn("Failed to handle foreground FCM message", e);
    }
  });
}


const state = {
  currentUser: "binyamin",
  currentDate: new Date(),
  statsRange: "day",

  settings: {
    city: null,
    cityLat: null,
    cityLon: null,
    cityTz: null,
    specialEvents: {},
    shoppingFavorites: null
  },

  cache: {
    events: {},
    shopping: {},
    holidays: {},
    holidaysLoadedYear: null,
    shabbat: {},
    lastStatsBreakdown: {}
  },

  ui: {
    darkMode: false,
    notificationsGranted: false,
    statsManualRange: false,
    openStatsTabs: { tabCompletedEvents: true },
    calendarOwnerFilter: (() => { try { return localStorage.getItem("bnapp_cal_owner_filter") || "all"; } catch { return "all"; } })(),
    tasksOwnerFilter: (() => { try { return localStorage.getItem("bnapp_tasks_owner_filter") || "all"; } catch { return "all"; } })(),
    shoppingSortByDept: true
  },

  // מטרות שבועיות – מנוהלות מדף סטטיסטיקות
  goals: {
    binyamin: {},
    nana: {}
  }
};

const GOAL_COLORS = {
  "SELS": "#0ea5e9",          // כחול מעלית SELS 🛗
  "🛗 SELS": "#0ea5e9",
  "שינה": "#60a5fa",          // תכלת
  "התארגנות": "#38bdf8",      // תכלת-טורקיז
  "נסיעות": "#6366f1",        // אינדיגו
  "נסיעה לעבודה": "#6366f1",  // אינדיגו
  "נסיעה לבית": "#6366f1",    // אינדיגו
  "עבודה": "#ef4444",         // אדום
  "אוכל ומקלחות": "#f59e0b",  // כתום
  "אוכל ומקלחת": "#f59e0b",   // כתום
  "אוכל + מקלחת": "#f59e0b",  // כתום
  "זמן פנוי": "#22c55e",      // ירוק
  "פגישות": "#8b5cf6",        // סגול
  "תחזוקת בית": "#06b6d4",    // טורקיז
  "כושר ובריאות": "#10b981",  // אמרלד
  "לימודים והתפתחות": "#ec4899", // ורוד
  "זוגיות ובילוי": "#f43f5e", // רוז
  "כספים ובירוקרטיה": "#eab308", // זהב
  "נסיעות ורכב": "#6366f1"    // אינדיגו
};

let editingGoalId = null;

const el = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function matchesQuickOwnerFilter(ev, filterMode = "all", dateKey = "") {
  if (!ev) return false;
  const titleTrim = (ev.title || "").trim();

  // הסתרת אירועי "יום חופש לננה" דיפולטיביים אם נשארו בזיכרון
  if (isDefaultEvent(ev) && (titleTrim === "🌴 יום חופש לננה" || titleTrim === "יום חופש לננה" || titleTrim === "חופש לננה")) {
    return false;
  }

  // בדיקת אירועי סדר יום קבועים (שינה, התארגנות, נסיעה לעבודה, עבודה, נסיעה לבית, אוכל ומקלחות)
  if (isDefaultEvent(ev)) {
    const dk = dateKey || ev.dateKey || "";
    const isTue = dk && dk !== "undated" && /^\d{4}-\d{2}-\d{2}$/.test(dk) && parseDateKey(dk).getDay() === 2;
    if (isTue || ev.owner === "binyamin") {
      // ביום שלישי: כל הגדרות סדר היום הקבועות הן של בנימין בלבד!
      if (state.currentUser === "nana") return false;
      if (filterMode === "shared") return false;
      return true;
    }
    if (ev.owner === "nana" && state.currentUser !== "nana" && filterMode === "mine") return false;
    return true;
  }

  if (!filterMode || filterMode === "all") return true;
  const owner = ev.owner || "shared";
  if (filterMode === "mine") return owner === state.currentUser || owner === "shared";
  if (filterMode === "shared") return owner === "shared";
  return true;
}

function parseMinutes(t) {
  if (!t || typeof t !== "string" || !t.includes(":")) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minutesToTime(totalMins) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(Number(totalMins) || 0)));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function getEventTimeBoundsForSort(ev) {
  const s = parseMinutes(ev?.startTime);
  if (s === null) return null;
  let e = parseMinutes(ev?.endTime);
  if (e === null) {
    const dur = Number(ev?.duration) > 0 ? Number(ev.duration) : 60;
    e = s + dur;
  } else if (e <= s) {
    e += 1440;
  }
  return { start: s, end: e, duration: e - s };
}

function compareEventsByTimeAndContainment(a, b) {
  const ta = getEventTimeBoundsForSort(a);
  const tb = getEventTimeBoundsForSort(b);

  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  if (!ta && !tb) return 0;

  // משימה שמסתיימת מוקדם יותר (למשל 08:15-08:45 בתוך 08:00-09:00) מוצגת קודם ברשימה!
  if (ta.end !== tb.end) {
    return ta.end - tb.end;
  }
  // אם שתיהן מסתיימות באותה שעה – זו שהתחילה מאוחר יותר (הממוקדת/קצרה יותר) מוצגת קודם
  if (ta.start !== tb.start) {
    return tb.start - ta.start;
  }
  return 0;
}

function addMinutesToTimeStr(timeStr, minsToAdd) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  let total = h * 60 + m + Number(minsToAdd || 60);
  if (total >= 24 * 60) total = 23 * 60 + 59;
  if (total < 0) total = 0;
  const nh = String(Math.floor(total / 60)).padStart(2, "0");
  const nm = String(total % 60).padStart(2, "0");
  return `${nh}:${nm}`;
}
const DEFAULT_ROUTINE_TITLES = new Set([
  "שינה",
  "התארגנות",
  "נסיעה לעבודה",
  "עבודה",
  "נסיעה לבית",
  "אוכל ומקלחות",
  "אוכל ומקלחת",
  "אוכל + מקלחת",
  "יום חופש לננה",
  "🌴 יום חופש לננה",
  "חופש לננה"
]);

function isDefaultEvent(ev) {
  if (!ev) return false;

  // תופס גם true וגם "true" וגם 1
  if (
    ev.isDefault === true ||
    ev.isDefault === "true" ||
    ev.isDefault === 1 ||
    ev.isDefault === "1"
  ) return true;

  // גיבוי לדאטה ישן וחדש
  const t = (ev.title || "").trim();
  const owner = ev.owner || "";

  if (ev.type === "event" && (owner === "shared" || owner === "binyamin" || owner === "nana")) {
    if (DEFAULT_ROUTINE_TITLES.has(t)) return true;
  }

  return false;
}
function getHebcal() {
  return window.Hebcal || null; // global מהסקריפט
}
function hasHebcal() {
  return !!window.Hebcal;
}
function toHebrewNumeral(num) {
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת"];

  if (num <= 0) return "";

  // חריגים הלכתיים
  if (num === 15) return "ט״ו";
  if (num === 16) return "ט״ז";

  let result = "";

  if (num >= 100) {
    const h = Math.floor(num / 100);
    result += hundreds[h] || "";
    num %= 100;
  }

  if (num >= 10) {
    const t = Math.floor(num / 10);
    result += tens[t] || "";
    num %= 10;
  }

  if (num > 0) {
    result += ones[num];
  }

  // גרש / גרשיים
  if (result.length === 1) {
    result += "׳";
  } else if (result.length > 1) {
    result = result.slice(0, -1) + "״" + result.slice(-1);
  }

  return result;
}
function dateKeyFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(12, 0, 0, 0); // מונע סטיית יום
  return dt;
}

function formatHebrewDate(date) {
  // fallback: Intl (עובד בדפדפנים מודרניים)
  try {
    const H = getHebcal();
    if (H && H.HDate) {
      const hd = new H.HDate(date);
      return hd.renderGematriya();
    }
  } catch {}
  try {
    // מחזיר כמו "כ״ה בכסלו תשפ״ו" – נחתוך רק יום
    const s = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric" }).format(date);
    return s || "";
  } catch {
    return "";
  }
}

function getHebrewMonthYearLabel(date) {
  try {
    return new Intl.DateTimeFormat("he-u-ca-hebrew", { month: "long", year: "numeric" }).format(date);
  } catch {
    return "";
  }
}

function getCity() {
  return state.settings.city || localStorage.getItem("bnapp_city") || "ירושלים";
}

const ISRAEL_CITIES_COORDS = {
  "ירושלים": { lat: 31.7683, lon: 35.2137 },
  "תל אביב": { lat: 32.0853, lon: 34.7818 },
  "תל אביב יפו": { lat: 32.0853, lon: 34.7818 },
  "ת\"א": { lat: 32.0853, lon: 34.7818 },
  "חיפה": { lat: 32.7940, lon: 34.9896 },
  "ראשון לציון": { lat: 31.9730, lon: 34.7925 },
  "ראשל\"צ": { lat: 31.9730, lon: 34.7925 },
  "פתח תקווה": { lat: 32.0840, lon: 34.8878 },
  "פתח תקוה": { lat: 32.0840, lon: 34.8878 },
  "פ\"ת": { lat: 32.0840, lon: 34.8878 },
  "אשדוד": { lat: 31.8044, lon: 34.6553 },
  "נתניה": { lat: 32.3215, lon: 34.8532 },
  "באר שבע": { lat: 31.2518, lon: 34.7913 },
  "ב\"ש": { lat: 31.2518, lon: 34.7913 },
  "בני ברק": { lat: 32.0807, lon: 34.8338 },
  "חולון": { lat: 32.0158, lon: 34.7874 },
  "רמת גן": { lat: 32.0684, lon: 34.8248 },
  "אשקלון": { lat: 31.6688, lon: 34.5743 },
  "רחובות": { lat: 31.8928, lon: 34.8113 },
  "בת ים": { lat: 32.0132, lon: 34.7480 },
  "בית שמש": { lat: 31.7470, lon: 34.9881 },
  "כפר סבא": { lat: 32.1750, lon: 34.9069 },
  "הרצליה": { lat: 32.1663, lon: 34.8436 },
  "חדרה": { lat: 32.4340, lon: 34.9197 },
  "מודיעין": { lat: 31.8969, lon: 35.0104 },
  "מודיעין מכבים רעות": { lat: 31.8969, lon: 35.0104 },
  "נצרת": { lat: 32.6996, lon: 35.3035 },
  "לוד": { lat: 31.9510, lon: 34.8881 },
  "רמלה": { lat: 31.9292, lon: 34.8656 },
  "רעננה": { lat: 32.1848, lon: 34.8713 },
  "גבעתיים": { lat: 32.0722, lon: 34.8089 },
  "רהט": { lat: 31.3955, lon: 34.7569 },
  "נהריה": { lat: 33.0059, lon: 35.0941 },
  "אילת": { lat: 29.5577, lon: 34.9519 },
  "עכו": { lat: 32.9278, lon: 35.0818 },
  "אלעד": { lat: 32.0519, lon: 34.9512 },
  "ראש העין": { lat: 32.0956, lon: 34.9566 },
  "קריית אתא": { lat: 32.8115, lon: 35.1132 },
  "קרית אתא": { lat: 32.8115, lon: 35.1132 },
  "קריית גת": { lat: 31.6111, lon: 34.7685 },
  "קרית גת": { lat: 31.6111, lon: 34.7685 },
  "קריית מוצקין": { lat: 32.8371, lon: 35.0776 },
  "קריית ביאליק": { lat: 32.8275, lon: 35.0889 },
  "קריית ים": { lat: 32.8493, lon: 35.0697 },
  "קריית שמונה": { lat: 33.2073, lon: 35.5702 },
  "כרמיאל": { lat: 32.9199, lon: 35.2901 },
  "טבריה": { lat: 32.7922, lon: 35.5312 },
  "צפת": { lat: 32.9646, lon: 35.4960 },
  "עפולה": { lat: 32.6078, lon: 35.2897 },
  "נס ציונה": { lat: 31.9293, lon: 34.7987 },
  "יבנה": { lat: 31.8781, lon: 34.7398 },
  "אור יהודה": { lat: 32.0292, lon: 34.8579 },
  "רמת השרון": { lat: 32.1461, lon: 34.8395 },
  "הוד השרון": { lat: 32.1524, lon: 34.8947 },
  "גבעת שמואל": { lat: 32.0782, lon: 34.8476 },
  "קריית אונו": { lat: 32.0636, lon: 34.8553 },
  "מעלה אדומים": { lat: 31.7774, lon: 35.2990 },
  "אריאל": { lat: 32.1040, lon: 35.1845 },
  "דימונה": { lat: 31.0708, lon: 35.0333 },
  "שדרות": { lat: 31.5250, lon: 34.5969 },
  "נתיבות": { lat: 31.4231, lon: 34.5892 },
  "אופקים": { lat: 31.3141, lon: 34.6203 },
  "ערד": { lat: 31.2588, lon: 35.2128 },
  "מגדל העמק": { lat: 32.6770, lon: 35.2405 },
  "יוקנעם": { lat: 32.6593, lon: 35.1100 },
  "יקנעם": { lat: 32.6593, lon: 35.1100 },
  "פרדס חנה": { lat: 32.4718, lon: 34.9706 },
  "זכרון יעקב": { lat: 32.5708, lon: 34.9517 },
  "באר יעקב": { lat: 31.9404, lon: 34.8363 },
  "שוהם": { lat: 31.9986, lon: 34.9456 },
  "מבשרת ציון": { lat: 31.8017, lon: 35.1566 },
  "גדרה": { lat: 31.8146, lon: 34.7798 },
  "גן יבנה": { lat: 31.7873, lon: 34.7063 }
};

// --- Open-Meteo helpers (מזג אוויר בלי API KEY) ---
// מחזיר קואורדינטות לעיר בלי לכתוב ל-Firebase (כדי שהמאזין לא ידרוס את העיר החדשה באמצע השמירה)
async function lookupCityCoords(name) {
  const raw = (name || "").trim();
  const base = raw.split(",")[0].replace(/-/g, " ").replace(/\s+/g, " ").trim();

  // 1) בדיקה מיידית במילון ערי ישראל (עובד תמיד בעברית ובלי תלות ברשת)
  if (ISRAEL_CITIES_COORDS[base]) {
    const c = ISRAEL_CITIES_COORDS[base];
    return { lat: c.lat, lon: c.lon, tz: "Asia/Jerusalem", label: base };
  }
  const matchKey = Object.keys(ISRAEL_CITIES_COORDS).find(
    (k) => k === base || k.includes(base) || base.includes(k)
  );
  if (matchKey) {
    const c = ISRAEL_CITIES_COORDS[matchKey];
    return { lat: c.lat, lon: c.lon, tz: "Asia/Jerusalem", label: raw };
  }

  // 2) חיפוש ב-Open-Meteo Geocoding
  const variants = Array.from(new Set([raw, base].filter(Boolean)));
  for (const q of variants) {
    for (const lang of ["he", "en"]) {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=${lang}&format=json`;
        const resp = await fetch(url);
        const data = await resp.json();
        const results = data.results || [];
        if (!results.length) continue;
        const r = results.find((x) => x.country_code === "IL") || results[0];
        return {
          lat: r.latitude,
          lon: r.longitude,
          tz: r.timezone || "Asia/Jerusalem",
          label: r.name || base
        };
      } catch (e) {
        console.warn("geocode attempt failed", q, lang, e);
      }
    }
  }

  // 3) גיבוי דרך OpenStreetMap Nominatim (תומך מעולה בעברית וכתובות בישראל)
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(raw)}&accept-language=he&limit=3`;
    const resp = await fetch(nomUrl);
    const arr = await resp.json();
    if (Array.isArray(arr) && arr.length > 0) {
      const best = arr[0];
      return {
        lat: Number(best.lat),
        lon: Number(best.lon),
        tz: "Asia/Jerusalem",
        label: raw
      };
    }
  } catch (e) {
    console.warn("Nominatim geocode fallback failed", e);
  }

  // 4) גם אם לא נמצאו קואורדינטות מדויקות – שומרים את שם העיר שהמשתמש בחר עם מרכז ישראל
  return {
    lat: 32.0853,
    lon: 34.7818,
    tz: "Asia/Jerusalem",
    label: raw
  };
}

async function geocodeCity(name) {
  const r = await lookupCityCoords(name);
  state.settings.cityLat = r.lat;
  state.settings.cityLon = r.lon;
  state.settings.cityTz = r.tz;
  return r;
}

async function ensureCityCoords() {
  if (state.settings.cityLat && state.settings.cityLon && state.settings.cityTz) return;
  await geocodeCity(getCity());
  try {
    await update(ref(db, "settings"), {
      cityLat: state.settings.cityLat,
      cityLon: state.settings.cityLon,
      cityTz: state.settings.cityTz
    });
  } catch (e) {
    console.warn("Failed saving city coords", e);
  }
}

function mapOpenMeteoWeather(code) {
  if (code === 0) return { label: "שמים בהירים", emoji: "☀️" };
  if ([1, 2, 3].includes(code)) return { label: "מעונן חלקית", emoji: "🌤️" };
  if ([45, 48].includes(code)) return { label: "ערפל", emoji: "🌫️" };
  if ([51, 53, 55].includes(code)) return { label: "טיפטוף", emoji: "🌦️" };
  if ([61, 63, 65].includes(code)) return { label: "גשם", emoji: "🌧️" };
  if ([71, 73, 75, 77].includes(code)) return { label: "שלג", emoji: "❄️" };
  if ([80, 81, 82].includes(code)) return { label: "ממטרים", emoji: "🌧️" };
  if ([95, 96, 99].includes(code)) return { label: "סופות רעמים", emoji: "⛈️" };
  return { label: "מזג אוויר", emoji: "🌦️" };
}

function hebrewHolidayForDate(date) {
  try {
    const H = getHebcal();
    if (!H || !H.holidays) return null;
    const events = H.holidays(date, { il: true });
    if (!events || !events.length) return null;
    const e = events[0];
    return e.render ? e.render("he") : (e.desc || null);
  } catch {
    return null;
  }
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}
const isShabbat = (date) => date.getDay() === 6;
const isFriday  = (date) => date.getDay() === 5;

function getDailyRoutineSpecsForDay(day) {
  // בימים ב, ה (Monday = 1, Thursday = 4)
  if (day === 1 || day === 4) {
    return [
      { key: "def_sleep", title: "שינה", startTime: "00:00", endTime: "06:30", owner: "shared", statCategory: "שינה" },
      { key: "def_prep", title: "התארגנות", startTime: "06:30", endTime: "07:00", owner: "shared", statCategory: "התארגנות" },
      { key: "def_drive_work", title: "נסיעה לעבודה", startTime: "07:00", endTime: "07:30", owner: "shared", statCategory: "נסיעות" },
      { key: "def_work", title: "עבודה", startTime: "07:30", endTime: "16:30", owner: "shared", statCategory: "עבודה" },
      { key: "def_drive_home", title: "נסיעה לבית", startTime: "16:30", endTime: "16:50", owner: "shared", statCategory: "נסיעות" },
      { key: "def_food_shower", title: "אוכל ומקלחות", startTime: "16:50", endTime: "18:30", owner: "shared", statCategory: "אוכל ומקלחות" }
    ];
  }
  // בימים א, ד (Sunday = 0, Wednesday = 3)
  if (day === 0 || day === 3) {
    return [
      { key: "def_sleep", title: "שינה", startTime: "00:00", endTime: "06:45", owner: "shared", statCategory: "שינה" },
      { key: "def_prep", title: "התארגנות", startTime: "06:45", endTime: "07:15", owner: "shared", statCategory: "התארגנות" },
      { key: "def_drive_work", title: "נסיעה לעבודה", startTime: "07:15", endTime: "07:50", owner: "shared", statCategory: "נסיעות" },
      { key: "def_work", title: "עבודה", startTime: "07:50", endTime: "16:30", owner: "shared", statCategory: "עבודה" },
      { key: "def_drive_home", title: "נסיעה לבית", startTime: "16:30", endTime: "16:50", owner: "shared", statCategory: "נסיעות" },
      { key: "def_food_shower", title: "אוכל ומקלחות", startTime: "16:50", endTime: "18:30", owner: "shared", statCategory: "אוכל ומקלחות" }
    ];
  }
  // ביום ג (Tuesday = 2) – ההגדרות רק לבנימין!
  if (day === 2) {
    return [
      { key: "def_sleep", title: "שינה", startTime: "00:00", endTime: "07:45", owner: "binyamin", statCategory: "שינה" },
      { key: "def_prep", title: "התארגנות", startTime: "07:45", endTime: "08:15", owner: "binyamin", statCategory: "התארגנות" },
      { key: "def_drive_work", title: "נסיעה לעבודה", startTime: "08:15", endTime: "08:30", owner: "binyamin", statCategory: "נסיעות" },
      { key: "def_work", title: "עבודה", startTime: "08:30", endTime: "16:30", owner: "binyamin", statCategory: "עבודה" },
      { key: "def_drive_home", title: "נסיעה לבית", startTime: "16:30", endTime: "16:50", owner: "binyamin", statCategory: "נסיעות" },
      { key: "def_food_shower", title: "אוכל ומקלחות", startTime: "16:50", endTime: "18:30", owner: "binyamin", statCategory: "אוכל ומקלחות" }
    ];
  }
  // שישי ושבת (5, 6)
  return [
    { key: "def_sleep", title: "שינה", startTime: "00:00", endTime: "07:00", owner: "shared", statCategory: "שינה" }
  ];
}

async function ensureDefaultDayEvents(date) {
  const dateKey = dateKeyFromDate(date);
  const day = date.getDay();
  const specs = getDailyRoutineSpecsForDay(day);

  if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
  const existing = state.cache.events[dateKey];
  const dbUpdates = {};

  // הסרת אירועי ברירת מחדל ישנים שלא תואמים למפרט החדש של אותו יום
  const specKeys = new Set(specs.map((s) => s.key));
  for (const [id, ev] of Object.entries(existing)) {
    if (!ev || !isDefaultEvent(ev)) continue;
    if (!specKeys.has(id)) {
      delete existing[id];
      dbUpdates[`events/${dateKey}/${id}`] = null;
    }
  }

  for (const spec of specs) {
    const cur = existing[spec.key];
    const desired = {
      _id: spec.key,
      type: "event",
      owner: spec.owner,
      title: spec.title,
      startTime: spec.startTime,
      endTime: spec.endTime,
      statCategory: spec.statCategory,
      dateKey,
      isDefault: true
    };
    if (
      !cur ||
      cur.title !== desired.title ||
      cur.startTime !== desired.startTime ||
      cur.endTime !== desired.endTime ||
      cur.owner !== desired.owner ||
      cur.isDefault !== true
    ) {
      existing[spec.key] = desired;
      dbUpdates[`events/${dateKey}/${spec.key}`] = desired;
    }
  }

  if (Object.keys(dbUpdates).length > 0) {
    try {
      await update(ref(db), dbUpdates);
    } catch {}
  }
}
// --- יצירת אירועי ברירת מחדל לכל ימי החודש המוצג ---
async function preloadDefaultEventsForVisibleMonth() {
  if (!state.eventsLoaded || state._preloadingDefaults) return;
  state._preloadingDefaults = true;
  try {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);

    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      await ensureDefaultDayEvents(new Date(d));
    }
  } finally {
    state._preloadingDefaults = false;
  }
}
// ===============================
// Shabbat times – smart monthly cache
// ===============================
// --- זמני שבת – cache לפי יום שישי ---
async function ensureShabbatForWeek(fridayDate) {
  const fridayKey = dateKeyFromDate(fridayDate);
  if (state.cache.shabbat[fridayKey]) return state.cache.shabbat[fridayKey];
  if (!state.settings.cityLat || !state.settings.cityLon || !state.settings.cityTz) return null;

  const y = fridayDate.getFullYear();
  const m = String(fridayDate.getMonth() + 1).padStart(2, "0");
  const d = String(fridayDate.getDate()).padStart(2, "0");

// שבת = יום אחרי שישי
const saturday = new Date(fridayDate);
saturday.setDate(saturday.getDate() + 1);

const y2 = saturday.getFullYear();
const m2 = String(saturday.getMonth() + 1).padStart(2, "0");
const d2 = String(saturday.getDate()).padStart(2, "0");

const url =
  "https://www.hebcal.com/hebcal?v=1&cfg=json&c=on&M=on&i=on" +
  `&latitude=${encodeURIComponent(state.settings.cityLat)}` +
  `&longitude=${encodeURIComponent(state.settings.cityLon)}` +
  `&tzid=${encodeURIComponent(state.settings.cityTz)}` +
  `&start=${y}-${m}-${d}` +
  `&end=${y2}-${m2}-${d2}`;
  

  try {
    const resp = await fetch(url);
    const data = await resp.json();
  const itemCandles = (data.items || []).find(
  (it) => it.category === "candles" && it.date.startsWith(`${y}-${m}-${d}`)
);

const itemHavdalah = (data.items || []).find(
  (it) => it.category === "havdalah" && it.date.startsWith(`${y2}-${m2}-${d2}`)
);
    const result = {
      candle: itemCandles ? new Date(itemCandles.date) : null,
      havdalah: itemHavdalah ? new Date(itemHavdalah.date) : null
    };
    state.cache.shabbat[fridayKey] = result;
    return result;
  } catch (e) {
    console.error("Failed loading shabbat times", e);
    return null;
  }
}
// --- טעינה חכמה של זמני שבת לחודש המוצג בלבד ---
function preloadShabbatForVisibleMonth() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 5) { // 5 = יום שישי
      ensureShabbatForWeek(new Date(d));
    }
  }
}

function formatTimeHM(date) {
  if (!date) return "";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function ensureYearHolidays(year) {
  if (state.cache.holidaysLoadedYear === year) return;
  state.cache.holidaysLoadedYear = year;
  state.cache.holidays = {}; // reset for year
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const key = dateKeyFromDate(d);
    const name = hebrewHolidayForDate(new Date(d));
    if (name) state.cache.holidays[key] = { name };
  }
}
// ---------- דיבור + הומור של ג'יחרי (קול עמוק, כריזמטי ומגניב) ----------
let gihariVoice = null;
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  const heVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("he"));
  gihariVoice =
    heVoices.find((v) => /avri|male|natural|wavenet|neural|carmit|asaf/i.test(v.name)) ||
    heVoices.find((v) => /google|microsoft|enhanced/i.test(v.name)) ||
    heVoices[0] ||
    voices[0] ||
    null;
}
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = loadVoices;

function getCoolGihariAlertLine(titleText) {
  const clean = (titleText || "אירוע ביומן").trim();
  const lines = [
    `יאללה אחי, ג'יחרי על הקו – הגיע הזמן ל${clean}`,
    `היי אחי, כאן ג'יחרי. תזכורת אש בשבילך: ${clean}`,
    `ג'יחרי מדווח מהשטח: הגיע הזמן ל${clean}`
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function gihariSpeak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  if (typeof getEffectiveSoundMode === "function" && getEffectiveSoundMode() !== "ring") return;
  try {
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "he-IL";
    utter.rate = 1.08;
    utter.pitch = 0.82;
    utter.volume = 1.0;
    if (gihariVoice) utter.voice = gihariVoice;
    speechSynthesis.speak(utter);
  } catch {}
}

function wrapGihariHumor(html) {
  const families = [
    ["סגור אחי, עליי. 😎", "לגמרי, מטפל בזה בשקט. 🧘‍♂️", "קיבלתי, ממשיך לעבוד. 😉"],
    ["אם זה לא יעבוד, תקלל אותי בצדק. 😂", "שנייה, בודק… 🤖", "אל תספר לאף אחד שאני יותר מסודר ממך. 🤫"],
    ["וואלה בלי העזרה שלי היית הולך לאיבוד ביומן. 🔥", "הפעם אני מסדר. 😏", "בפעם הבאה תביא גם בורקס. 😜"],
    ["לוגיסטית זו הייתה בקשה חכמה. 📊", "שיקללתי דחיפות, עומס ומשך. 🧠", "התאמתי את זה בין העומס שלך. 💡"]
  ];
  const fam = families[Math.floor(Math.random() * families.length)];
  const line = fam[Math.floor(Math.random() * fam.length)];
  return `${line}<br>${html}`;
}

function showToast(text = "בוצע", durationMs = 2500) {
  const t = el("toast");
  if (!t) return;
  t.textContent = text;
  t.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add("hidden"), durationMs);
}

const CUSTOM_BG_VARS = ["--bg-grad", "--accent", "--accent-2", "--accent-soft", "--glow-a", "--glow-b"];

function clearCustomBgVars() {
  CUSTOM_BG_VARS.forEach((v) => document.body.style.removeProperty(v));
}

function applyBackground(bg) {
  // הסרת כל bg-* בלי לגעת בשאר המחלקות (dark וכו')
  Array.from(document.body.classList).forEach((cls) => {
    if (cls.startsWith("bg-")) document.body.classList.remove(cls);
  });
  clearCustomBgVars();

  // הוספת הרקע החדש
  document.body.classList.add("bg-" + bg);

  // שמירה
  localStorage.setItem("appBackground", bg);

  // סימון כפתור פעיל
  document.querySelectorAll("#bgSelector button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.bg === String(bg));
  });
}

// צבע מותאם אישית – כל גוון שהמשתמש בוחר (נבנה ממנו גרדיאנט וצבעי הדגשה)
function applyCustomBackground(hex) {
  if (!hex) return;
  Array.from(document.body.classList).forEach((cls) => {
    if (cls.startsWith("bg-")) document.body.classList.remove(cls);
  });
  document.body.classList.add("bg-custom");
  const s = document.body.style;
  s.setProperty("--bg-grad", `linear-gradient(160deg, ${hex} 0%, color-mix(in srgb, ${hex} 58%, #000) 55%, color-mix(in srgb, ${hex} 24%, #000) 100%)`);
  s.setProperty("--accent", `color-mix(in srgb, ${hex} 80%, #000)`);
  s.setProperty("--accent-2", `color-mix(in srgb, ${hex} 55%, #7c3aed)`);
  s.setProperty("--accent-soft", `color-mix(in srgb, ${hex} 18%, transparent)`);
  s.setProperty("--glow-a", `color-mix(in srgb, ${hex} 40%, transparent)`);
  s.setProperty("--glow-b", `color-mix(in srgb, ${hex} 28%, transparent)`);
  try {
    localStorage.setItem("appBackground", "custom");
    localStorage.setItem("appBackgroundHex", hex);
  } catch {}
  document.querySelectorAll("#bgSelector button").forEach((btn) => btn.classList.remove("active"));
}


const savedBg = localStorage.getItem("appBackground");
const savedBgHex = localStorage.getItem("appBackgroundHex");
if (savedBg === "custom" && savedBgHex) applyCustomBackground(savedBgHex);
else applyBackground(savedBg || "1");

// ===============================
// סוג כתב (נשמר במכשיר)
// ===============================
function applyFont(font) {
  const f = font || "heebo";
  document.body.setAttribute("data-font", f);
  try { localStorage.setItem("appFont", f); } catch {}
  document.querySelectorAll("#fontSelector button").forEach((b) => {
    b.classList.toggle("active", b.dataset.font === f);
  });
  const fontNameEl = document.getElementById("fontCurrentName");
  const activeFontBtn = document.querySelector("#fontSelector button.active");
  if (fontNameEl && activeFontBtn) fontNameEl.textContent = activeFontBtn.textContent.trim();
}
applyFont(localStorage.getItem("appFont"));
const fontSelectorEl = document.getElementById("fontSelector");
if (fontSelectorEl) {
  fontSelectorEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b && b.dataset.font) applyFont(b.dataset.font);
  });
}

// ===============================
// BG SELECTOR – FIX (REAL)
// ===============================
const bgSelector = document.getElementById("bgSelector");

if (bgSelector) {
  bgSelector.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const bg = btn.dataset.bg;
    if (!bg) return;

    applyBackground(bg);
  });
}


// ===============================
// חלוניות בחירה (רקע / כתב) – נפתחות רק בלחיצה על ✏️ בהגדרות
// ===============================
(function initPickerModals() {
  const bind = (btnId, modalId) => {
    const btn = document.getElementById(btnId);
    const modal = document.getElementById(modalId);
    if (!btn || !modal) return;
    btn.addEventListener("click", () => modal.classList.remove("hidden"));
    modal.querySelectorAll("[data-close-picker]").forEach((x) =>
      x.addEventListener("click", () => modal.classList.add("hidden"))
    );
  };
  bind("btnEditBg", "bgPickerModal");
  bind("btnEditFont", "fontPickerModal");

  // בחירת ערכה / כתב סוגרת את החלונית
  const closeSoon = (modalId) => setTimeout(() => document.getElementById(modalId)?.classList.add("hidden"), 180);
  document.getElementById("bgSelector")?.addEventListener("click", (e) => {
    if (e.target.closest("button")) closeSoon("bgPickerModal");
  });
  document.getElementById("fontSelector")?.addEventListener("click", (e) => {
    if (e.target.closest("button")) closeSoon("fontPickerModal");
  });

  const colorInput = document.getElementById("customBgColor");
  if (colorInput) {
    const savedHex = localStorage.getItem("appBackgroundHex");
    if (savedHex) colorInput.value = savedHex;
    colorInput.addEventListener("input", () => applyCustomBackground(colorInput.value));
  }
})();

const btnDisableNotif = document.getElementById("btnDisableNotifications");

if (btnDisableNotif) {
  btnDisableNotif.onclick = () => {
    localStorage.setItem("notificationsEnabled", "false");
    state.ui.notificationsGranted = false;
    if (hasNativeAndroidBridge()) {
      try { window.AndroidBridge.setNotificationsEnabled(false); } catch (e) {}
    }
    if (typeof stopAlarmLoop === "function") stopAlarmLoop();
    if (typeof stopKeepAliveAudio === "function") stopKeepAliveAudio();
    showToast("🔕 התראות כובו – לא יופעלו התראות עד להפעלה מחדש", 3500);
  };
}


// =========================
// Conflict detection helpers
// =========================

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isEndBeforeStart(start, end) {
  if (!start || !end) return false;
  return timeToMinutes(end) <= timeToMinutes(start);
}

function eventsOverlap(a, b) {
  if (!a.startTime || !b.startTime) return false;

  const aStart = timeToMinutes(a.startTime);
  const aEnd   = timeToMinutes(a.endTime || a.startTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd   = timeToMinutes(b.endTime || b.startTime);

 // התנגשות גם אם זה בדיוק באותה דקה
return aStart <= bEnd && bStart <= aEnd;
}

function isRelevantByOwner(existingOwner, newOwner) {
  if (existingOwner === "shared" || newOwner === "shared") return true;
  return existingOwner === newOwner;
}

function findConflicts(dateKey, newEvent, excludeId = null) {
  const dayEvents = state.cache.events[dateKey] || {};
  const conflicts = [];

  Object.entries(dayEvents).forEach(([id, ev]) => {
    if (excludeId && id === excludeId) return;
    if (isDefaultEvent(ev)) return;
    if (!isRelevantByOwner(ev.owner, newEvent.owner)) return;
    if (!eventsOverlap(ev, newEvent)) return;

    conflicts.push({ id, ...ev });
  });

  return conflicts;
}

// =========================
// Calendar render
// =========================
function isSelsText(str) {
  return /sels/i.test(String(str || ""));
}

function isSelsEvent(ev) {
  if (!ev) return false;
  return /sels/i.test(`${ev.title || ""} ${ev.description || ""} ${ev.goalTitle || ""}`);
}

function shouldHideRecurringParentOnDate(ev, id, dateKey, dayEventsObj) {
  if (!ev || !ev.isRecurringParent) return false;
  const eventsOnDay = dayEventsObj || state.cache.events?.[dateKey] || {};
  if (eventsOnDay[`${id}_${dateKey}`]) return true;
  if (Array.isArray(ev.excludedDates) && ev.excludedDates.includes(dateKey)) return true;
  return false;
}

// מנוע זיהוי אייקונים חכמים ומשעשעים למשימות ואירועים בלוח השנה
function getSmartFunnyEventIcon(ev) {
  if (!ev) return "📌";
  const text = `${ev.title || ""} ${ev.description || ""} ${ev.goalTitle || ""}`.toLowerCase();

  // 0. קטגוריית SELS -> אייקון של מעלית 🛗
  if (/sels/i.test(text)) {
    return "🛗";
  }

  // 1. ניקיון, שטיפה, ספונג'ה, אבק, סדר -> מנקה אתיופית עם מטאטא 😂
  if (/(ניקיון|לנקות|נקיון|שטיפה|לשטוף|ספונג|אבק|לטאטא|שואב|לשאוב|אקונומיקה|חלונות|שירותים|מנקה|קרצוף|פאנלים|לסדר את הבית|סידור הבית)/i.test(text)) {
    return "👩🏿‍🦱🧹";
  }
  // 2. כביסה, קיפול, גיהוץ
  if (/(כביסה|מכונת כביסה|לקפל|קיפול|מייבש|לגהץ|גיהוץ|אטבים)/i.test(text)) {
    return "👩🏿‍🦱🧺";
  }
  // 3. כלים ומדיח
  if (/(כלים|מדיח|כיור)/i.test(text)) {
    return "🧽";
  }
  // 4. זבל ואשפה
  if (/(זבל|אשפה|להוריד את הפח|פח זבל|מיחזור|בקבוקים)/i.test(text)) {
    return "🗑️";
  }
  // 5. שיפוצניק / משימות הנדימן לגברים (לתלות, להדביק, לקדוח, לתקן, להרכיב וכו')
  if (/(לתלות|להדביק|לקדוח|להרכיב|לפרק|לתקן|תיקון|שיפוץ|מדף|תמונה|ברגים|בורג|דיבל|מקדחה|פטיש|מברגה|אינסטלצ|סתימה|נזילה|ברז|חשמל|נורה|מנורה|מזגן|פילטר|לצבוע|צביעה|שפכטל|סיליקון|ארון|שידה|איקאה|הנדימן)/i.test(text)) {
    return "👷🏾‍♂️🛠️";
  }
  // 6. שיחות וטלפונים (שיחה עם X, להתקשר, טלפון, לצלצל)
  if (/(שיחה|להתקשר|טלפון|לצלצל|לחזור ל|לדבר עם|פלאפון|חיוג)/i.test(text)) {
    return "📞";
  }
  // 7. הודעות, וואטסאפ, מיילים
  if (/(וואטסאפ|ווצאפ|whatsapp|הודעה|לשלוח|סמס|מייל|אימייל)/i.test(text)) {
    return "💬";
  }
  // 8. קניות וסופר
  if (/(סופר|קניות|לקנות|רמי לוי|שופרסל|יוחננוף|אושר עד|ויקטורי|קרפור|מכולת|ירקן|קצב|מאפייה|חלב|לחם)/i.test(text)) {
    return "🛒";
  }
  // 9. שופינג, קניון, חבילות ודואר
  if (/(חבילה|דואר|משלוח|איסוף)/i.test(text)) {
    return "📦";
  }
  if (/(שופינג|קניון|בגדים|זארה|שיין|shein|עליאקספרס|אמזון|נעליים)/i.test(text)) {
    return "🛍️";
  }
  // 10. כסף, תשלומים, בנק, חשבונות ובירוקרטיה -> כסף עף 💸
  if (/(לשלם|תשלום|בנק|העברה|ביט|פייבוקס|ארנונה|חשבונית|מס הכנסה|ביטוח|משכנתא|שכירות|כסף|משכורת|רואה חשבון|דוח|קנס|טופס|חוזה|אגרה)/i.test(text)) {
    return "💸";
  }
  // 11. כושר, אימון וספורט
  if (/(אימון|כושר|חדר כושר|מכון|ריצה|לרוץ|הליכה|פילאטיס|יוגה|שחייה|כדורגל|כדורסל|משקולות|ספורט|חיטוב)/i.test(text)) {
    return ev.owner === "nana" ? "🧘🏻‍♀️" : "🏋️‍♂️";
  }
  // 12. טיפוח, לק, תספורת, מספרה
  if (/(לק|ציפורניים|מניקור|פדיקור|גבות|שעווה|לייזר|קוסמטיקאית|פן|החלקה|איפור)/i.test(text)) {
    return "💅";
  }
  if (/(תספורת|ספר|מספרה|זקן|דירוג)/i.test(text)) {
    return ev.owner === "nana" ? "💇‍♀️" : "💈";
  }
  // 13. רופא, שיניים, בדיקות, תרופות
  if (/(שיניים|שיננית|אורתודנט|סתימה בשן)/i.test(text)) {
    return "🦷";
  }
  if (/(רופא|תור ל|מרפאה|בדיקה|בדיקת דם|קופת חולים|בית חולים|אולטרסאונד|פיזיותרפיה|בית מרקחת|תרופה|כדור|מרשם)/i.test(text)) {
    return "🩺";
  }
  // 14. רכב, מוסך, טסט, דלק
  if (/(דלק|לתדלק|תחנת דלק)/i.test(text)) {
    return "⛽";
  }
  if (/(רכב|אוטו|מוסך|טסט|טיפול לרכב|שטיפת רכב|פנצ'ר|צמיגים|חניה)/i.test(text)) {
    return "🚗";
  }
  // 15. טיסות, חופשות, מלון
  if (/(טיסה|נתב"ג|דרכון|חו"ל)/i.test(text)) {
    return "✈️";
  }
  if (/(חופשה|מלון|צימר|נופש|אילת|ים המלח|בריכה|ים)/i.test(text)) {
    return "🏖️";
  }
  // 16. בישולים, אוכל, מסעדות ודייטים
  if (/(לבשל|בישול|להכין אוכל|אפייה|לאפות|עוגה|חלות|סירים|מטבח)/i.test(text)) {
    return "👩🏽‍🍳";
  }
  if (/(דייט|מסעדה|בית קפה|סושי|פיצה|המבורגר|על האש|מנגל|בראנץ|ארוחת ערב|קפה)/i.test(text)) {
    return "🥂";
  }
  // 17. אירועים, חתונות, ימי הולדת, מתנות
  if (/(יום הולדת|יומולדת|מזל טוב)/i.test(text)) {
    return "🎂";
  }
  if (/(חתונה|חינה|אירוסין|בר מצווה|בת מצווה|ברית|אירוע|מסיבה)/i.test(text)) {
    return "💃";
  }
  if (/(מתנה|פרחים|זר)/i.test(text)) {
    return "🎁";
  }
  // 18. תפילה, תורה, לימודים, מקווה
  if (/(תפילה|בית כנסת|מניין|שחרית|מנחה|ערבית|תהילים|שיעור תורה|כולל|רב)/i.test(text)) {
    return "🕍";
  }
  if (/(מקווה|הפרשת חלה|נרות שבת)/i.test(text)) {
    return "🕯️";
  }
  if (/(לימוד|ללמוד|שיעור|מבחן|קורס|הרצאה|עבודה סמינריונית)/i.test(text)) {
    return "📚";
  }
  // 19. עבודה, פגישות, זום
  if (/(פגישה|ישיבה|זום|zoom|משרד|לקוח|פרויקט|מצגת|ראיון|משמרת)/i.test(text)) {
    return "💼";
  }
  // 20. משפחה, הורים
  if (/(אמא|אבא|הורים|סבתא|סבא|משפחה|אחים|ארוחת שישי|שבת אצל)/i.test(text)) {
    return "👨‍👩‍👧";
  }
  // 21. זוגיות, אהבה, סרט, ספא
  if (/(סרט|קולנוע|נטפליקס)/i.test(text)) {
    return "🍿";
  }
  if (/(מסאז|עיסוי|ספא)/i.test(text)) {
    return "💆‍♂️";
  }
  if (/(זוגי|אהבה|רומנטי)/i.test(text)) {
    return "❤️";
  }
  if (/(שנ"צ|שנצ|לישון|מנוחה|תנומה)/i.test(text)) {
    return "😴";
  }

  return ev.type === "task" ? "📌" : "🗓️";
}

function renderCalendar() {
  const grid = el("calendarGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const currentMonthDate = state.currentDate;
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  ensureYearHolidays(year);

  preloadShabbatForVisibleMonth();

  preloadDefaultEventsForVisibleMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const today = new Date();

  el("gregMonthLabel").textContent = firstDayOfMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" });
  el("hebrewMonthLabel").textContent = getHebrewMonthYearLabel(firstDayOfMonth) || "";

// חישוב כמה תאים באמת צריך (4–6 שבועות)
const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
  for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";

    let dayNum;
    let cellDate;
    let outside = false;

    if (cellIndex < startDay) {
      dayNum = prevMonthDays - startDay + cellIndex + 1;
      cellDate = new Date(year, month - 1, dayNum);
      outside = true;
    } else if (cellIndex >= startDay + daysInMonth) {
      dayNum = cellIndex - startDay - daysInMonth + 1;
      cellDate = new Date(year, month + 1, dayNum);
      outside = true;
    } else {
      dayNum = cellIndex - startDay + 1;
      cellDate = new Date(year, month, dayNum);
    }

    const dateKey = dateKeyFromDate(cellDate);
    const heb = formatHebrewDate(cellDate);
    const holiday = state.cache.holidays[dateKey];
    const events = state.cache.events[dateKey] || {};

    const realEvents = Object.entries(events)
      .filter(
        ([eid, ev]) =>
          ev &&
          !isDefaultEvent(ev) &&
          !shouldHideRecurringParentOnDate(ev, eid, dateKey, events) &&
          matchesQuickOwnerFilter(ev, state.ui.calendarOwnerFilter || "all", dateKey)
      )
      .map(([, ev]) => ev)
      .sort(compareEventsByTimeAndContainment);
    
    const header = document.createElement("div");
    header.className = "day-header";

    const dayNumEl = document.createElement("div");
    dayNumEl.className = "day-num";
    dayNumEl.textContent = dayNum;

    const hebEl = document.createElement("div");
    hebEl.className = "day-hebrew";
    const hebDay = hasHebcal()
      ? new window.Hebcal.HDate(cellDate).getDate()
      : null;

    hebEl.textContent = hebDay ? toHebrewNumeral(hebDay) : "";

    header.appendChild(dayNumEl);
    header.appendChild(hebEl);
    cell.appendChild(header);

    if (holiday) {
      const holidayEl = document.createElement("div");
      holidayEl.className = "day-holiday";
      holidayEl.textContent = holiday.name;
      cell.appendChild(holidayEl);
    }

    // ערב שבת ושבת – עם זמני הדלקה/צאת שבת
    let shabbatLabel = null;
    let fridayForTimes = null;
    if (isFriday(cellDate)) {
      shabbatLabel = "ערב שבת";
      fridayForTimes = new Date(cellDate);
    } else if (isShabbat(cellDate)) {
      shabbatLabel = "שבת";
      fridayForTimes = new Date(cellDate);
      fridayForTimes.setDate(fridayForTimes.getDate() - 1);
    }

    if (shabbatLabel && fridayForTimes) {
      const shabbatWrap = document.createElement("div");
      shabbatWrap.className = "day-shabbat-block";

      const line1 = document.createElement("div");
      line1.className = "day-shabbat-title";
      line1.textContent = shabbatLabel;
      shabbatWrap.appendChild(line1);

      const line2 = document.createElement("div");
      line2.className = "day-shabbat-time";
      line2.textContent = "טוען זמני שבת...";
      shabbatWrap.appendChild(line2);

      cell.appendChild(shabbatWrap);

      ensureShabbatForWeek(fridayForTimes).then((info) => {
        if (!info) { line2.textContent = ""; return; }
        if (isFriday(cellDate) && info.candle) line2.textContent = `כניסת שבת: ${formatTimeHM(info.candle)}`;
        else if (isShabbat(cellDate) && info.havdalah) line2.textContent = `צאת שבת: ${formatTimeHM(info.havdalah)}`;
        else line2.textContent = "";
      });
    }

    const pointsRow = document.createElement("div");
    pointsRow.className = "day-points";

    const maxVisibleIcons = shabbatLabel ? 2 : 3;
    realEvents.slice(0, maxVisibleIcons).forEach((ev) => {
      const badge = document.createElement("div");
      badge.className = "cal-smart-icon-badge";
      if (ev.type === "task") badge.classList.add("task");
      if (ev.completed || ev.completedAt) badge.classList.add("done");
      badge.classList.add(`owner-${ev.owner || "shared"}`);
      badge.title = `${ev.title || "אירוע"}${ev.startTime ? " (" + ev.startTime + ")" : ""}`;
      badge.textContent = getSmartFunnyEventIcon(ev);
      pointsRow.appendChild(badge);
    });

    if (realEvents.length > maxVisibleIcons) {
      const moreBadge = document.createElement("div");
      moreBadge.className = "cal-icon-more";
      moreBadge.textContent = `+${realEvents.length - maxVisibleIcons}`;
      pointsRow.appendChild(moreBadge);
    }

    if (realEvents.length > 0) {
      cell.appendChild(pointsRow);

      // אפשרות 4: פס מד-עומס צבעוני וזוהר בתחתית הקובייה לפי צבעי המשתמשים
      const glowStrip = document.createElement("div");
      glowStrip.className = "day-glow-strip";
      realEvents.forEach((ev) => {
        const seg = document.createElement("span");
        seg.className = `day-glow-seg owner-${ev.owner || "shared"}${ev.completed || ev.completedAt ? " done" : ""}`;
        glowStrip.appendChild(seg);
      });
      cell.appendChild(glowStrip);
    }
    if (realEvents.length >= 2) cell.classList.add("day-border-glow");
    if (outside) cell.classList.add("outside");
    if (isSameDay(cellDate, today)) cell.classList.add("day-cell-today");

    cell.addEventListener("click", () => openDayModal(cellDate));
    grid.appendChild(cell);
  }

  renderSpecialCountdownsBar();
}

// =========================
// Special Couple Countdowns Capsule
// =========================
function getSavedSpecialEvents() {
  let local = {};
  try {
    const raw = localStorage.getItem("bnapp_special_events");
    if (raw) local = JSON.parse(raw) || {};
  } catch {}
  return {
    ...local,
    ...(state.settings.specialEvents || {})
  };
}

function renderSpecialCountdownsBar() {
  const bar = el("specialCountdownsBar");
  if (!bar) return;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayKey = dateKeyFromDate(now);

  const items = [];
  const saved = getSavedSpecialEvents();
  Object.entries(saved).forEach(([id, item]) => {
    if (!item || !item.dateKey || !item.title) return;
    const d = parseDateKey(item.dateKey);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);
    if (diffDays >= 0 && diffDays <= 365) {
      items.push({
        id,
        title: item.title,
        dateKey: item.dateKey,
        emoji: item.emoji || "🎉",
        diffDays,
        isCustomSpecial: true
      });
    }
  });

  // זיהוי חכם של אירועים מיוחדים מתוך היומן (יום הולדת, יום נישואין, חופשה, טיסה וכו')
  const SPECIAL_KEYWORDS = ["יום הולדת", "יומולדת", "יום נישואין", "נישואין", "חופשה", "טיסה", "מלון", "צימר", "חתונה"];
  Object.entries(state.cache.events || {}).forEach(([dk, dayMap]) => {
    if (!dk || dk === "undated" || dk < todayKey) return;
    const d = parseDateKey(dk);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);
    if (diffDays < 0 || diffDays > 180) return;

    Object.entries(dayMap || {}).forEach(([id, ev]) => {
      if (!ev || isDefaultEvent(ev)) return;
      const t = (ev.title || "").trim();
      if (!SPECIAL_KEYWORDS.some((kw) => t.includes(kw))) return;
      if (items.some((x) => x.title === t && x.dateKey === dk)) return;
      let emoji = "🎉";
      if (t.includes("הולדת") || t.includes("יומולדת")) emoji = "🎂";
      else if (t.includes("נישואין")) emoji = "💍";
      else if (t.includes("חופשה") || t.includes("טיסה") || t.includes("מלון") || t.includes("צימר")) emoji = "✈️";
      items.push({
        id,
        title: t,
        dateKey: dk,
        emoji,
        diffDays,
        isCustomSpecial: false
      });
    });
  });

  items.sort((a, b) => a.diffDays - b.diffDays);

  const pillsHtml = items
    .slice(0, 4)
    .map((it) => {
      const daysTxt =
        it.diffDays === 0
          ? "היום! 🥳"
          : it.diffDays === 1
            ? "מחר! ✨"
            : `בעוד ${it.diffDays} ימים`;
      return `
        <button type="button" class="countdown-capsule" onclick="openSpecialEventsModal()" title="${formatShortDateHe(it.dateKey)}">
          <span class="cd-emoji">${it.emoji}</span>
          <span class="cd-title">${it.title}</span>
          <span class="cd-days">${daysTxt}</span>
        </button>
      `;
    })
    .join("");

  bar.innerHTML = `
    ${pillsHtml || `<button type="button" class="countdown-capsule empty" onclick="openSpecialEventsModal()">🎉 + הוסף ספירה לאחור לאירוע מיוחד</button>`}
    ${items.length ? `<button type="button" class="countdown-add-btn" onclick="openSpecialEventsModal()" title="נהל אירועים מיוחדים">+🎉</button>` : ""}
  `;
}

function openSpecialEventsModal() {
  const modal = el("specialEventsModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  const dateIn = el("specialEventDate");
  if (dateIn && !dateIn.value) {
    dateIn.value = dateKeyFromDate(new Date());
  }

  let selectedEmoji = qs("#specialEmojiPicker button.active")?.dataset.emoji || "💍";
  qsa("#specialEmojiPicker button").forEach((btn) => {
    btn.onclick = () => {
      qsa("#specialEmojiPicker button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedEmoji = btn.dataset.emoji || "🎉";
    };
  });

  const renderSpecialList = () => {
    const listEl = el("specialEventsList");
    if (!listEl) return;
    const saved = getSavedSpecialEvents();
    const entries = Object.entries(saved).sort((a, b) =>
      (a[1]?.dateKey || "").localeCompare(b[1]?.dateKey || "")
    );
    if (!entries.length) {
      listEl.innerHTML = `<div class="stats-empty-tab">עדיין לא הוגדרו אירועים מיוחדים לספירה לאחור</div>`;
      return;
    }
    listEl.innerHTML = entries
      .map(
        ([id, item]) => `
        <div class="task-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;">
          <div>
            <div class="task-title">${item.emoji || "🎉"} ${item.title}</div>
            <div class="task-meta">📅 ${formatShortDateHe(item.dateKey)}</div>
          </div>
          <button type="button" class="ghost-pill small" data-del-special="${id}">🗑</button>
        </div>
      `
      )
      .join("");

    listEl.querySelectorAll("[data-del-special]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delSpecial;
        const current = getSavedSpecialEvents();
        delete current[id];
        state.settings.specialEvents = current;
        try {
          localStorage.setItem("bnapp_special_events", JSON.stringify(current));
        } catch {}
        renderSpecialList();
        renderSpecialCountdownsBar();
        try {
          await set(ref(db, "settings/specialEvents"), current);
        } catch {}
      };
    });
  };

  renderSpecialList();

  if (el("btnAddSpecialEvent")) {
    el("btnAddSpecialEvent").onclick = async () => {
      const title = (el("specialEventTitle")?.value || "").trim();
      const dateKey = el("specialEventDate")?.value || "";
      const emoji = qs("#specialEmojiPicker button.active")?.dataset.emoji || selectedEmoji || "🎉";
      if (!title || !dateKey) {
        showToast("נא להזין שם אירוע ותאריך");
        return;
      }
      const id = "sp_" + Date.now();
      const current = getSavedSpecialEvents();
      current[id] = { title, dateKey, emoji };
      state.settings.specialEvents = current;
      try {
        localStorage.setItem("bnapp_special_events", JSON.stringify(current));
      } catch {}
      if (el("specialEventTitle")) el("specialEventTitle").value = "";
      renderSpecialList();
      renderSpecialCountdownsBar();
      showToast("🎉 נוסף לספירה לאחור!");
      try {
        await update(ref(db, "settings/specialEvents"), { [id]: { title, dateKey, emoji } });
      } catch {}
    };
  }

  qsa("[data-close-special]", modal).forEach((b) => {
    b.onclick = () => modal.classList.add("hidden");
  });
}

// =========================
// Rollover Missed Tasks/Events from Past Days to Today
// =========================
function getPastUncompletedItemsForUser(typeFilter = "all") {
  const todayKey = dateKeyFromDate(new Date());
  const results = [];
  Object.entries(state.cache.events || {}).forEach(([dk, dayMap]) => {
    if (!dk || dk === "undated" || dk >= todayKey) return;
    Object.entries(dayMap || {}).forEach(([id, ev]) => {
      if (!ev) return;
      if (isDefaultEvent(ev) || isRoutineStatEvent(ev)) return;
      if (ev.completed || ev.completedAt) return;
      if (ev.isRecurringParent && ev.recurring && ev.recurring !== "none") return;
      if (!isEventRelevantForUser(ev, state.currentUser)) return;
      if (typeFilter === "task" && ev.type !== "task") return;
      if (typeFilter === "event" && ev.type === "task") return;
      results.push({ ...ev, _id: ev._id || id, dateKey: dk });
    });
  });
  return results;
}

function updateRolloverMissedButton() {
  const btn = el("btnRolloverMissedTasks");
  if (!btn) return;
  const pastMissed = getPastUncompletedItemsForUser("all");
  btn.classList.remove("hidden");
  if (pastMissed.length > 0) {
    btn.disabled = false;
    btn.classList.add("has-items");
    btn.textContent = `⏭️ העבר ${pastMissed.length} שחלפו להיום`;
    btn.onclick = () => rolloverPastUncompletedToToday("all");
  } else {
    btn.disabled = true;
    btn.classList.remove("has-items");
    btn.textContent = "✅ אין משימות שחלפו";
    btn.onclick = null;
  }
}

function getTomorrowKey() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKeyFromDate(d);
}

function markRecurringParentExcludedDate(seriesIdOrInstanceId, excludedDk, multiMap) {
  if (!seriesIdOrInstanceId || !excludedDk) return;
  const baseId = String(seriesIdOrInstanceId).replace(/_\d{4}-\d{2}-\d{2}$/, "");
  if (!baseId) return;
  Object.entries(state.cache.events || {}).forEach(([pDk, dayItems]) => {
    const parentObj = dayItems?.[baseId];
    if (parentObj && (parentObj.isRecurringParent || (parentObj.recurring && parentObj.recurring !== "none"))) {
      const prevEx = Array.isArray(parentObj.excludedDates) ? parentObj.excludedDates : [];
      if (!prevEx.includes(excludedDk)) {
        parentObj.excludedDates = [...prevEx, excludedDk];
        if (multiMap) {
          multiMap[`${pDk}/${baseId}/excludedDates`] = parentObj.excludedDates;
        }
      }
    }
  });
}

// העברת רשימת פריטים לתאריך חדש (אופציונלית גם שעה חדשה) – שומר משך ומעדכן הכל מיד
async function moveItemsToDate(items, toDk, newStartTime) {
  let moved = 0;
  if (!state.cache.events[toDk]) state.cache.events[toDk] = {};
  const multi = {};

  for (const item of items) {
    const id = item._id || item.id;
    const oldDk = item.dateKey;
    if (!id || !oldDk) continue;
    if (oldDk === toDk && !newStartTime) continue;

    const source = state.cache.events?.[oldDk]?.[id] || item;
    const updatedObj = { ...source, _id: id, dateKey: toDk };
    delete updatedObj.effectiveDuration;
    delete updatedObj.id;

    if (newStartTime) {
      const dur = getEffectiveDurationMinutes(source);
      updatedObj.startTime = newStartTime;
      updatedObj.endTime = addMinutesToTimeStr(newStartTime, dur);
    }
    // תזכורת ישנה כבר לא רלוונטית
    updatedObj.reminderCustomTs = null;
    updatedObj.reminderDate = null;
    updatedObj.remindedAt = null;
    updatedObj.remindedAt_binyamin = null;
    updatedObj.remindedAt_nana = null;
    updatedObj.remindedAt_shared = null;

    if (oldDk !== toDk && (source.isRecurringInstance || source.parentId || /_\d{4}-\d{2}-\d{2}$/.test(String(id)))) {
      markRecurringParentExcludedDate(source.parentId || id, oldDk, multi);
      updatedObj.isRecurringInstance = null;
      updatedObj.isRecurringParent = null;
      updatedObj.parentId = null;
      updatedObj.recurring = "none";
    } else {
      updatedObj.isRecurringInstance = source.isRecurringInstance || null;
    }

    state.cache.events[toDk][id] = updatedObj;
    if (oldDk !== toDk && state.cache.events[oldDk]) {
      delete state.cache.events[oldDk][id];
      cancelDirectReminder(`${oldDk}/${id}`);
    }

    multi[`${toDk}/${id}`] = updatedObj;
    if (oldDk !== toDk) multi[`${oldDk}/${id}`] = null;
    moved++;
  }

  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
    renderDayEvents(state.ui.openDayKey);
    updateDayRolloverButton(state.ui.openDayKey);
  }
  try { updateStats(); } catch {}
  if (!el("dailySummaryModal")?.classList.contains("hidden")) {
    try { renderDailySummaryModal(state.ui.summaryDayKey); } catch {}
  }

  try {
    if (Object.keys(multi).length) await update(ref(db, "events"), multi);
  } catch (e) {
    console.warn("move error:", e);
  }
  return moved;
}

function findCachedItem(id, dk) {
  const ev = state.cache.events?.[dk]?.[id];
  return ev ? { ...ev, _id: ev._id || id, dateKey: dk } : null;
}

// העברה של פריט אחד ליום שאחריו (אם היום שאחריו כבר עבר – להיום)
async function moveItemToNextDay(id, dk) {
  const item = findCachedItem(id, dk);
  if (!item) return;
  const todayKey = dateKeyFromDate(new Date());
  let target;
  if (!dk || dk === "undated") target = getTomorrowKey();
  else {
    const d = parseDateKey(dk);
    d.setDate(d.getDate() + 1);
    target = dateKeyFromDate(d);
    if (target < todayKey) target = todayKey;
  }
  await moveItemsToDate([item], target);
  showToast(`⏭️ "${item.title || "פריט"}" הועבר ל-${formatShortDateHe(target)}`);
}

function postponeItemById(id, dk) {
  const item = findCachedItem(id, dk);
  if (item) openPostponeModal(item);
}

function getUncompletedItemsOfDay(dk) {
  const res = [];
  Object.entries(state.cache.events?.[dk] || {}).forEach(([id, ev]) => {
    if (!ev || isDefaultEvent(ev) || isRoutineStatEvent(ev)) return;
    if (ev.completed || ev.completedAt) return;
    if (ev.isRecurringParent && ev.recurring && ev.recurring !== "none") return;
    if (ev.isRecurringInstance) return; // מופע חוזר – יופיע שוב ממילא
    if (!isEventRelevantForUser(ev, state.currentUser)) return;
    res.push({ ...ev, _id: ev._id || id, dateKey: dk });
  });
  return res;
}

function updateDayRolloverButton(dk) {
  const btn = el("btnDayRollover");
  if (!btn) return;
  const todayKey = dateKeyFromDate(new Date());
  const items = getUncompletedItemsOfDay(dk);
  if (dk > todayKey || !items.length) {
    btn.classList.add("hidden");
    btn.onclick = null;
    return;
  }
  const toDk = dk < todayKey ? todayKey : getTomorrowKey();
  const label = dk < todayKey ? "להיום" : "למחר";
  btn.classList.remove("hidden");
  btn.textContent = `⏭️ העבר ${items.length} שלא בוצעו ${label}`;
  btn.onclick = () => {
    openRolloverSelectModal({
      items: getUncompletedItemsOfDay(dk),
      targetDateKey: toDk,
      targetLabel: label,
      titleText: `⏭️ העברת משימות שלא בוצעו ${label}`
    });
  };
}

function openRolloverSelectModal({ items, targetDateKey, targetLabel = "להיום", titleText = "⏭️ העברת משימות שחלפו להיום" }) {
  const modal = el("rolloverSelectModal");
  if (!modal) return;

  const close = () => modal.classList.add("hidden");
  qsa("[data-close-rollover]", modal).forEach((b) => (b.onclick = close));
  const bd = qs(".modal-backdrop", modal);
  if (bd) bd.onclick = close;

  let currentItems = [...(items || [])];
  if (!currentItems.length) {
    showToast("אין משימות שחלפו להעברה");
    close();
    return;
  }

  const titleEl = el("rolloverModalTitle");
  const subEl = el("rolloverModalSub");
  const listEl = el("rolloverModalList");
  const selectAllChk = el("rolloverSelectAllChk");
  const btnMoveSelected = el("btnRolloverMoveSelected");
  const btnMoveAll = el("btnRolloverMoveAll");

  if (titleEl) titleEl.textContent = titleText;

  const ownerBadgeText = (owner) =>
    owner === "shared" ? "משותף 👥" : owner === "nana" ? "ננה 💖" : "בנימין 💙";

  const renderList = () => {
    if (!currentItems.length) {
      close();
      showToast(`✅ כל המשימות שנבחרו הועברו ${targetLabel}!`);
      return;
    }

    if (subEl) subEl.textContent = `${currentItems.length} פריטים זמינים להעברה`;
    if (btnMoveAll) btnMoveAll.textContent = `⏭️ העבר הכל ${targetLabel} (${currentItems.length})`;

    listEl.innerHTML = currentItems
      .map((it, idx) => {
        const timeStr = it.startTime
          ? `🕒 ${it.startTime}${it.endTime ? "–" + it.endTime : ""}`
          : "ללא שעה";
        const typeIco = it.type === "task" ? "📝" : "📅";
        return `
          <div class="rollover-item-row" data-idx="${idx}">
            <label class="rollover-item-label">
              <input type="checkbox" class="rollover-item-chk" data-idx="${idx}" checked />
              <div class="rollover-item-info">
                <div class="rollover-item-title">${typeIco} ${it.title || "(ללא כותרת)"}</div>
                <div class="rollover-item-meta">📅 ${formatShortDateHe(it.dateKey)} • ${timeStr} • ${ownerBadgeText(it.owner)}</div>
              </div>
            </label>
            <button type="button" class="ghost-pill small rollover-single-btn" data-single-idx="${idx}">
              ⏭️ העבר
            </button>
          </div>
        `;
      })
      .join("");

    const syncSelectedCount = () => {
      const checkedBoxes = qsa(".rollover-item-chk:checked", listEl);
      const count = checkedBoxes.length;
      if (btnMoveSelected) {
        btnMoveSelected.disabled = count === 0;
        btnMoveSelected.textContent = `☑️ העבר נבחרות ${targetLabel} (${count})`;
      }
      if (selectAllChk) {
        selectAllChk.checked = count === currentItems.length && currentItems.length > 0;
      }
    };

    qsa(".rollover-item-chk", listEl).forEach((chk) => {
      chk.onchange = syncSelectedCount;
    });

    qsa(".rollover-single-btn", listEl).forEach((btn) => {
      btn.onclick = async () => {
        const idx = Number(btn.dataset.singleIdx);
        const item = currentItems[idx];
        if (!item) return;
        await moveItemsToDate([item], targetDateKey);
        currentItems.splice(idx, 1);
        showToast(`⏭️ "${item.title || "משימה"}" הועברה ${targetLabel}`);
        renderList();
      };
    });

    if (selectAllChk) {
      selectAllChk.checked = true;
      selectAllChk.onchange = () => {
        const val = selectAllChk.checked;
        qsa(".rollover-item-chk", listEl).forEach((chk) => {
          chk.checked = val;
        });
        syncSelectedCount();
      };
    }

    syncSelectedCount();
  };

  if (btnMoveSelected) {
    btnMoveSelected.onclick = async () => {
      const selectedIndices = qsa(".rollover-item-chk:checked", listEl).map((c) => Number(c.dataset.idx));
      const toMove = selectedIndices.map((i) => currentItems[i]).filter(Boolean);
      if (!toMove.length) {
        showToast("בחר לפחות משימה אחת להעברה");
        return;
      }
      const n = await moveItemsToDate(toMove, targetDateKey);
      close();
      showToast(`⏭️ הועברו ${n} פריטים ${targetLabel}!`);
    };
  }

  if (btnMoveAll) {
    btnMoveAll.onclick = async () => {
      if (!currentItems.length) return;
      const n = await moveItemsToDate(currentItems, targetDateKey);
      close();
      showToast(`⏭️ הועברו כל ${n} הפריטים ${targetLabel}!`);
    };
  }

  renderList();
  modal.classList.remove("hidden");
}

async function rolloverPastUncompletedToToday(typeFilter = "all") {
  const items = getPastUncompletedItemsForUser(typeFilter);
  if (!items.length) {
    showToast("אין פריטים שחלפו להעברה להיום");
    return;
  }
  openRolloverSelectModal({
    items,
    targetDateKey: dateKeyFromDate(new Date()),
    targetLabel: "להיום",
    titleText: "⏭️ בחירת משימות שחלפו להעברה להיום"
  });
}

// =========================
// Tasks
// =========================
function formatRecurrenceLabelHe(ev) {
  if (!ev) return "חוזר";
  const r = ev.recurring || "none";
  if (r === "daily") return "🔄 כל יום";
  if (r === "weekly") return "🔄 כל שבוע";
  if (r === "monthly_greg") return "🔄 כל חודש";
  if (r === "yearly_greg") return "🔄 כל שנה";
  if (r === "custom") {
    const rule = parseCustomRecurrenceRule({
      weekdays: ev.recurringWeekdays || [],
      monthDaysStr: Array.isArray(ev.recurringMonthDays) ? ev.recurringMonthDays.join(",") : (ev.recurringMonthDays || ""),
      freeText: ev.recurringCustomText || ""
    });
    return describeCustomRecurrenceRule(rule) || "🔄 מותאם אישית";
  }
  return "🔄 סדרה חוזרת";
}

function renderRoutineScheduleList(list) {
  const ownerFilter = state.ui.tasksOwnerFilter || "all";
  const groups = [
    {
      title: "📅 ימים ב׳, ה׳ (שני וחמישי)",
      owner: "shared",
      ownerBadge: "משותף 👥",
      items: getDailyRoutineSpecsForDay(1),
      freeNote: "18:30 – 00:00 • 🟢 זמן פנוי (5.5 ש׳)"
    },
    {
      title: "📅 ימים א׳, ד׳ (ראשון ורביעי)",
      owner: "shared",
      ownerBadge: "משותף 👥",
      items: getDailyRoutineSpecsForDay(0),
      freeNote: "18:30 – 00:00 • 🟢 זמן פנוי (5.5 ש׳)"
    },
    {
      title: "📅 יום ג׳ (שלישי) – בנימין בלבד",
      owner: "binyamin",
      ownerBadge: "בנימין 💙 (לננה חופש)",
      items: getDailyRoutineSpecsForDay(2),
      freeNote: "18:30 – 00:00 • 🟢 זמן פנוי (5.5 ש׳)"
    },
    {
      title: "📅 שישי ושבת",
      owner: "shared",
      ownerBadge: "משותף 👥",
      items: getDailyRoutineSpecsForDay(5),
      freeNote: "07:00 – 00:00 • 🟢 זמן פנוי"
    }
  ];

  const intro = document.createElement("div");
  intro.className = "task-item routine-intro-card";
  intro.innerHTML = `
    <div class="task-item-header">
      <div class="task-title">🗓️ סדר יום קבוע (מבוצע אוטומטית)</div>
      <span class="badge badge-auto-done">✔ אוטומטי בסטטיסטיקות</span>
    </div>
    <div class="task-meta">
      אירועי סדר היום הקבועים אינם דורשים סימון "בוצע" — הם מתעדכנים אוטומטית ונכנסים ישירות לחישוב 24 השעות בדף הסטטיסטיקות (כולל שינה, התארגנות, נסיעות, עבודה ואוכל ומקלחות).
    </div>
  `;
  list.appendChild(intro);

  groups.forEach((grp) => {
    if (ownerFilter === "mine" && grp.owner === "binyamin" && state.currentUser === "nana") return;
    if (ownerFilter === "shared" && grp.owner !== "shared") return;

    const card = document.createElement("div");
    card.className = "task-item routine-group-card";

    const header = document.createElement("div");
    header.className = "task-item-header";
    header.innerHTML = `
      <div class="task-title">${grp.title}</div>
      <span class="badge badge-owner-${grp.owner}">${grp.ownerBadge}</span>
    `;
    card.appendChild(header);

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "routine-rows-wrap";

    grp.items.forEach((spec) => {
      const sMin = parseMinutes(spec.startTime) || 0;
      const eMin = parseMinutes(spec.endTime) || 0;
      const durMins = Math.max(0, eMin - sMin);
      const durTxt = formatMinutesReadable(durMins);
      const catColor = GOAL_COLORS[spec.statCategory] || "#60a5fa";

      const row = document.createElement("div");
      row.className = "routine-row-item";
      row.innerHTML = `
        <div class="routine-row-main">
          <span class="routine-dot" style="background:${catColor}"></span>
          <strong class="routine-row-title">${spec.title}</strong>
          <span class="routine-row-cat">(${spec.statCategory})</span>
        </div>
        <div class="routine-row-time">
          <span>🕒 ${spec.startTime} – ${spec.endTime}</span>
          <span class="routine-row-dur">${durTxt}</span>
          <span class="routine-auto-tag">✔ אוטומטי</span>
        </div>
      `;
      rowsWrap.appendChild(row);
    });

    const freeRow = document.createElement("div");
    freeRow.className = "routine-row-item routine-row-free";
    freeRow.innerHTML = `
      <div class="routine-row-main">
        <span class="routine-dot" style="background:${GOAL_COLORS["זמן פנוי"]}"></span>
        <strong class="routine-row-title">${grp.freeNote}</strong>
      </div>
      <div class="routine-row-time">
        <span class="routine-auto-tag">מתקזז עם משימות שבוצעו</span>
      </div>
    `;
    rowsWrap.appendChild(freeRow);

    card.appendChild(rowsWrap);
    list.appendChild(card);
  });
}

function renderTasks(filter = "undated") {
  updateRolloverMissedButton();
  const list = el("tasksList");
  if (!list) return;
  list.innerHTML = "";

  if (filter === "routine") {
    renderRoutineScheduleList(list);
    return;
  }

  const allTasks = [];
  const recurringSeriesMap = new Map(); // מפתח ייחודי לכל סדרה חוזרת -> רק אב אחד בדיוק לכל סדרה!
  const todayKey = dateKeyFromDate(new Date());

  Object.entries(state.cache.events).forEach(([dateKey, items]) => {
    Object.entries(items || {}).forEach(([id, ev]) => {
      if (!ev || isDefaultEvent(ev)) return;

      // סינון מהיר לפי משתמש (הכל / רק שלי / משותף)
      if (!matchesQuickOwnerFilter(ev, state.ui.tasksOwnerFilter || "all", dateKey)) return;

      // פריט נחשב חוזר אך ורק אם הוגדר כחוזר (recurring !== "none" או סומן כחלק מסדרה חוזרת)
      const hasRecurringRule = Boolean(ev.recurring && ev.recurring !== "none");
      const isRecurringItem = Boolean(
        hasRecurringRule ||
        ev.isRecurringParent === true ||
        ev.isRecurringInstance === true ||
        ev.parentId
      );

      if (isRecurringItem) {
        const normTitle = (ev.title || "").trim();
        const itemType = ev.type || "event";
        const baseParentId = ev.parentId || (ev.isRecurringParent ? (ev._id || id) : String(ev._id || id).replace(/_\d{4}-\d{2}-\d{2}$/, ""));
        // קיבוץ לפי כותרת+סוג (או מזהה אב אם אין כותרת) כדי שלעולם לא יופיעו כפילויות של אותה משימה/אירוע חוזר!
        const seriesKey = normTitle ? `${itemType}|title:${normTitle}` : `${itemType}|id:${baseParentId}`;

        const candidate = {
          id,
          dateKey,
          ...ev,
          isRecurringParent: true,
          isRecurringInstance: false,
          __recurringEvent: itemType === "event",
          __seriesParentId: baseParentId
        };

        const existing = recurringSeriesMap.get(seriesKey);
        if (!existing) {
          recurringSeriesMap.set(seriesKey, candidate);
        } else {
          // נעדיף תמיד את רשומת האב המקורית (isRecurringParent === true && !isRecurringInstance)
          const candIsTrueParent = ev.isRecurringParent === true && !ev.isRecurringInstance;
          const existIsTrueParent = existing._rawIsTrueParent === true;
          if (candIsTrueParent && !existIsTrueParent) {
            candidate._rawIsTrueParent = true;
            recurringSeriesMap.set(seriesKey, candidate);
          } else if (!existIsTrueParent && !candIsTrueParent) {
            // אם שניהם מופעים (כי האב המקורי נמחק בעבר) – נשמור רק אחד (הקרוב ביותר מהיום והלאה)
            const candFuture = !ev.completed && dateKey >= todayKey;
            const existFuture = !existing.completed && existing.dateKey >= todayKey;
            if (candFuture && (!existFuture || dateKey < existing.dateKey)) {
              recurringSeriesMap.set(seriesKey, candidate);
            }
          }
        }
        if (ev.isRecurringParent === true && !ev.isRecurringInstance) {
          recurringSeriesMap.get(seriesKey)._rawIsTrueParent = true;
        }
        return;
      }

      // ⛔ למשימות/אירועים רגילים (שאינם חוזרים): לא מציגים פריטים שכבר בוצעו
      if (ev.completed === true) return;

      if (ev.type === "task") {
        allTasks.push({ id, dateKey, ...ev, isRecurringParent: false });
        return;
      }

      if (ev.type === "event") {
        allTasks.push({ id, dateKey, ...ev, isRecurringParent: false });
      }
    });
  });

  // הוספת האב היחיד של כל סדרה חוזרת לרשימה
  recurringSeriesMap.forEach((parentItem) => {
    delete parentItem._rawIsTrueParent;
    allTasks.push(parentItem);
  });

  const urgencyRank = {
    today: 0,
    week: 1,
    month: 2,
    none: 3
  };

  allTasks.sort((a, b) => {
    const aHasDate = a.dateKey && a.dateKey !== "undated";
    const bHasDate = b.dateKey && b.dateKey !== "undated";

    if (aHasDate && bHasDate) {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return compareEventsByTimeAndContainment(a, b);
    }

    if (aHasDate && !bHasDate) return -1;
    if (!aHasDate && bHasDate) return 1;

    const ua = urgencyRank[a.urgency || "none"];
    const ub = urgencyRank[b.urgency || "none"];
    return ua - ub;
  });

  const filtered = allTasks.filter((task) => {
    const hasDate = task.dateKey && task.dateKey !== "undated";
    const isRecurringParent = task.isRecurringParent === true;

    switch (filter) {
      case "undated":
        return task.type === "task" && !hasDate && !isRecurringParent;

      case "dated":
        return task.type === "task" && hasDate && !isRecurringParent;

      case "recurring":
        return task.type === "task" && isRecurringParent;

      case "dated-events":
        return (
          task.type === "event" &&
          hasDate &&
          !isRecurringParent &&
          !isDefaultEvent(task)
        );

      case "recurring-events":
        return task.type === "event" && isRecurringParent;

      default:
        return false;
    }
  });

  if (!filtered.length) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "task-meta";
    emptyEl.style.textAlign = "center";
    emptyEl.style.padding = "18px 10px";
    emptyEl.textContent = "אין פריטים בקטגוריה זו כרגע ✨";
    list.appendChild(emptyEl);
    return;
  }

  filtered.forEach((task) => {
    const item = document.createElement("div");
    item.className = "task-item";

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    const smartIcon = !isDefaultEvent(task) ? getSmartFunnyEventIcon(task) : "";
    const rawTitle = task.title || "(ללא כותרת)";
    title.textContent = smartIcon && !rawTitle.startsWith(smartIcon) ? `${smartIcon} ${rawTitle}` : rawTitle;
    if (task.__recurringEvent) {
      title.textContent += " (אירוע חוזר)";
    } else if (task.isRecurringParent && task.type === "task") {
      title.textContent += " (משימה חוזרת)";
    }

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.textContent = task.owner === "shared" ? "משותף" : task.owner === "binyamin" ? "בנימין" : "ננה";
    ownerBadge.classList.add(`badge-owner-${task.owner || "shared"}`);

    header.appendChild(title);
    header.appendChild(ownerBadge);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const parts = [];
    if (task.dateKey && task.dateKey !== "undated") {
      const d = parseDateKey(task.dateKey);
      parts.push(d.toLocaleDateString("he-IL", { weekday: "short", day: "2-digit", month: "2-digit" }));
    } else {
      parts.push("ללא תאריך");
    }
    if (task.startTime) {
      parts.push(`🕒 ${task.startTime}${task.endTime ? "–" + task.endTime : ""}`);
    }
    if (task.isRecurringParent) {
      parts.push(formatRecurrenceLabelHe(task));
      if (task.__instancesCount && task.__instancesCount > 1) {
        parts.push(`${task.__instancesCount} מופעים בלוח`);
      }
    }
    if (task.duration) parts.push(`${task.duration} דק'`);
    if (task.urgency && task.urgency !== "none") {
      const map = { today: "היום", week: "השבוע", month: "החודש", none: "לא דחוף" };
      parts.push(`דחיפות: ${map[task.urgency] || task.urgency}`);
    }
    const remLabel = formatReminderLabel(task);
    if (remLabel) parts.push(remLabel);
    meta.textContent = parts.join(" • ");

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const isRecTab = filter === "recurring" || filter === "recurring-events";
    const delBtn = document.createElement("button");
    delBtn.className = "ghost-pill small";
    delBtn.textContent = isRecTab ? "🗑 מחק הכל" : "🗑 מחיקה";
    delBtn.onclick = () => deleteTaskSmart(task);
    actions.appendChild(delBtn);

    const doneBtn = document.createElement("button");
    doneBtn.className = "ghost-pill small";
    doneBtn.textContent = task.completed ? "↩ בטל בוצע" : "✔ בוצע";
    doneBtn.onclick = () => toggleTaskDone(task);

    const remBtn = document.createElement("button");
    remBtn.className = "ghost-pill small" + (remLabel ? " reminder-set" : "");
    remBtn.textContent = remLabel ? "🔔 ערוך תזכורת" : "🔔 תזכורת";
    remBtn.onclick = () => openQuickReminderModal(task);

    const editBtn = document.createElement("button");
    editBtn.className = "ghost-pill small";
    editBtn.textContent = "עריכה";
    editBtn.onclick = () => openEditModal({ dateKey: task.dateKey, id: task._id || task.id });

    const postponeBtn = document.createElement("button");
    postponeBtn.className = "ghost-pill small";
    postponeBtn.textContent = "דחיה";
    postponeBtn.onclick = () => openPostponeModal(task);

    actions.appendChild(doneBtn);
    actions.appendChild(remBtn);
    actions.appendChild(editBtn);
    actions.appendChild(postponeBtn);

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(actions);

    list.appendChild(item);
  });
}

function toggleTaskDone(task) {
  const id = task._id || task.id;
  if (!id || !task.dateKey) return;

  const isDone = !!(task.completed || task.completedAt);
  const nextDone = !isDone;
  const nextCompletedAt = nextDone ? Date.now() : null;

  if (state.cache.events?.[task.dateKey]?.[id]) {
    state.cache.events[task.dateKey][id].completed = nextDone;
    state.cache.events[task.dateKey][id].completedAt = nextCompletedAt;
  }

  update(ref(db, `events/${task.dateKey}/${id}`), {
    completed: nextDone,
    completedAt: nextCompletedAt
  });

  renderCalendar();
  renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden")) {
    renderDayEvents(task.dateKey);
    updateDayRolloverButton(task.dateKey);
  }
  try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
  if (!el("dailySummaryModal")?.classList.contains("hidden")) {
    try { renderDailySummaryModal(state.ui.summaryDayKey); } catch {}
  }
  if (!el("goalsModal")?.classList.contains("hidden")) {
    try { renderGoalsProgress(); } catch {}
  }

  showToast(isDone ? "בוטל סימון בוצע" : "סומן כבוצע ✔");
}
// =========================
// Day modal
// =========================
function hasEventsOnDate(dateKey) {
  const events = state.cache.events[dateKey] || {};
  return Object.values(events).some(ev => !isDefaultEvent(ev));
}

function openDayModal(date) {
  const modal = el("dayModal");
  if (!modal) return;
  modal.classList.remove("hidden");

 // יום בשבוע + תאריך לועזי מלא
el("dayModalGreg").textContent =
  date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

// תאריך עברי מלא (יום + חודש + שנה)
try {
  if (hasHebcal()) {
    const hd = new window.Hebcal.HDate(date);
    el("dayModalHeb").textContent = hd.renderGematriya();
  } else {
    el("dayModalHeb").textContent =
      new Intl.DateTimeFormat("he-u-ca-hebrew", {
        day: "numeric",
        month: "long",
        year: "numeric"
      }).format(date);
  }
} catch {
  el("dayModalHeb").textContent = "";
}

  const dateKey = dateKeyFromDate(date);
  state.ui.openDayKey = dateKey;
  ensureDefaultDayEvents(date).then(() => {
    renderDayEvents(dateKey);
    updateDayRolloverButton(dateKey);
  });
  updateDayRolloverButton(dateKey);


  const weatherCard = el("dayWeatherContainer");
  if (weatherCard) {
    if (!hasEventsOnDate(dateKey)) fetchWeatherForDate(date, true);
    else weatherCard.classList.add("hidden");
  }

  el("btnAddFromDay").onclick = () => openEditModal({ dateKey });
  el("btnToggleDayWeather").onclick = () => fetchWeatherForDate(date, false);

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
  const bd = qs(".modal-backdrop", modal);
  if (bd) bd.onclick = () => modal.classList.add("hidden");
}

function renderDayEvents(dateKey) {
  const container = el("dayEventsContainer");
  if (!container) return;
  container.innerHTML = "";

  const events = state.cache.events[dateKey] || {};

  const allFiltered = Object.entries(events)
    .filter(
      ([id, ev]) =>
        ev &&
        !shouldHideRecurringParentOnDate(ev, id, dateKey, events) &&
        matchesQuickOwnerFilter(ev, state.ui.calendarOwnerFilter || "all", dateKey)
    )
    .map(([id, ev]) => ({ id, ...ev }));

  const customList = allFiltered.filter((ev) => !isDefaultEvent(ev)).sort(compareEventsByTimeAndContainment);
  const routineList = allFiltered.filter((ev) => isDefaultEvent(ev)).sort(compareEventsByTimeAndContainment);
  const list = [...customList, ...routineList];

  let routineHeaderAdded = false;
  list.forEach((ev) => {
    const isRoutineDef = isDefaultEvent(ev);
    if (isRoutineDef && !routineHeaderAdded) {
      routineHeaderAdded = true;
      const divider = document.createElement("div");
      divider.className = "day-routine-divider";
      divider.innerHTML = `<span>🗓️ סדר יום קבוע</span><span class="routine-auto-tag">✔ מבוצע אוטומטית ונכנס לסטטיסטיקות</span>`;
      container.appendChild(divider);
    }

    const card = document.createElement("div");
    card.className = "card" + (isRoutineDef ? " routine-day-card" : "");
    if (ev.owner) card.classList.add(`owner-${ev.owner}`);

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    const rawTitle = ev.title || "(ללא כותרת)";
    const smartIcon = !isRoutineDef ? getSmartFunnyEventIcon(ev) : "";
    title.textContent = smartIcon && !rawTitle.startsWith(smartIcon) ? `${smartIcon} ${rawTitle}` : rawTitle;

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.classList.add(`badge-owner-${ev.owner || "shared"}`);
    ownerBadge.textContent = ev.owner === "shared" ? "משותף" : ev.owner === "binyamin" ? "בנימין" : "ננה";

    header.appendChild(title);
    header.appendChild(ownerBadge);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const parts = [];
    if (ev.startTime) {
      let timeText = ev.startTime;
      if (ev.endTime) timeText += ` - ${ev.endTime}`;
      parts.push(timeText);
    }
    if (ev.duration) parts.push(`${ev.duration} דק'`);
    if (isRoutineDef) {
      parts.push(`קטגוריה: ${normalizeStatCategoryTitle(ev.title)}`);
      parts.push("✔ מבוצע אוטומטית");
    } else {
      parts.push(ev.type === "task" ? "משימה" : "אירוע");
    }
    const remLabel = formatReminderLabel(ev);
    if (remLabel) parts.push(remLabel);
    meta.textContent = parts.join(" • ");

    const desc = document.createElement("div");
    desc.className = "task-meta";
    desc.textContent = ev.description || "";

    card.appendChild(header);
    card.appendChild(meta);
    if (ev.description) card.appendChild(desc);

    if (!isRoutineDef) {
      const actions = document.createElement("div");
      actions.className = "task-actions";

      const doneBtn = document.createElement("button");
      doneBtn.className = "ghost-pill small";
      doneBtn.textContent = (ev.completed || ev.completedAt) ? "↩ בטל בוצע" : "✔ בוצע";

      doneBtn.onclick = () => {
        toggleTaskDone({
          ...ev,
          dateKey,
          id: ev._id || ev.id
        });
      };

      actions.appendChild(doneBtn);

      const remBtn = document.createElement("button");
      remBtn.className = "ghost-pill small" + (remLabel ? " reminder-set" : "");
      remBtn.textContent = remLabel ? "🔔 ערוך תזכורת" : "🔔 תזכורת";
      remBtn.onclick = () => openQuickReminderModal({ ...ev, dateKey, id: ev._id || ev.id });
      actions.appendChild(remBtn);

      const editBtn = document.createElement("button");
      editBtn.className = "ghost-pill small";
      editBtn.textContent = "עריכה";
      editBtn.onclick = () => {
        if (ev.isAuto) {
          openEditModal({
            type: "task",
            title: ev.title,
            startTime: ev.startTime,
            endTime: ev.endTime,
            dateKey
          });
        } else {
          openEditModal({ dateKey, id: ev._id || ev.id });
        }
      };

      const delBtn = document.createElement("button");
      delBtn.className = "ghost-pill small";
      delBtn.textContent = "מחיקה";
      delBtn.onclick = () => deleteTaskSmart({ ...ev, dateKey });

      const wazeBtn = document.createElement("button");
      wazeBtn.className = "ghost-pill small";
      wazeBtn.textContent = "Waze";
      if (ev.address) wazeBtn.onclick = () => window.open(`https://waze.com/ul?q=${encodeURIComponent(ev.address)}`, "_blank");
      else wazeBtn.disabled = true;

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      actions.appendChild(wazeBtn);
      card.appendChild(actions);
    }

    container.appendChild(card);
  });
}


// =========================
// Custom Recurrence Parser (ימים בשבוע / תאריכים בחודש / מלל חופשי)
// =========================
const HEB_WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function parseCustomRecurrenceRule({ weekdays = [], monthDaysStr = "", freeText = "" } = {}) {
  const wdSet = new Set((weekdays || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
  const mdSet = new Set();
  let weekInterval = 1;
  let dayInterval = 1;

  // 1) פירוק ימים בחודש מהשדה הייעודי (למשל "1, 15")
  String(monthDaysStr || "")
    .split(/[^0-9]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
    .forEach((n) => mdSet.add(n));

  // 2) פירוק מלל חופשי בעברית (כל קומבינציה אפשרית!)
  const txt = String(freeText || "").trim();
  if (txt) {
    if (/אמצע\s*שבוע|ראשון\s*עד\s*חמישי|א['׳]?\s*-\s*ה['׳]?/.test(txt)) {
      [0, 1, 2, 3, 4].forEach((d) => wdSet.add(d));
    }
    if (/ראשון|יום\s*א(?![א-ת])|ימי\s*א(?![א-ת])/.test(txt)) wdSet.add(0);
    if (/שני|יום\s*ב(?![א-ת])|ימי\s*ב(?![א-ת])/.test(txt)) wdSet.add(1);
    if (/שלישי|יום\s*ג(?![א-ת])|ימי\s*ג(?![א-ת])/.test(txt)) wdSet.add(2);
    if (/רביעי|יום\s*ד(?![א-ת])|ימי\s*ד(?![א-ת])/.test(txt)) wdSet.add(3);
    if (/חמישי|יום\s*ה(?![א-ת])|ימי\s*ה(?![א-ת])/.test(txt)) wdSet.add(4);
    if (/שישי|יום\s*ו(?![א-ת])|ימי\s*ו(?![א-ת])/.test(txt)) wdSet.add(5);
    if (/שבת|יום\s*ש(?![א-ת])/.test(txt)) wdSet.add(6);

    if (/שבועיים|פעמיים\s*בחודש/.test(txt)) weekInterval = 2;
    const weekIntMatch = txt.match(/כל\s*(\d+)\s*שבועות/);
    if (weekIntMatch) weekInterval = Math.max(1, Number(weekIntMatch[1]));

    if (/כל\s*יומיים/.test(txt)) dayInterval = 2;
    const dayIntMatch = txt.match(/כל\s*(\d+)\s*ימים/);
    if (dayIntMatch) dayInterval = Math.max(1, Number(dayIntMatch[1]));

    // זיהוי מספרי ימים בחודש מתוך המלל החופשי (למשל: "כל 1 לחודש", "1 ו-15 לחודש", "ב-10 בחודש")
    if (/חודש/.test(txt)) {
      const nums = txt.match(/\b([1-9]|[12][0-9]|3[01])\b/g) || [];
      nums.forEach((nStr) => {
        const n = Number(nStr);
        if (n >= 1 && n <= 31) mdSet.add(n);
      });
    } else {
      const explicitMonthMatches = txt.matchAll(/(?:כל|ב-?)\s*([1-9]|[12][0-9]|3[01])\s*(?:ל|ב)?חודש/g);
      for (const m of explicitMonthMatches) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 31) mdSet.add(n);
      }
    }
  }

  return {
    weekdays: Array.from(wdSet).sort((a, b) => a - b),
    monthDays: Array.from(mdSet).sort((a, b) => a - b),
    weekInterval,
    dayInterval
  };
}

function describeCustomRecurrenceRule(rule) {
  if (!rule) return "";
  const parts = [];
  if (rule.weekdays && rule.weekdays.length) {
    const names = rule.weekdays.map((d) => `יום ${HEB_WEEKDAY_NAMES[d]}`).join(", ");
    parts.push(rule.weekInterval > 1 ? `כל ${rule.weekInterval} שבועות ב-${names}` : `בכל ${names}`);
  }
  if (rule.monthDays && rule.monthDays.length) {
    parts.push(`בכל ${rule.monthDays.join(", ")} לחודש`);
  }
  if (!parts.length && rule.dayInterval > 1) {
    parts.push(`כל ${rule.dayInterval} ימים`);
  }
  return parts.length ? `🔄 יחזור: ${parts.join(" • וגם ")}` : "💡 בחר ימים בשבוע, תאריך בחודש, או הקלד במלל חופשי";
}

function doesDateMatchCustomRecurrence(d, start, rule) {
  if (!rule) return false;
  const hasWd = rule.weekdays && rule.weekdays.length > 0;
  const hasMd = rule.monthDays && rule.monthDays.length > 0;

  let matched = false;
  if (hasWd && rule.weekdays.includes(d.getDay())) {
    if (rule.weekInterval > 1) {
      const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks % rule.weekInterval === 0) matched = true;
    } else {
      matched = true;
    }
  }
  if (hasMd && rule.monthDays.includes(d.getDate())) {
    matched = true;
  }
  if (!hasWd && !hasMd && rule.dayInterval > 1) {
    const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
    if (diffDays >= 0 && diffDays % rule.dayInterval === 0) matched = true;
  }
  return matched;
}

// =========================
// Edit modal + CRUD
// =========================
function openEditModal({ dateKey, id, title, startTime, endTime, type, owner, goalTitle } = {}) {
  const modal = el("editModal");
  const form = el("editForm");
  if (!modal || !form) return;

  modal.classList.remove("hidden");
  form.reset();

  let dk = dateKey || dateKeyFromDate(state.currentDate);
  if (id && (!state.cache.events?.[dk] || !state.cache.events[dk][id])) {
    const foundBucket = Object.keys(state.cache.events || {}).find((k) => state.cache.events[k]?.[id]);
    if (foundBucket) dk = foundBucket;
  }

  form.elements["date"].value = dk;
  form.elements["owner"].value = owner || (state.currentUser === "shared" ? "shared" : state.currentUser);

  form.dataset.editDateKey = dk || "";
  form.dataset.editId = id || "";

  // מילוי רשימת המטרות של המשתמש לשיוך ישיר לסטטיסטיקה השבועית
  const goalSelect = el("editGoalSelect");
  const populateGoalSelect = (forOwner, selectedGoal = "") => {
    if (!goalSelect) return;
    const effOwner = forOwner === "shared" ? state.currentUser : (forOwner || state.currentUser);
    const userGoals = Object.values(state.goals?.[effOwner] || {});
    goalSelect.innerHTML = `<option value="">ללא מטרה</option>` +
      userGoals
        .filter((g) => g && g.title)
        .map((g) => `<option value="${g.title.replace(/"/g, "&quot;")}">🎯 ${g.title} (${g.weeklyHours} ש׳/שבוע)</option>`)
        .join("");
    if (selectedGoal) {
      goalSelect.value = selectedGoal;
    }
  };
  populateGoalSelect(form.elements["owner"].value, goalTitle || title || "");
  form.elements["owner"].onchange = () => populateGoalSelect(form.elements["owner"].value, goalSelect?.value || "");

  // מילוי מוקדם (למשל משיבוץ מטרה)
  if (!id) {
    if (title) form.elements["title"].value = title;
    if (startTime) form.elements["startTime"].value = startTime;
    if (endTime) form.elements["endTime"].value = endTime;
    if (type) form.elements["type"].value = type;
    if (owner) form.elements["owner"].value = owner;
  }

  // איפוס בורר חזרה מותאמת אישית
  const recSelect = el("editRecurringSelect");
  const customRecBox = el("customRecurringBox");
  const wdBtns = qsa("#customRecWeekdays .weekday-pill");
  const mdayInput = el("customRecMonthDays");
  const freeTxtInput = el("customRecFreeText");
  const previewEl = el("customRecurringPreview");

  wdBtns.forEach((b) => b.classList.remove("active"));
  if (mdayInput) mdayInput.value = "";
  if (freeTxtInput) freeTxtInput.value = "";

  // אם עריכה - למלא
  if (id && dk && state.cache.events[dk] && state.cache.events[dk][id]) {
    const ev = state.cache.events[dk][id];
    form.elements["type"].value = ev.type || "event";
    form.elements["owner"].value = ev.owner || state.currentUser;
    populateGoalSelect(ev.owner || state.currentUser, ev.goalTitle || "");
    form.elements["title"].value = ev.title || "";
    form.elements["description"].value = ev.description || "";
    form.elements["date"].value = ev.dateKey || dk;
    form.elements["startTime"].value = ev.startTime || "";
    form.elements["endTime"].value = ev.endTime || "";
    form.elements["duration"].value = ev.duration != null ? String(ev.duration) : "";
    form.elements["address"].value = ev.address || "";
    form.elements["reminderMinutes"].value = ev.reminderMinutes != null ? String(ev.reminderMinutes) : "";
    if (form.elements["reminderDate"]) form.elements["reminderDate"].value = ev.reminderDate || "";
    if (form.elements["reminderTime"]) form.elements["reminderTime"].value = ev.reminderTime || "";
    form.elements["recurring"].value = ev.recurring || "none";
    form.elements["urgency"].value = ev.urgency || "none";

    if (Array.isArray(ev.recurringWeekdays)) {
      wdBtns.forEach((b) => {
        if (ev.recurringWeekdays.includes(Number(b.dataset.wd))) b.classList.add("active");
      });
    }
    if (mdayInput && ev.recurringMonthDays) {
      mdayInput.value = Array.isArray(ev.recurringMonthDays) ? ev.recurringMonthDays.join(", ") : String(ev.recurringMonthDays);
    }
    if (freeTxtInput && ev.recurringCustomText) {
      freeTxtInput.value = ev.recurringCustomText;
    }
  }

  const updateCustomRecUI = () => {
    const isCustom = recSelect && recSelect.value === "custom";
    if (customRecBox) customRecBox.classList.toggle("hidden", !isCustom);
    if (isCustom && previewEl) {
      const selectedWds = wdBtns.filter((b) => b.classList.contains("active")).map((b) => Number(b.dataset.wd));
      const rule = parseCustomRecurrenceRule({
        weekdays: selectedWds,
        monthDaysStr: mdayInput?.value || "",
        freeText: freeTxtInput?.value || ""
      });
      previewEl.textContent = describeCustomRecurrenceRule(rule);
    }
  };

  if (recSelect) {
    recSelect.onchange = updateCustomRecUI;
  }
  wdBtns.forEach((btn) => {
    btn.onclick = () => {
      btn.classList.toggle("active");
      if (recSelect && recSelect.value !== "custom") recSelect.value = "custom";
      updateCustomRecUI();
    };
  });
  qsa("[data-mday-chip]").forEach((chip) => {
    chip.onclick = () => {
      const num = chip.dataset.mdayChip;
      if (!mdayInput) return;
      const cur = mdayInput.value
        .split(/[^0-9]+/)
        .filter(Boolean);
      if (cur.includes(num)) {
        mdayInput.value = cur.filter((x) => x !== num).join(", ");
      } else {
        cur.push(num);
        mdayInput.value = cur.join(", ");
      }
      if (recSelect && recSelect.value !== "custom") recSelect.value = "custom";
      updateCustomRecUI();
    };
  });
  if (mdayInput) mdayInput.oninput = updateCustomRecUI;
  if (freeTxtInput) freeTxtInput.oninput = updateCustomRecUI;
  updateCustomRecUI();

  // כפתורי בחירה מהירה של תזכורת בטופס עריכה
  form.dataset.remInMinutes = "";
  const presetBtns = qsa("#editReminderPresets button");
  const remMinInput = form.elements["reminderMinutes"];
  const remDateInput = form.elements["reminderDate"];
  const remTimeInput = form.elements["reminderTime"];
  const syncPresetHighlight = () => {
    const val = remMinInput ? remMinInput.value : "";
    presetBtns.forEach((b) => {
      if (b.dataset.remMin !== undefined) {
        b.classList.toggle("active", b.dataset.remMin === val && val !== "");
      }
    });
  };
  syncPresetHighlight();
  presetBtns.forEach((b) => {
    b.onclick = () => {
      if (b.dataset.remIn) {
        const minsFromNow = Number(b.dataset.remIn);
        form.dataset.remInMinutes = String(minsFromNow);
        const dt = new Date(Date.now() + minsFromNow * 60000);
        if (remDateInput) remDateInput.value = dateKeyFromDate(dt);
        if (remTimeInput) remTimeInput.value = formatTimeHM(dt);
        if (remMinInput) remMinInput.value = "";
        presetBtns.forEach((btn) => btn.classList.remove("active"));
        b.classList.add("active");
      } else {
        form.dataset.remInMinutes = "";
        if (remMinInput) remMinInput.value = b.dataset.remMin;
        if (remDateInput) remDateInput.value = "";
        if (remTimeInput) remTimeInput.value = "";
        syncPresetHighlight();
      }
    };
  });
  if (remMinInput) {
    remMinInput.oninput = () => {
      form.dataset.remInMinutes = "";
      syncPresetHighlight();
    };
  }
  if (remTimeInput) {
    remTimeInput.oninput = () => {
      form.dataset.remInMinutes = "";
    };
  }

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
  const bd = qs(".modal-backdrop", modal);
  if (bd) bd.onclick = () => modal.classList.add("hidden");

  // =========================
  // גלגלת שעות מהירה + חישוב אוטומטי של שעת סיום ומשך
  // =========================
  const startInput = form.elements["startTime"];
  const endInput = form.elements["endTime"];
  const durInput = form.elements["duration"];

  const getActiveQuickDur = () => {
    const activeBtn = qs("#editQuickDurations button.active");
    return activeBtn ? Number(activeBtn.dataset.quickDur || 60) : 60;
  };

  // סימון כפתור המשך לפי האירוע הקיים (או שעה כברירת מחדל)
  {
    let curDur = 60;
    if (startInput.value && endInput.value && !isEndBeforeStart(startInput.value, endInput.value)) {
      curDur = timeToMinutes(endInput.value) - timeToMinutes(startInput.value);
    }
    const durBtns = qsa("#editQuickDurations button");
    const match = durBtns.find((b) => Number(b.dataset.quickDur) === curDur);
    durBtns.forEach((b) => b.classList.toggle("active", match ? b === match : Number(b.dataset.quickDur) === 60));
  }

  const applyStartAndDuration = (startStr, durMins) => {
    if (!startStr) return;
    startInput.value = startStr;
    const endStr = addMinutesToTimeStr(startStr, durMins);
    if (endStr) endInput.value = endStr;
    if (durInput) durInput.value = String(durMins);
    qsa("#editQuickStartTimes button").forEach((b) => {
      b.classList.toggle("active", b.dataset.quickStart === startStr);
    });
  };

  qsa("#editQuickStartTimes button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.quickStart === startInput.value);
    btn.onclick = () => {
      const startStr = btn.dataset.quickStart;
      applyStartAndDuration(startStr, getActiveQuickDur());
    };
  });

  qsa("#editQuickDurations button").forEach((btn) => {
    btn.onclick = () => {
      qsa("#editQuickDurations button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const durMins = Number(btn.dataset.quickDur || 60);
      if (!startInput.value) {
        const now = new Date();
        const nextHour = String(Math.min(22, now.getHours() + 1)).padStart(2, "0") + ":00";
        startInput.value = nextHour;
      }
      applyStartAndDuration(startInput.value, durMins);
    };
  });

  function validateTimesLive() {
    const start = startInput.value;
    const end = endInput.value;

    if (start && (!end || isEndBeforeStart(start, end))) {
      // בחירה אוטומטית של שעת סיום לפי המשך הפעיל (ברירת מחדל שעה קדימה)
      const autoEnd = addMinutesToTimeStr(start, getActiveQuickDur());
      if (autoEnd) endInput.value = autoEnd;
    }
  }

  startInput.onchange = validateTimesLive;
  endInput.onchange = () => {
    const start = startInput.value;
    const end = endInput.value;
    if (start && end && isEndBeforeStart(start, end)) {
      showToast("⛔ שעת סיום חייבת להיות אחרי שעת התחלה");
      endInput.value = addMinutesToTimeStr(start, 60);
    }
  };
}

async function saveEditedEventCleanly({ existingId, prevDk, dateKey, eventObj, toastMsg }) {
  let prevObj = (prevDk && state.cache.events?.[prevDk]?.[existingId]) || state.cache.events?.[dateKey]?.[existingId] || null;
  let actualOldDk = prevDk;
  if (!prevObj) {
    for (const [k, dayBucket] of Object.entries(state.cache.events || {})) {
      if (dayBucket && dayBucket[existingId]) {
        prevObj = dayBucket[existingId];
        if (!actualOldDk) actualOldDk = k;
        break;
      }
    }
  }
  prevObj = prevObj || {};

  const otherBucketsWithId = Object.keys(state.cache.events || {}).filter(
    (k) => k !== dateKey && state.cache.events[k]?.[existingId]
  );
  const dateChanged = Boolean((actualOldDk && actualOldDk !== dateKey) || otherBucketsWithId.length > 0);
  const wasRecurringInstance = Boolean(
    prevObj.isRecurringInstance ||
    prevObj.parentId ||
    /_\d{4}-\d{2}-\d{2}$/.test(String(existingId))
  );

  // אם עורכים מופע בודד של משימה/אירוע חוזר ומעבירים אותו ליום אחר (למשל מהיום למחר) –
  // מנתקים את המופע הספציפי הזה מהחזרה כדי שיעבור רק ליום החדש ולא יישאר ביום הקודם או ייצור סדרה חדשה!
  let effectiveRecurring = eventObj.recurring || "none";
  if (wasRecurringInstance && dateChanged) {
    effectiveRecurring = "none";
  }
  const isRecNow = Boolean(effectiveRecurring && effectiveRecurring !== "none");
  const baseSeriesId = prevObj.parentId || String(existingId).replace(/_\d{4}-\d{2}-\d{2}$/, "");

  const dbMulti = {};

  // מחיקה מוחלטת מכל יום קודם שבו הפריט הופיע
  const oldKeysToRemove = new Set(otherBucketsWithId);
  if (actualOldDk && actualOldDk !== dateKey) oldKeysToRemove.add(actualOldDk);
  if (prevDk && prevDk !== dateKey) oldKeysToRemove.add(prevDk);

  oldKeysToRemove.forEach((oldK) => {
    if (state.cache.events?.[oldK]?.[existingId]) {
      delete state.cache.events[oldK][existingId];
    }
    dbMulti[`${oldK}/${existingId}`] = null;
    cancelDirectReminder(`${oldK}/${existingId}`);

    // אם זה היה מופע של סדרה חוזרת – נסמן על האב שהתאריך הישן הוחרג כדי שהאב לא יצוץ ביום הישן
    if (wasRecurringInstance) {
      markRecurringParentExcludedDate(baseSeriesId, oldK, dbMulti);
    }
    // אם זה היה אב חוזר שהוזז לתאריך אחר – נמחק גם את המופע התואם של היום הישן אם קיים
    const pairedInstId = `${existingId}_${oldK}`;
    if (state.cache.events?.[oldK]?.[pairedInstId]) {
      delete state.cache.events[oldK][pairedInstId];
      dbMulti[`${oldK}/${pairedInstId}`] = null;
      cancelDirectReminder(`${oldK}/${pairedInstId}`);
    }
  });

  if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
  const updatedExisting = {
    ...eventObj,
    dateKey,
    recurring: effectiveRecurring,
    _id: existingId,
    parentId: isRecNow ? null : (dateChanged ? null : (prevObj.parentId || null)),
    isRecurringInstance: isRecNow ? null : (dateChanged ? null : (prevObj.isRecurringInstance || null)),
    isRecurringParent: isRecNow ? true : null
  };
  if (Array.isArray(prevObj.excludedDates) && isRecNow) {
    updatedExisting.excludedDates = prevObj.excludedDates;
  }

  state.cache.events[dateKey][existingId] = updatedExisting;
  dbMulti[`${dateKey}/${existingId}`] = updatedExisting;

  el("editModal")?.classList.add("hidden");
  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden")) {
    const activeDayKey = state.ui.openDayKey || dateKey;
    renderDayEvents(activeDayKey);
    updateDayRolloverButton(activeDayKey);
  }

  const rTs = getEventReminderTimestamp(updatedExisting, dateKey);
  if (rTs && rTs > Date.now()) {
    scheduleDirectReminder({ id: existingId, dateKey, ev: updatedExisting, targetTs: rTs });
    showToast(`🔔 עודכן! תזכורת ב-${formatTimeHM(new Date(rTs))}`, 3500);
  } else {
    cancelDirectReminder(`${dateKey}/${existingId}`);
    showToast(toastMsg || "עודכן", 2500);
  }

  await update(ref(db, "events"), dbMulti);
  if (isRecNow) {
    await materializeRecurringTask({ ...updatedExisting, __cleanSeriesId: baseSeriesId });
    renderCalendar();
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden")) {
      const activeDayKey = state.ui.openDayKey || dateKey;
      renderDayEvents(activeDayKey);
      updateDayRolloverButton(activeDayKey);
    }
  }
  try { updateStats(); } catch {}
}

async function handleEditFormSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;

  const data = Object.fromEntries(new FormData(form).entries());

  const remMinRaw = data.reminderMinutes !== undefined && data.reminderMinutes !== "" ? Number(data.reminderMinutes) : null;
  const remDateVal = (data.reminderDate || "").trim() || null;
  const remTimeVal = (data.reminderTime || "").trim() || null;

  let reminderCustomTs = null;
  if (form.dataset.remInMinutes) {
    reminderCustomTs = Date.now() + Number(form.dataset.remInMinutes) * 60000;
  } else if (remTimeVal) {
    const baseDk = remDateVal || (data.date && data.date !== "undated" ? data.date : dateKeyFromDate(new Date()));
    const dObj = parseDateKey(baseDk);
    const [rh, rm] = remTimeVal.split(":").map(Number);
    dObj.setHours(rh || 0, rm || 0, 0, 0);
    reminderCustomTs = dObj.getTime();
    if (reminderCustomTs < Date.now() && Date.now() - reminderCustomTs < 60000) {
      reminderCustomTs = Date.now() + 15000;
    }
  } else if (remMinRaw != null && !data.startTime) {
    // אם לא הוזנה שעת התחלה (למשל משימה) והוזנו דקות תזכורת -> תזכורת בעוד X דקות מעכשיו!
    reminderCustomTs = Date.now() + remMinRaw * 60000;
  } else if (data.startTime && data.date && data.date !== "undated") {
    const dObj = parseDateKey(data.date);
    const [sh, sm] = data.startTime.split(":").map(Number);
    dObj.setHours(sh || 0, sm || 0, 0, 0);
    const startTs = dObj.getTime();
    const minsBefore = remMinRaw != null ? remMinRaw : 0;
    const calcTs = startTs - minsBefore * 60000;
    // אם זמן ה-"לפני" כבר עבר אבל שעת האירוע עצמה עוד לפנינו -> נתזכר בשעת האירוע!
    if (calcTs < Date.now() && startTs > Date.now() - 30000) {
      reminderCustomTs = startTs;
    } else {
      reminderCustomTs = calcTs;
    }
  }

  const selectedWds = qsa("#customRecWeekdays .weekday-pill.active").map((b) => Number(b.dataset.wd));
  const customRule = parseCustomRecurrenceRule({
    weekdays: selectedWds,
    monthDaysStr: data.recurringMonthDays || "",
    freeText: data.recurringCustomText || ""
  });

  const eventObj = {
    type: data.type,
    owner: data.owner,
    title: (data.title || "").trim(),
    description: data.description || "",
    dateKey: data.date || "undated",
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    duration: data.duration ? Number(data.duration) : null,
    address: data.address || "",
    reminderMinutes: remMinRaw,
    reminderDate: remDateVal,
    reminderTime: remTimeVal,
    reminderCustomTs: reminderCustomTs,
    remindedAt: null,
    remindedAt_binyamin: null,
    remindedAt_nana: null,
    remindedAt_shared: null,
    recurring: data.recurring || "none",
    recurringWeekdays: data.recurring === "custom" ? customRule.weekdays : null,
    recurringMonthDays: data.recurring === "custom" ? customRule.monthDays : null,
    recurringCustomText: data.recurring === "custom" ? (data.recurringCustomText || "").trim() : null,
    goalTitle: (data.goalTitle || "").trim() || null,
    urgency: data.urgency || "none"
  };

  if ((remMinRaw != null || reminderCustomTs) && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

// =========================
  // Time sanity check
  // =========================
  if (eventObj.startTime && eventObj.endTime) {
    const s = timeToMinutes(eventObj.startTime);
    const e = timeToMinutes(eventObj.endTime);

    if (e <= s) {
      showToast("⛔ שעת סיום חייבת להיות אחרי שעת התחלה");
      return;
    }
  }
  
  const dateKey = eventObj.dateKey || "undated";
  const existingId = form.dataset.editId || null;

// =========================
  // Conflict check (before save)
  // =========================

  if (eventObj.startTime && eventObj.dateKey && eventObj.dateKey !== "undated") {
    const conflicts = findConflicts(
      eventObj.dateKey,
      eventObj,
      existingId
    );

    if (conflicts.length > 0) {
      openConflictModal({
        newEvent: eventObj,
        conflicts,
        form
      });
      return; // ⛔ עוצר שמירה רגילה
    }
  }
  
if (existingId) {
  const prevDk = form.dataset.editDateKey || dateKey;
  await saveEditedEventCleanly({
    existingId,
    prevDk,
    dateKey,
    eventObj
  });
} else {
  const newRef = push(ref(db, `events/${dateKey}`));
  const newId = newRef.key || String(Date.now());
  const fullObj = { ...eventObj, _id: newId };
  if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
  state.cache.events[dateKey][newId] = fullObj;
  el("editModal").classList.add("hidden");
  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden")) {
    const activeDayKey = state.ui.openDayKey || dateKey;
    renderDayEvents(activeDayKey);
    updateDayRolloverButton(activeDayKey);
  }
  const rTs = getEventReminderTimestamp(fullObj, dateKey);
  if (rTs && rTs > Date.now()) {
    scheduleDirectReminder({ id: newId, dateKey, ev: fullObj, targetTs: rTs });
    showToast(`🔔 נשמר! תזכורת ב-${formatTimeHM(new Date(rTs))}`, 3500);
  } else {
    showToast("נשמר", 2500);
  }
  await set(newRef, fullObj);

  if (eventObj.recurring && eventObj.recurring !== "none") {
    const parentTask = { ...fullObj, parentId: null, isRecurringParent: true };
    state.cache.events[dateKey][newId] = parentTask;
    await update(newRef, parentTask);
    await materializeRecurringTask(parentTask);
  }
}
}
function openWazeFromForm() {
  const form = el("editForm");
  if (!form) return;
  const address = form.elements["address"].value;
  if (!address) return;
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}`, "_blank");
}

// =========================
// Conflict resolution modal
// =========================
function openConflictModal({ newEvent, conflicts, form }) {
  const modal = el("conflictModal");
  const text = el("conflictText");

  const first = conflicts[0];

  text.innerHTML = `
    יש התנגשות עם:<br>
    <b>${first.title}</b><br>
    ${first.startTime}${first.endTime ? " - " + first.endTime : ""}
  `;

  modal.classList.remove("hidden");

  el("conflictEditExisting").onclick = () => {
    modal.classList.add("hidden");
    openEditModal({
      dateKey: first.dateKey,
      id: first._id || first.id
    });
  };

  el("conflictEditNew").onclick = () => {
    modal.classList.add("hidden");
  };

  el("conflictKeepBoth").onclick = async () => {
    modal.classList.add("hidden");

    const dateKey = newEvent.dateKey;
    const isRec = Boolean(newEvent.recurring && newEvent.recurring !== "none");
    const existingEditId = form?.dataset?.editId || null;

    if (existingEditId) {
      const prevDk = form?.dataset?.editDateKey || dateKey;
      await saveEditedEventCleanly({
        existingId: existingEditId,
        prevDk,
        dateKey,
        eventObj: newEvent,
        toastMsg: "עודכן למרות ההתנגשות"
      });
      return;
    }

    const newRef = push(ref(db, `events/${dateKey}`));
    const newId = newRef.key || String(Date.now());
    const fullObj = {
      ...newEvent,
      _id: newId,
      parentId: null,
      isRecurringParent: isRec ? true : null
    };
    if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
    state.cache.events[dateKey][newId] = fullObj;
    el("editModal").classList.add("hidden");
    const rTs = getEventReminderTimestamp(fullObj, dateKey);
    if (rTs && rTs > Date.now()) {
      scheduleDirectReminder({ id: newId, dateKey, ev: fullObj, targetTs: rTs });
      showToast(`🔔 נשמר! תזכורת ב-${formatTimeHM(new Date(rTs))}`, 3500);
    } else {
      showToast("נשמר למרות ההתנגשות", 2500);
    }
    await set(newRef, fullObj);
    if (isRec) {
      await materializeRecurringTask(fullObj);
    }
    renderCalendar();
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden")) {
      const activeDayKey = state.ui.openDayKey || dateKey;
      renderDayEvents(activeDayKey);
      updateDayRolloverButton(activeDayKey);
    }
  };

  qsa("[data-close-conflict]", modal).forEach(
    b => b.onclick = () => modal.classList.add("hidden")
  );
}
// =========================
// Weather
// =========================
async function fetchWeatherForDate(date, autoShowIfEmpty) {
  const card = el("dayWeatherContainer");
  if (!card) return;

  try {
    await ensureCityCoords();
  } catch (e) {
    console.error("City geocode failed", e);
    el("dayWeatherTemp").textContent = "שגיאה בזיהוי עיר";
    el("dayWeatherDesc").textContent = "";
    el("dayWeatherExtra").textContent = "";
    card.classList.remove("hidden");
    return;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const dayStr = `${y}-${m}-${d}`;

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${state.settings.cityLat}` +
    `&longitude=${state.settings.cityLon}` +
    `&hourly=temperature_2m,precipitation_probability,weather_code` +
    `&timezone=${encodeURIComponent(state.settings.cityTz || "auto")}` +
    `&start_date=${dayStr}&end_date=${dayStr}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.hourly || !data.hourly.temperature_2m || !data.hourly.temperature_2m.length) {
      if (autoShowIfEmpty) card.classList.add("hidden");
      return;
    }

    const idx = data.hourly.time.findIndex((t) => t.endsWith("12:00"));
    const i = idx >= 0 ? idx : 0;

    const temp = Math.round(data.hourly.temperature_2m[i]);
    const code = data.hourly.weather_code[i];
    const rain = data.hourly.precipitation_probability[i];

    const mapped = mapOpenMeteoWeather(code);

    el("dayWeatherEmoji").textContent = mapped.emoji;
    el("dayWeatherTemp").textContent = `${temp}°C`;
    el("dayWeatherDesc").textContent = `${mapped.emoji} ${mapped.label}`;
    el("dayWeatherExtra").textContent = rain != null ? `סיכוי למשקעים: ${rain}%` : "";
    card.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    if (!autoShowIfEmpty) {
      el("dayWeatherTemp").textContent = "שגיאה בטעינת מזג האוויר";
      el("dayWeatherDesc").textContent = "";
      el("dayWeatherExtra").textContent = "";
      card.classList.remove("hidden");
    }
  }
}

// =========================
// Nav + filters + shopping
// =========================
const SCREEN_TITLES = {
  calendarSection: "",
  tasksSection: "✅ משימות ואירועים",
  shoppingSection: "🛒 רשימת קניות",
  statsSection: "📊 סטטיסטיקות",
  settingsSection: "⚙️ הגדרות"
};

function setActiveScreenMeta(targetId) {
  document.body.dataset.screen = targetId;
  const t = document.getElementById("screenTitle");
  if (t) t.textContent = SCREEN_TITLES[targetId] || "";
}

function initBottomNav() {
  const btns = qsa(".bottom-nav .nav-btn");
  let initialScreen = "calendarSection";
  try {
    const savedScreen = sessionStorage.getItem("bnapp_active_screen");
    if (savedScreen && el(savedScreen)) {
      initialScreen = savedScreen;
    }
  } catch {}

  btns.forEach((b) => b.classList.toggle("active", b.dataset.target === initialScreen));
  qsa(".screen").forEach((s) => s.classList.toggle("active", s.id === initialScreen));
  setActiveScreenMeta(initialScreen);

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
      try { sessionStorage.setItem("bnapp_active_screen", targetId); } catch {}
      qsa(".screen").forEach((s) => s.classList.remove("active"));
      el(targetId)?.classList.add("active");
      setActiveScreenMeta(targetId);
      if (targetId === "statsSection") {
        try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
        setTimeout(() => {
          try {
            if (workFreeChart) {
              workFreeChart.resize();
              workFreeChart.update();
            }
          } catch {}
        }, 60);
      }
    });
  });
}

function initTasksFilters() {
  const btns = qsa("#tasksTypeSegmented .segmented-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTasks(btn.dataset.filter);
    });
  });

  // מתגי סינון מהיר בלוח השנה (הכל | רק שלי | משותף) – נשמר גם אחרי סגירת האפליקציה
  const calOwnerBtns = qsa("#calendarOwnerFilter .owner-filter-btn");
  calOwnerBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ownerFilter === (state.ui.calendarOwnerFilter || "all"));
    btn.onclick = () => {
      calOwnerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.ui.calendarOwnerFilter = btn.dataset.ownerFilter || "all";
      try { localStorage.setItem("bnapp_cal_owner_filter", state.ui.calendarOwnerFilter); } catch {}
      renderCalendar();
      if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
        renderDayEvents(state.ui.openDayKey);
      }
    };
  });

  // מתגי סינון מהיר בדף משימות (הכל | רק שלי | משותף) – נשמר גם אחרי סגירת האפליקציה
  const taskOwnerBtns = qsa("#tasksOwnerFilter .owner-filter-btn");
  taskOwnerBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.ownerFilter === (state.ui.tasksOwnerFilter || "all"));
    btn.onclick = () => {
      taskOwnerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.ui.tasksOwnerFilter = btn.dataset.ownerFilter || "all";
      try { localStorage.setItem("bnapp_tasks_owner_filter", state.ui.tasksOwnerFilter); } catch {}
      renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    };
  });
}

const DEFAULT_SHOPPING_TAB_NAMES = {
  default: "רגיל",
  shabbat: "קניות לשבת",
  pesach: "קניות לפסח",
  holiday: "קניות לחג"
};

const DEFAULT_SHOPPING_FAVORITES = [
  "חלב",
  "לחם",
  "ביצים",
  "גבינה צהובה",
  "קוטג׳",
  "מלפפונים",
  "עגבניות",
  "חזה עוף",
  "נייר טואלט"
];

const SHOPPING_DEPARTMENTS = [
  {
    name: "🥒 ירקות ופירות",
    keywords: [
      "עגבנ", "מלפפון", "בצל", "תפוח", "גזר", "חסה", "פלפל", "גמבה", "אבוקדו",
      "לימון", "בננה", "פטריות", "כוסברה", "פטרוזיליה", "שום", "תפוז", "אבטיח",
      "ענבים", "תות", "בטטה", "קישוא", "חציל", "כרוב", "כרובית", "ברוקולי",
      "סלרי", "שמיר", "נענע", "מנגו", "אפרסק", "אגס", "שזיף", "קלמנטינה", "ירקות", "פירות"
    ]
  },
  {
    name: "🥛 חלב וביצים",
    keywords: [
      "חלב", "גבינ", "קוטג", "יוגורט", "חמאה", "שמנת", "ביצ", "מעדן", "לבנה",
      "שוקו", "מילקי", "צהובה", "בולגרית", "מוצרלה", "ריקוטה", "פרמזן", "קפיר", "אשל", "גיל"
    ]
  },
  {
    name: "🍞 לחם ומאפים",
    keywords: [
      "לחם", "פית", "פיתה", "לחמנ", "חלה", "חלות", "בגט", "טורטיה", "קרואסון",
      "מאפה", "בורקס", "עוגה", "בייגלה"
    ]
  },
  {
    name: "🥩 בשר, עוף ודגים",
    keywords: [
      "עוף", "חזה", "בשר", "בקר", "טחון", "סטייק", "שניצל", "נקניק", "סלמון",
      "דג", "טונה", "פרגית", "פרגיות", "כנפיים", "קבב", "המבורגר", "אנטריקוט", "הודו", "פסטרמה"
    ]
  },
  {
    name: "🥫 מזווה ויבשים",
    keywords: [
      "אורז", "פסטה", "פתיתים", "קוסקוס", "שמן", "קמח", "סוכר", "מלח", "תבלין",
      "רסק", "שימורים", "זיתים", "חומוס", "טחינה", "עדשים", "שעועית", "דבש",
      "ריבה", "קורנפלקס", "שיבולת שועל", "קטשופ", "מיונז", "חרדל", "סויה", "טריאקי", "מרק", "אבקת אפייה"
    ]
  },
  {
    name: "❄️ קפואים",
    keywords: [
      "קפוא", "גליד", "צ'יפס", "ציפס", "פיצה", "מלאווח", "ג'חנון", "אפונה", "תירס קפוא", "שניצל תירס"
    ]
  },
  {
    name: "🧴 ניקיון וטואלטיקה",
    keywords: [
      "נייר טואלט", "סבון", "שמפו", "מרכך", "משחת שיניים", "אקונומיקה", "כביסה",
      "מגבונים", "סקוטש", "שקיות אשפה", "זבל", "נוזל כלים", "פיירי", "דאודורנט",
      "נייר סופג", "אלומיניום", "ניילון נצמד", "סמרטוט", "נוזל רצפות"
    ]
  },
  {
    name: "🍫 חטיפים ומתוקים",
    keywords: [
      "שוקולד", "במבה", "ביסלי", "חטיף", "עוגיות", "וופל", "פיצוחים", "גרעינים",
      "שקדים", "אגוזים", "סוכריות", "מסטיק", "בייגלה", "תפוצ'יפס", "דוריטוס", "מרשמלו"
    ]
  },
  {
    name: "🥤 שתייה ויין",
    keywords: [
      "מים", "קולה", "זירו", "סודה", "מיץ", "בירה", "יין", "תירוש", "קפה",
      "נס קפה", "תה", "אספרסו", "קפסולות", "תרכיז", "פיוז טי", "ספרייט", "פאנטה", "XL", "אקסל"
    ]
  }
];

function classifyShoppingDepartment(text) {
  const clean = (text || "").trim().toLowerCase();
  for (const dept of SHOPPING_DEPARTMENTS) {
    if (dept.keywords.some((kw) => clean.includes(kw))) {
      return dept.name;
    }
  }
  return "📦 כללי";
}

function getSavedShoppingFavorites() {
  if (Array.isArray(state.settings.shoppingFavorites) && state.settings.shoppingFavorites.length) {
    return state.settings.shoppingFavorites;
  }
  try {
    const raw = localStorage.getItem("bnapp_shopping_favorites");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {}
  return [...DEFAULT_SHOPPING_FAVORITES];
}

async function saveShoppingFavoritesList(favs) {
  state.settings.shoppingFavorites = favs;
  try {
    localStorage.setItem("bnapp_shopping_favorites", JSON.stringify(favs));
  } catch {}
  renderShoppingFavoritesBar();
  try {
    await update(ref(db, "settings"), { shoppingFavorites: favs });
  } catch {}
}

function renderShoppingFavoritesBar() {
  const bar = el("shoppingFavoritesBar");
  if (!bar) return;
  const favs = getSavedShoppingFavorites();
  bar.innerHTML = favs
    .map(
      (fav, idx) => `
      <span class="fav-chip">
        <button type="button" class="fav-chip-add" data-fav-name="${fav.replace(/"/g, "&quot;")}">+ ${fav}</button>
        <button type="button" class="fav-chip-del" data-fav-idx="${idx}" title="הסר מהקבועים">×</button>
      </span>
    `
    )
    .join("");

  bar.querySelectorAll(".fav-chip-add").forEach((btn) => {
    btn.onclick = () => {
      const name = btn.dataset.favName;
      if (name) addOrIncrementShoppingItem(name, 1);
    };
  });

  bar.querySelectorAll(".fav-chip-del").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.favIdx);
      const next = getSavedShoppingFavorites().filter((_, i) => i !== idx);
      saveShoppingFavoritesList(next);
    };
  });
}

function getSavedShoppingTabNames() {
  let localNames = {};
  try {
    const raw = localStorage.getItem("bnapp_shopping_tab_names");
    if (raw) localNames = JSON.parse(raw) || {};
  } catch {}
  return {
    ...DEFAULT_SHOPPING_TAB_NAMES,
    ...localNames,
    ...(state.settings.shoppingTabNames || {})
  };
}

function applyShoppingTabNames() {
  const names = getSavedShoppingTabNames();
  const listTabs = qsa("#shoppingSection .segmented-btn");
  listTabs.forEach((btn) => {
    const key = btn.dataset.list;
    if (key && names[key]) {
      btn.textContent = names[key];
    }
  });
}

function openShoppingTabRenameBar() {
  const bar = el("shoppingRenameBar");
  const input = el("shoppingTabNameInput");
  if (!bar || !input) return;
  const currentKey = getCurrentShoppingListKey();
  const names = getSavedShoppingTabNames();
  input.value = names[currentKey] || "";
  bar.classList.remove("hidden");
  setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}

async function saveShoppingTabName() {
  const bar = el("shoppingRenameBar");
  const input = el("shoppingTabNameInput");
  if (!input) return;
  const newName = (input.value || "").trim();
  if (!newName) {
    showToast("נא להזין שם ללשונית");
    return;
  }
  const currentKey = getCurrentShoppingListKey();
  const updated = {
    ...getSavedShoppingTabNames(),
    [currentKey]: newName
  };
  state.settings.shoppingTabNames = updated;
  try {
    localStorage.setItem("bnapp_shopping_tab_names", JSON.stringify(updated));
  } catch {}
  applyShoppingTabNames();
  if (bar) bar.classList.add("hidden");
  showToast(`✏️ שם הלשונית עודכן ל-"${newName}"`);
  try {
    await update(ref(db, "settings/shoppingTabNames"), { [currentKey]: newName });
  } catch (e) {
    console.warn("Failed to sync shopping tab name to Firebase", e);
  }
}

function initShopping() {
  applyShoppingTabNames();
  renderShoppingFavoritesBar();

  const listTabs = qsa("#shoppingSection .segmented-btn");
  listTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      listTabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderShoppingList();
      const bar = el("shoppingRenameBar");
      if (bar && !bar.classList.contains("hidden")) {
        const names = getSavedShoppingTabNames();
        const input = el("shoppingTabNameInput");
        if (input) input.value = names[btn.dataset.list] || btn.textContent;
      }
    });
  });

  if (el("btnRenameShoppingTab")) {
    el("btnRenameShoppingTab").onclick = () => {
      const bar = el("shoppingRenameBar");
      if (bar && !bar.classList.contains("hidden")) {
        bar.classList.add("hidden");
      } else {
        openShoppingTabRenameBar();
      }
    };
  }
  if (el("btnSaveShoppingTabName")) {
    el("btnSaveShoppingTabName").onclick = saveShoppingTabName;
  }
  if (el("btnCancelShoppingTabName")) {
    el("btnCancelShoppingTabName").onclick = () => {
      el("shoppingRenameBar")?.classList.add("hidden");
    };
  }
  if (el("shoppingTabNameInput")) {
    el("shoppingTabNameInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveShoppingTabName();
      }
    });
  }
  if (el("shoppingInput")) {
    el("shoppingInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addShoppingItem();
      }
    });
  }
  if (el("btnAddShopping")) {
    el("btnAddShopping").onclick = addShoppingItem;
  }

  if (el("btnAddShoppingFav")) {
    el("btnAddShoppingFav").onclick = () => {
      const input = el("shoppingInput");
      const val = (input?.value || "").trim();
      if (!val) {
        showToast("הקלד שם מוצר בשורת ההוספה ולחץ על '+ קבוע'");
        input?.focus();
        return;
      }
      const favs = getSavedShoppingFavorites();
      if (!favs.includes(val)) {
        favs.push(val);
        saveShoppingFavoritesList(favs);
        showToast(`⭐ "${val}" נוסף למוצרים הקבועים!`);
      } else {
        showToast("המוצר כבר נמצא בקבועים");
      }
      if (input) input.value = "";
    };
  }

  if (el("btnToggleShoppingDepts")) {
    el("btnToggleShoppingDepts").onclick = () => {
      state.ui.shoppingSortByDept = !state.ui.shoppingSortByDept;
      el("btnToggleShoppingDepts").classList.toggle("active", state.ui.shoppingSortByDept);
      el("btnToggleShoppingDepts").textContent = state.ui.shoppingSortByDept
        ? "🗂️ מיין לפי מחלקות בסופר"
        : "📋 תצוגת רשימה רגילה";
      renderShoppingList();
    };
  }

  if (el("btnClearCompletedShopping")) {
    el("btnClearCompletedShopping").onclick = async () => {
      const listKey = getCurrentShoppingListKey();
      const itemsObj = state.cache.shopping[listKey] || {};
      const completedIds = Object.entries(itemsObj)
        .filter(([, it]) => it && it.completed)
        .map(([id]) => id);

      if (!completedIds.length) {
        showToast("אין פריטים שסומנו ב-✔ למחיקה");
        return;
      }
      for (const id of completedIds) {
        if (state.cache.shopping[listKey]) delete state.cache.shopping[listKey][id];
        try {
          await remove(ref(db, `shopping/${listKey}/${id}`));
        } catch {}
      }
      renderShoppingList();
      showToast(`🧹 נוקו ${completedIds.length} פריטים שנקנו!`);
    };
  }
}

function getCurrentShoppingListKey() {
  const active = qs("#shoppingSection .segmented-btn.active");
  return active ? (active.dataset.list || "default") : "default";
}

function addOrIncrementShoppingItem(rawText, defaultQty = 1) {
  let text = (rawText || "").trim();
  if (!text) return;

  let qty = Math.max(1, Number(defaultQty) || 1);
  // זיהוי כמות מתוך הטקסט (למשל "חלב x3" או "חלב 3")
  const matchQty = text.match(/^(.*?)\s+[xX×*]?\s*(\d+)$/);
  if (matchQty && matchQty[1].trim()) {
    text = matchQty[1].trim();
    qty = Math.max(1, parseInt(matchQty[2], 10));
  }

  const listKey = getCurrentShoppingListKey();
  const itemsObj = state.cache.shopping[listKey] || {};

  // אם המוצר כבר קיים ברשימה ועדיין לא סומן כנקנה -> נגדיל את הכמות שלו!
  const existingEntry = Object.entries(itemsObj).find(
    ([, it]) => it && !it.completed && (it.text || "").trim() === text
  );

  if (existingEntry) {
    const [existingId, existingItem] = existingEntry;
    const nextQty = (Number(existingItem.qty) || 1) + qty;
    if (state.cache.shopping[listKey]?.[existingId]) {
      state.cache.shopping[listKey][existingId].qty = nextQty;
    }
    renderShoppingList();
    update(ref(db, `shopping/${listKey}/${existingId}`), { qty: nextQty });
    showToast(`🛒 עודכנה כמות: ${text} (x${nextQty})`);
    return;
  }

  const newRef = push(ref(db, `shopping/${listKey}`));
  const newItem = {
    text,
    qty,
    dept: classifyShoppingDepartment(text),
    completed: false
  };
  if (!state.cache.shopping[listKey]) state.cache.shopping[listKey] = {};
  if (newRef.key) state.cache.shopping[listKey][newRef.key] = newItem;
  renderShoppingList();
  set(newRef, newItem);
}

function addShoppingItem() {
  const input = el("shoppingInput");
  const qtyInput = el("shoppingQtyInput");
  const text = (input?.value || "").trim();
  if (!text) return;
  const qty = Math.max(1, Number(qtyInput?.value) || 1);
  addOrIncrementShoppingItem(text, qty);
  if (input) input.value = "";
  if (qtyInput) qtyInput.value = "1";
}

function renderShoppingList() {
  const ul = el("shoppingList");
  if (!ul) return;
  ul.innerHTML = "";

  const listKey = getCurrentShoppingListKey();
  const itemsObj = state.cache.shopping[listKey] || {};
  const entries = Object.entries(itemsObj).map(([id, item]) => ({
    id,
    ...item,
    qty: Math.max(1, Number(item?.qty) || 1),
    dept: item?.dept || classifyShoppingDepartment(item?.text || "")
  }));

  if (!entries.length) {
    ul.innerHTML = `<li class="stats-empty-tab">הרשימה ריקה – הוסף מוצרים או לחץ על הקבועים למעלה ⭐</li>`;
    return;
  }

  const createShoppingItemLi = (entry) => {
    const { id, text, qty, completed } = entry;
    const li = document.createElement("li");
    li.className = "shopping-item";
    if (completed) li.classList.add("completed");

    const labelWrap = document.createElement("div");
    labelWrap.className = "shopping-item-main";

    const label = document.createElement("span");
    label.className = "shopping-item-title";
    label.textContent = text;
    labelWrap.appendChild(label);

    const qtyBox = document.createElement("div");
    qtyBox.className = "shopping-qty-controls";

    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "qty-step-btn";
    minusBtn.textContent = "−";
    minusBtn.onclick = () => {
      const next = Math.max(1, qty - 1);
      update(ref(db, `shopping/${listKey}/${id}`), { qty: next });
    };

    const qtyBadge = document.createElement("span");
    qtyBadge.className = "shopping-qty-badge";
    qtyBadge.textContent = `x${qty}`;

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "qty-step-btn";
    plusBtn.textContent = "+";
    plusBtn.onclick = () => {
      const next = qty + 1;
      update(ref(db, `shopping/${listKey}/${id}`), { qty: next });
    };

    qtyBox.appendChild(minusBtn);
    qtyBox.appendChild(qtyBadge);
    qtyBox.appendChild(plusBtn);

    const actionsBox = document.createElement("div");
    actionsBox.className = "shopping-item-actions";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "ghost-pill small";
    toggleBtn.textContent = completed ? "בטל ✔" : "✔";
    toggleBtn.onclick = () =>
      update(ref(db, `shopping/${listKey}/${id}`), { completed: !completed });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost-pill small";
    deleteBtn.textContent = "🗑";
    deleteBtn.onclick = async () => {
      await remove(ref(db, `shopping/${listKey}/${id}`));
      showToast("נמחק");
    };

    actionsBox.appendChild(qtyBox);
    actionsBox.appendChild(toggleBtn);
    actionsBox.appendChild(deleteBtn);

    li.appendChild(labelWrap);
    li.appendChild(actionsBox);
    return li;
  };

  if (!state.ui.shoppingSortByDept) {
    entries
      .sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)))
      .forEach((entry) => ul.appendChild(createShoppingItemLi(entry)));
    return;
  }

  // קיבוץ אוטומטי לפי מחלקות בסופר
  const deptGroups = {};
  entries.forEach((entry) => {
    const d = entry.dept || "📦 כללי";
    if (!deptGroups[d]) deptGroups[d] = [];
    deptGroups[d].push(entry);
  });

  Object.entries(deptGroups).forEach(([deptName, groupItems]) => {
    const headerLi = document.createElement("li");
    headerLi.className = "shopping-dept-header";
    headerLi.innerHTML = `<span>${deptName}</span><span class="dept-count">${groupItems.length}</span>`;
    ul.appendChild(headerLi);

    groupItems
      .sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)))
      .forEach((entry) => ul.appendChild(createShoppingItemLi(entry)));
  });
}

// =========================
// Firebase listeners
// =========================
async function migrateDefaultsOnce() {
  const all = state.cache.events || {};
  const shouldWriteDb = !state._migratedDefaultsDbOnce;
  state._migratedDefaultsDbOnce = true;
  const dbUpdates = {};

  for (const [dk, items] of Object.entries(all)) {
    if (!dk || dk === "undated" || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const day = parseDateKey(dk).getDay();
    const specs = getDailyRoutineSpecsForDay(day);
    const specKeys = new Set(specs.map((s) => s.key));

    for (const [id, ev] of Object.entries(items || {})) {
      if (!ev) continue;
      if (isDefaultEvent(ev) && !specKeys.has(id)) {
        delete items[id];
        if (shouldWriteDb) {
          dbUpdates[`${dk}/${id}`] = null;
        }
      }
    }

    for (const spec of specs) {
      const cur = items[spec.key];
      const desired = {
        _id: spec.key,
        type: "event",
        owner: spec.owner,
        title: spec.title,
        startTime: spec.startTime,
        endTime: spec.endTime,
        statCategory: spec.statCategory,
        dateKey: dk,
        isDefault: true
      };
      if (
        !cur ||
        cur.title !== desired.title ||
        cur.startTime !== desired.startTime ||
        cur.endTime !== desired.endTime ||
        cur.owner !== desired.owner ||
        cur.isDefault !== true
      ) {
        items[spec.key] = desired;
        if (shouldWriteDb) {
          dbUpdates[`${dk}/${spec.key}`] = desired;
        }
      }
    }
  }

  if (shouldWriteDb && Object.keys(dbUpdates).length > 0) {
    update(ref(db, "events"), dbUpdates).catch(() => {});
  }
}

function initFirebaseListeners() {
  onValue(ref(db, "events"), (snap) => {
    state.cache.events = snap.val() || {};
    state.eventsLoaded = true;
    migrateDefaultsOnce();
    renderCalendar();
    if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
      renderDayEvents(state.ui.openDayKey);
    }
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
    checkDueReminders();
    try { syncWidgetDataAndPreview(); } catch {}
  });

  onValue(ref(db, "goals"), (snap) => {
    state.goals = snap.val() || {};
    updateStats();
  });

  onValue(ref(db, "shopping"), (snap) => {
    state.cache.shopping = snap.val() || {};
    renderShoppingList();
  });

  onValue(ref(db, "settings"), (snap) => {
    const settings = snap.val() || {};
    const coordsChanged =
      settings.cityLat !== state.settings.cityLat || settings.cityLon !== state.settings.cityLon;
    state.settings.city = settings.city || localStorage.getItem("bnapp_city") || null;
    if (settings.city) {
      try { localStorage.setItem("bnapp_city", settings.city); } catch {}
    }
    state.settings.cityLat = settings.cityLat || null;
    state.settings.cityLon = settings.cityLon || null;
    state.settings.cityTz = settings.cityTz || null;
    if (coordsChanged) {
      state.cache.shabbat = {};
      try { renderCalendar(); } catch {}
    }
    if (settings.dailySummaryTime) {
      state.settings.dailySummaryTime = settings.dailySummaryTime;
      try { localStorage.setItem("bnapp_daily_summary_time", settings.dailySummaryTime); } catch {}
      const tIn = el("settingsSummaryTime");
      if (tIn && document.activeElement !== tIn) tIn.value = settings.dailySummaryTime;
      try { scheduleDailySummaryAlarm(); } catch {}
    }
    if (settings.shoppingTabNames) {
      state.settings.shoppingTabNames = settings.shoppingTabNames;
      try {
        localStorage.setItem(
          "bnapp_shopping_tab_names",
          JSON.stringify({
            ...getSavedShoppingTabNames(),
            ...settings.shoppingTabNames
          })
        );
      } catch {}
      applyShoppingTabNames();
    }
    if (settings.specialEvents) {
      state.settings.specialEvents = settings.specialEvents;
      try {
        localStorage.setItem("bnapp_special_events", JSON.stringify(settings.specialEvents));
      } catch {}
      renderSpecialCountdownsBar();
    }
    if (Array.isArray(settings.shoppingFavorites)) {
      state.settings.shoppingFavorites = settings.shoppingFavorites;
      try {
        localStorage.setItem("bnapp_shopping_favorites", JSON.stringify(settings.shoppingFavorites));
      } catch {}
      renderShoppingFavoritesBar();
    }

    if (settings.snoozeMinutes && Number(settings.snoozeMinutes) > 0) {
      const sMins = Math.max(1, Math.min(180, Math.round(Number(settings.snoozeMinutes))));
      state.settings.snoozeMinutes = sMins;
      try { localStorage.setItem("bnapp_snooze_minutes", String(sMins)); } catch {}
      try { syncSnoozeUI(); } catch {}
    }

    state.targets = settings.targets || state.targets;

    el("cityLabel").textContent = state.settings.city || "לא נבחרה";
    const cityIn = el("settingsCityInput");
    if (cityIn && document.activeElement !== cityIn) cityIn.value = state.settings.city || "";
    try { syncWidgetDataAndPreview(coordsChanged); } catch {}
  });
  if (el("targetSleep")) {
    el("targetSleep").value = state.targets?.["שינה"]?.hours ?? 8;
  }
  if (el("targetWork")) {
    el("targetWork").value = state.targets?.["עבודה"]?.hours ?? 8;
  }
}

async function persistCitySettings(city, coords) {
  state.settings.city = city || null;
  try {
    if (city) localStorage.setItem("bnapp_city", city);
  } catch {}
  state.settings.cityLat = coords ? coords.lat : null;
  state.settings.cityLon = coords ? coords.lon : null;
  state.settings.cityTz = coords ? coords.tz : null;
  state.cache.shabbat = {}; // זמני שבת יחושבו מחדש לפי המיקום החדש
  el("cityLabel").textContent = city || "לא נבחרה";
  if (el("settingsCityInput")) el("settingsCityInput").value = city || "";
  // כתיבה אטומית אחת – כדי שהמאזין לא יחזיר את העיר הישנה באמצע
  await update(ref(db, "settings"), {
    city: state.settings.city,
    cityLat: state.settings.cityLat,
    cityLon: state.settings.cityLon,
    cityTz: state.settings.cityTz
  });
  renderCalendar();
}

async function saveCitySettings() {
  const city = (el("settingsCityInput").value || "").trim();
  if (!city) {
    showToast("נא להזין שם עיר");
    return;
  }
  const btn = el("btnSaveCity");
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const coords = await lookupCityCoords(city);
    await persistCitySettings(city, coords);
    showToast(`📍 המיקום עודכן ל-${city}`);
  } catch (e) {
    console.error("Failed to save city settings", e);
    showToast("⛔ לא נמצאה עיר בשם הזה – נסה שם אחר (למשל: תל אביב)");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "שמור"; }
  }
}

function useGpsLocation() {
  if (!navigator.geolocation) {
    showToast("המכשיר לא תומך באיתור מיקום");
    return;
  }
  showToast("🛰️ מאתר מיקום...");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const coords = {
        lat: Number(pos.coords.latitude.toFixed(4)),
        lon: Number(pos.coords.longitude.toFixed(4)),
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem"
      };
      let label = "המיקום שלי";
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&accept-language=he&zoom=10`
        );
        const data = await resp.json();
        const a = data.address || {};
        label = a.city || a.town || a.village || a.municipality || label;
      } catch {}
      try {
        await persistCitySettings(label, coords);
        showToast(`📍 המיקום עודכן ל-${label}`);
      } catch {
        showToast("שגיאה בשמירת המיקום");
      }
    },
    () => showToast("⛔ לא ניתנה הרשאת מיקום"),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
  );
}

// =========================
// Theme + notifications
// =========================
function applyTheme(dark) {
  state.ui.darkMode = !!dark;
  document.body.classList.toggle("dark", state.ui.darkMode);
  try { localStorage.setItem("bnappDarkMode", state.ui.darkMode ? "1" : "0"); } catch {}
}
function toggleTheme() { applyTheme(!state.ui.darkMode); }

function initTheme() {
  let dark = false;
  try {
    const saved = localStorage.getItem("bnappDarkMode");
    if (saved === "1") dark = true;
    else if (saved === "0") dark = false;
    else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) dark = true;
  } catch {
    if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) dark = true;
  }
  applyTheme(dark);
}

async function requestNotifications() {
  getSharedAudioCtx();
  playConfirmTick();

  if (!("Notification" in window)) {
    showToast("הדפדפן לא תומך בהתראות מערכת – התראות קוליות וחלונות קופצים יפעלו באפליקציה");
    triggerReminderAlert({
      id: "test",
      dateKey: dateKeyFromDate(new Date()),
      ev: { title: "בדיקת התראה (ללא תמיכת דפדפן)", startTime: formatTimeHM(new Date()) }
    });
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    state.ui.notificationsGranted = false;
    showToast("התראות מערכת נחסמו בהגדרות הדפדפן – חלון קופץ וצליל עדיין יפעלו");
    return;
  }

  localStorage.setItem("notificationsEnabled", "true");
  state.ui.notificationsGranted = true;

  // נשלח מיד התראת בדיקה כדי שהמשתמש יראה וישמע שהכל פועל!
  await showSystemNotification(
    "🔔 התראות BNAPP הופעלו בהצלחה!",
    "מעכשיו תקבל תזכורות עם צליל, רטט והתראה בזמן אמת",
    "bnapp-enabled-test"
  );
  showToast("🔔 התראות הופעלו! נשלחה התראת בדיקה", 3500);

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const token = await getToken(messaging, {
      vapidKey: "BFzkYCDuV_Ij_b3PQtswrDNnPe4xTVUbxYBJKkLx7YEkERrgOSOYC6KeZ1kNUuABeQV1GZ_xYIVnbU27Rseozss",
      serviceWorkerRegistration: registration || undefined
    });

    if (token) {
      await set(ref(db, "notificationTokens/" + token), {
        user: state.currentUser,
        createdAt: Date.now(),
        userAgent: navigator.userAgent
      });
      console.log("FCM TOKEN:", token);
    }
  } catch (err) {
    console.warn("FCM token registration skipped:", err);
  }
}

function testNotificationNow() {
  getSharedAudioCtx();
  triggerReminderAlert({
    id: "test-manual",
    dateKey: dateKeyFromDate(new Date()),
    ev: {
      title: "בדיקת התראה 🔔 הכל עובד מצוין!",
      startTime: formatTimeHM(new Date())
    }
  });
}

function formatReminderLabel(ev) {
  if (!ev) return "";
  if (ev.reminderTime) {
    const dPart = ev.reminderDate ? ` (${ev.reminderDate.slice(8, 10)}/${ev.reminderDate.slice(5, 7)})` : "";
    return `🔔 תזכורת ב-${ev.reminderTime}${dPart}`;
  }
  if (ev.reminderCustomTs) {
    const dt = new Date(ev.reminderCustomTs);
    return `🔔 תזכורת ב-${formatTimeHM(dt)}`;
  }
  if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined && ev.reminderMinutes !== "") {
    const mins = Number(ev.reminderMinutes);
    if (!Number.isNaN(mins) && mins >= 0) {
      if (mins === 0) return "🔔 תזכורת בזמן האירוע";
      if (mins === 60) return "🔔 תזכורת שעה לפני";
      return `🔔 תזכורת ${mins} דק׳ לפני`;
    }
  }
  return "";
}

function hasExplicitReminderSet(ev) {
  if (!ev) return false;
  return (
    ev.reminderCustomTs != null ||
    ev.reminderTime != null ||
    (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined && ev.reminderMinutes !== "")
  );
}

function getEventReminderTimestamp(ev, fallbackDateKey) {
  if (!ev) return null;
  if (isDefaultEvent(ev) && !hasExplicitReminderSet(ev)) return null;

  if (ev.reminderCustomTs && Number.isFinite(Number(ev.reminderCustomTs))) {
    return Number(ev.reminderCustomTs);
  }
  const dk = (ev.dateKey && ev.dateKey !== "undated") ? ev.dateKey : fallbackDateKey;
  if (ev.reminderTime) {
    const targetDk = ev.reminderDate || (dk && dk !== "undated" ? dk : dateKeyFromDate(new Date()));
    const d = parseDateKey(targetDk);
    const [h, m] = ev.reminderTime.split(":").map(Number);
    d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
    return d.getTime();
  }
  if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined && ev.reminderMinutes !== "") {
    const mins = Number(ev.reminderMinutes);
    if (!Number.isNaN(mins) && mins >= 0 && dk && dk !== "undated") {
      const [h, m] = (ev.startTime || "09:00").split(":").map(Number);
      const d = parseDateKey(dk);
      d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
      return d.getTime() - mins * 60000;
    }
  }
  if (!isDefaultEvent(ev) && ev.startTime && dk && dk !== "undated") {
    const [h, m] = ev.startTime.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const d = parseDateKey(dk);
      d.setHours(h, m, 0, 0);
      return d.getTime();
    }
  }
  return null;
}

function areNotificationsEnabled() {
  return localStorage.getItem("notificationsEnabled") !== "false";
}

// זיהוי מצב השמע של הטלפון / האפליקציה:
// "ring" = צלצול רגוע 8 שניות ואז ג'יחרי מדבר
// "vibrate" = רטט בלבד (ללא צלצול וללא דיבור)
// "silent" = שקט (ללא התראה כלל)
function getEffectiveSoundMode() {
  if (!areNotificationsEnabled()) return "silent";

  // 1) בדיקה מול גשר אנדרואיד מקורי (AudioManager.getRingerMode: 0=SILENT, 1=VIBRATE, 2=NORMAL)
  if (hasNativeAndroidBridge()) {
    try {
      if (typeof window.AndroidBridge.getRingerMode === "function") {
        const nativeMode = window.AndroidBridge.getRingerMode();
        if (nativeMode === 0 || nativeMode === "0" || nativeMode === "silent" || nativeMode === "SILENT") {
          return "silent";
        }
        if (nativeMode === 1 || nativeMode === "1" || nativeMode === "vibrate" || nativeMode === "VIBRATE") {
          return "vibrate";
        }
      } else if (window.AndroidBridge.ringerMode !== undefined) {
        const rm = window.AndroidBridge.ringerMode;
        if (rm === 0 || rm === "silent") return "silent";
        if (rm === 1 || rm === "vibrate") return "vibrate";
      }
    } catch {}
  }

  // 2) בדיקת מצב שמע שנבחר באפליקציה
  try {
    const savedMode = localStorage.getItem("bnapp_sound_mode");
    if (savedMode === "silent" || savedMode === "vibrate" || savedMode === "ring") {
      return savedMode;
    }
  } catch {}

  return "ring";
}

function setAppSoundMode(mode) {
  const validMode = mode === "silent" || mode === "vibrate" ? mode : "ring";
  try {
    localStorage.setItem("bnapp_sound_mode", validMode);
    if (validMode === "silent") {
      localStorage.setItem("notificationsEnabled", "false");
      if (hasNativeAndroidBridge()) {
        try { window.AndroidBridge.setNotificationsEnabled(false); } catch {}
      }
      stopAlarmLoop();
    } else {
      localStorage.setItem("notificationsEnabled", "true");
      if (hasNativeAndroidBridge()) {
        try { window.AndroidBridge.setNotificationsEnabled(true); } catch {}
      }
    }
  } catch {}
  syncSoundModeButtons();
}

function syncSoundModeButtons() {
  const mode = getEffectiveSoundMode();
  qsa("#soundModeSelector [data-sound-mode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.soundMode === mode);
  });
}

function getSharedAudioCtx() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!window._bnappAudioCtx) {
      window._bnappAudioCtx = new AudioCtx();
    }
    if (window._bnappAudioCtx.state === "suspended") {
      window._bnappAudioCtx.resume().catch(() => {});
    }
    return window._bnappAudioCtx;
  } catch {
    return null;
  }
}

// ======================================================
// PERSISTENT HTML5 <AUDIO> ENGINE FOR BACKGROUND & SCREEN-OFF
// ======================================================
let _keepAliveWavUrl = null;
let _alarmMelodyWavUrl = null;
let _bgAudioEl = null;
let _isAlarmRinging = false;
let _alarmMuted = false;
let _alarmCycleIndex = 0;
let _currentAlarmTitle = "";

function getKeepAliveWavUrl() {
  if (_keepAliveWavUrl) return _keepAliveWavUrl;
  const sampleRate = 22050;
  const durationSec = 3;
  const numSamples = sampleRate * durationSec;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  // תדר 30Hz בעוצמה 14 מתוך 32767 – בלתי נשמע לחלוטין לאוזן, אך מונע מאנדרואיד להרדים את הכרטיסייה כשהמסך כבוי!
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const val = Math.sin(2 * Math.PI * 30 * t);
    view.setInt16(44 + i * 2, Math.floor(val * 14), true);
  }
  const blob = new Blob([buffer], { type: "audio/wav" });
  _keepAliveWavUrl = URL.createObjectURL(blob);
  return _keepAliveWavUrl;
}

// מנגינת צלצול רגועה ונעימה במשך 8 שניות מלאות (לפני שג'יחרי מתחיל לדבר)
function getAlarmMelodyWavUrl() {
  if (_alarmMelodyWavUrl) return _alarmMelodyWavUrl;
  const sampleRate = 22050;
  // תווים חמים ורגועים (C4 -> E4 -> G4 -> B4 -> C5 -> G4) הפרוסים בנחת על פני 8 שניות
  const notes = [261.63, 329.63, 392.00, 493.88, 523.25, 392.00];
  const noteDur = 1.32;
  const totalSec = 8.0;
  const numSamples = Math.floor(sampleRate * totalSec);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const noteIdx = Math.floor(t / noteDur);
    let sample = 0;
    if (noteIdx < notes.length) {
      const localT = t - noteIdx * noteDur;
      const freq = notes[noteIdx];
      // כניסה רכה (fade-in של 80ms) ודעיכה איטית ורגועה כמו פעמון זן/נבל
      const attack = Math.min(1, localT / 0.08);
      const decay = Math.exp(-localT * 2.1);
      const env = attack * decay;
      sample =
        (Math.sin(2 * Math.PI * freq * localT) * 0.78 +
          Math.sin(4 * Math.PI * freq * localT) * 0.16 +
          Math.sin(3 * Math.PI * freq * localT) * 0.06) *
        env;
    }
    const pcm = Math.max(-32767, Math.min(32767, Math.floor(sample * 13500)));
    view.setInt16(44 + i * 2, pcm, true);
  }
  const blob = new Blob([buffer], { type: "audio/wav" });
  _alarmMelodyWavUrl = URL.createObjectURL(blob);
  return _alarmMelodyWavUrl;
}

function getBgAudioPlayer() {
  if (_bgAudioEl) return _bgAudioEl;
  const audio = document.createElement("audio");
  audio.id = "bnappBgAudio";
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.referrerPolicy = "no-referrer";
  audio.preload = "none";
  audio.style.display = "none";
  document.body.appendChild(audio);

  _bgAudioEl = audio;
  return _bgAudioEl;
}

function hasActivePendingReminders() {
  const now = Date.now();
  return Object.values(directReminders).some((r) => r && !r.fired && r.targetTs > now - 5000);
}

// שחרור מלא של ערוץ השמע (Audio Focus) כאשר לא מושמעת התראה פעילה,
// כדי שעוצמת המוזיקה בטלפון (Spotify / YouTube / Apple Music) תישאר רגילה ב-100%!
function releaseAudioFocusIfIdle() {
  if (_isAlarmRinging) return;
  try {
    if (_bgAudioEl) {
      _bgAudioEl.onended = null;
      _bgAudioEl.onerror = null;
      _bgAudioEl.loop = false;
      _bgAudioEl.pause();
      _bgAudioEl.removeAttribute("src");
      try { _bgAudioEl.load(); } catch {}
    }
    if (window._bnappAudioCtx && window._bnappAudioCtx.state === "running") {
      window._bnappAudioCtx.suspend().catch(() => {});
    }
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {}
    }
  } catch {}
}

function startBackgroundKeepAliveAudio() {
  // מבוטל בכוונה: לא מפעילים אודיו שקט ברקע כדי לא להנמיך את המוזיקה בטלפון כל עוד אין התראה!
}

function stopKeepAliveAudio() {
  releaseAudioFocusIfIdle();
}

function warmUpSpeechEngine() {
  // מופעל רק בעת התראה אמיתית כדי לא לתפוס Audio Focus סתם
}

// צליל אישור קצר בעת לחיצה על הגדרת תזכורת – משחרר מיד את ערוץ השמע בסיום
function playConfirmTick() {
  if (getEffectiveSoundMode() !== "ring") return;
  try {
    const ctx = getSharedAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
    setTimeout(releaseAudioFocusIfIdle, 250);
  } catch {}
}

function playReminderSound() {
  const mode = getEffectiveSoundMode();
  if (mode === "silent") return;
  if (mode === "vibrate") {
    try {
      if (navigator.vibrate) navigator.vibrate([350, 180, 350, 180, 500]);
    } catch {}
    return;
  }
  try {
    const ctx = getSharedAudioCtx();
    if (!ctx) return;
    // צליל פעמונים רך ונעים (Sine wave) במשך 8 השניות הראשונות
    const notes = [261.63, 329.63, 392.00, 493.88, 523.25, 392.00];
    notes.forEach((freq, i) => {
      const startAt = ctx.currentTime + i * 1.3;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.linearRampToValueAtTime(0.16, startAt + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 1.25);
    });
    setTimeout(releaseAudioFocusIfIdle, 8200);
  } catch (e) {
    console.warn("Audio reminder failed:", e);
  }
}

function speakGihariLoud(text) {
  if (getEffectiveSoundMode() !== "ring" || !text || _alarmMuted) return;
  try {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "he-IL";
      // קול גברי עמוק, חלק ומגניב לג'יחרי
      utter.rate = 1.08;
      utter.pitch = 0.82;
      utter.volume = 1.0;
      if (gihariVoice) utter.voice = gihariVoice;
      speechSynthesis.speak(utter);
    }
  } catch {}
}

function getSnoozeMinutes() {
  const fromState = Number(state.settings?.snoozeMinutes);
  if (fromState > 0 && fromState <= 180) return Math.round(fromState);
  try {
    const saved = Number(localStorage.getItem("bnapp_snooze_minutes"));
    if (saved > 0 && saved <= 180) return Math.round(saved);
  } catch {}
  if (hasNativeAndroidBridge() && typeof window.AndroidBridge.getSnoozeMinutes === "function") {
    try {
      const nVal = Number(window.AndroidBridge.getSnoozeMinutes());
      if (nVal > 0 && nVal <= 180) return Math.round(nVal);
    } catch {}
  }
  return 10;
}

function syncSnoozeUI() {
  const mins = getSnoozeMinutes();
  const input = el("settingsSnoozeMinutes");
  if (input && document.activeElement !== input) {
    input.value = String(mins);
  }
  qsa("#snoozePresetChips [data-snooze-preset]").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.snoozePreset) === mins);
  });
  const modalSnoozeBtn = el("btnReminderSnooze");
  if (modalSnoozeBtn) {
    modalSnoozeBtn.textContent = `⏰ הזכר לי שוב בעוד ${mins} דקות`;
  }
  const luxSnoozeBtn = el("btnLuxAlarmSnooze");
  if (luxSnoozeBtn) {
    luxSnoozeBtn.textContent = `😴 נודניק (${mins} דק׳)`;
  }
  if (hasNativeAndroidBridge() && typeof window.AndroidBridge.setSnoozeMinutes === "function") {
    try { window.AndroidBridge.setSnoozeMinutes(mins); } catch {}
  }
  postToServiceWorker({
    type: "SET_SNOOZE_MINUTES",
    snoozeMinutes: mins
  });
}

async function saveSnoozeMinutes(overrideMins = null) {
  const input = el("settingsSnoozeMinutes");
  const raw = overrideMins != null ? Number(overrideMins) : Number(input?.value || 10);
  if (isNaN(raw) || raw < 1 || raw > 180) {
    showToast("נא לבחור זמן נודניק בין 1 ל-180 דקות");
    return;
  }
  const mins = Math.round(raw);
  state.settings.snoozeMinutes = mins;
  try {
    localStorage.setItem("bnapp_snooze_minutes", String(mins));
  } catch {}
  syncSnoozeUI();
  try {
    await update(ref(db, "settings"), { snoozeMinutes: mins });
  } catch (e) {
    console.warn("Failed saving snoozeMinutes to Firebase", e);
  }
  showToast(`😴 זמן ברירת המחדל לנודניק עודכן ל-${mins} דקות`);
}

function updateReminderStageBadge(text) {
  const badge = el("reminderAlertStageBadge");
  if (badge) badge.textContent = text;
  const luxStatus = el("luxAlarmStatus");
  if (luxStatus) luxStatus.textContent = text;
}

// מפעיל לולאת שעון מעורר רגועה (8 שניות צלצול רגוע ורק לאחר מכן ג'יחרי מדבר אם לא הושתק!)
function startAlarmLoop(titleText = "אירוע ביומן") {
  const soundMode = getEffectiveSoundMode();
  stopAlarmLoop();

  // אם הטלפון על שקט -> ללא התראה קולית או רטט כלל
  if (soundMode === "silent") {
    updateReminderStageBadge("🔕 מצב שקט פעיל – ללא קול וללא רטט");
    return;
  }

  _isAlarmRinging = true;
  _alarmMuted = false;
  _alarmCycleIndex = 0;
  _currentAlarmTitle = titleText;

  const muteBtn = el("btnReminderMuteNow");
  if (muteBtn) {
    muteBtn.classList.remove("muted");
    muteBtn.textContent = "🔇 השתק התראה עכשיו";
  }

  // אם הטלפון על רטט -> התראה ברטט בלבד ללא צלצול וללא דיבור של ג'יחרי!
  if (soundMode === "vibrate") {
    updateReminderStageBadge("📳 מצב רטט – התראה ברטט בלבד (ללא קול)");
    const triggerVibratePulse = () => {
      if (!_isAlarmRinging || _alarmMuted) return;
      try {
        if (navigator.vibrate) navigator.vibrate([400, 180, 400, 180, 600]);
      } catch {}
    };
    triggerVibratePulse();
    let vibCount = 1;
    window._alarmLoopTimer = setInterval(() => {
      if (!_isAlarmRinging || _alarmMuted || vibCount >= 3) {
        clearInterval(window._alarmLoopTimer);
        window._alarmLoopTimer = null;
        return;
      }
      vibCount++;
      triggerVibratePulse();
    }, 3200);
    return;
  }

  // מצב צלצול רגיל ("ring"):
  // שלב 1: במשך 8 שניות מלאות מושמע רק צלצול רגוע ונעים.
  // שלב 2: רק לאחר 8 שניות, אם ההתראה לא הושתקה, ג'יחרי מתחיל לדבר בקול המגניב שלו!
  const speechText = getCoolGihariAlertLine(titleText);
  const ttsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=he&q=${encodeURIComponent(speechText)}`;
  const alarmUrl = getAlarmMelodyWavUrl();
  const audio = getBgAudioPlayer();

  audio.loop = false;
  audio.volume = 0.85;

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `🔔 תזכורת: ${titleText}`,
        artist: "ג'יחרי – BNAPP",
        album: "BNAPP"
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("pause", () => stopAlarmLoop());
      navigator.mediaSession.setActionHandler("stop", () => stopAlarmLoop());
    } catch {}
  }

  const startCalm8SecChimePhase = () => {
    if (!_isAlarmRinging || _alarmMuted || getEffectiveSoundMode() !== "ring") return;
    if (_alarmCycleIndex >= 3) {
      stopAlarmLoop();
      return;
    }
    _alarmCycleIndex++;

    let secsLeft = 8;
    updateReminderStageBadge(`🎶 צלצול רגוע... ג'יחרי ידבר בעוד ${secsLeft} שניות (אם לא יושתק)`);
    if (window._alarmCountdownInterval) clearInterval(window._alarmCountdownInterval);
    window._alarmCountdownInterval = setInterval(() => {
      if (!_isAlarmRinging || _alarmMuted) {
        clearInterval(window._alarmCountdownInterval);
        window._alarmCountdownInterval = null;
        return;
      }
      secsLeft = Math.max(0, secsLeft - 1);
      if (secsLeft > 0) {
        updateReminderStageBadge(`🎶 צלצול רגוע... ג'יחרי ידבר בעוד ${secsLeft} שניות (אם לא יושתק)`);
      }
    }, 1000);

    playReminderSound();
    try {
      if (navigator.vibrate) navigator.vibrate([250, 150, 250]);
    } catch {}

    audio.onended = null;
    audio.onerror = null;
    try {
      audio.preservesPitch = true;
      audio.playbackRate = 1.0;
    } catch {}
    audio.src = alarmUrl;
    audio.volume = 0.85;
    audio.play().catch(() => {});

    // טיימר קשיח של 8 שניות מלאות לפני שג'יחרי מתחיל לדבר!
    if (window._alarmStepTimer) clearTimeout(window._alarmStepTimer);
    window._alarmStepTimer = setTimeout(() => {
      if (window._alarmCountdownInterval) {
        clearInterval(window._alarmCountdownInterval);
        window._alarmCountdownInterval = null;
      }
      if (!_isAlarmRinging || _alarmMuted || getEffectiveSoundMode() !== "ring") return;
      startGihariVoicePhase();
    }, 8000);
  };

  const startGihariVoicePhase = () => {
    if (!_isAlarmRinging || _alarmMuted || getEffectiveSoundMode() !== "ring") return;
    updateReminderStageBadge("🎙️ ג'יחרי מדבר עכשיו... (לחץ על השתק להפסקה)");

    // מפעיל קריינות בקול העמוק והמגניב של ג'יחרי
    audio.onended = () => {
      if (!_isAlarmRinging || _alarmMuted) return;
      window._alarmStepTimer = setTimeout(() => startCalm8SecChimePhase(), 1500);
    };
    audio.onerror = () => {
      if (!_isAlarmRinging || _alarmMuted) return;
      speakGihariLoud(speechText);
      window._alarmStepTimer = setTimeout(() => startCalm8SecChimePhase(), 4000);
    };
    try {
      audio.preservesPitch = false;
      audio.mozPreservesPitch = false;
      audio.webkitPreservesPitch = false;
      audio.playbackRate = 0.92;
    } catch {}
    audio.src = ttsUrl;
    audio.volume = 1.0;
    audio.play().catch(() => {
      if (!_isAlarmRinging || _alarmMuted) return;
      speakGihariLoud(speechText);
      window._alarmStepTimer = setTimeout(() => startCalm8SecChimePhase(), 4000);
    });
  };

  startCalm8SecChimePhase();
}

function stopAlarmLoop() {
  _isAlarmRinging = false;
  _alarmMuted = true;
  if (hasNativeAndroidBridge()) {
    try { window.AndroidBridge.stopAlarm(); } catch (e) {}
  }
  if (window._alarmLoopTimer) {
    clearInterval(window._alarmLoopTimer);
    window._alarmLoopTimer = null;
  }
  if (window._alarmCountdownInterval) {
    clearInterval(window._alarmCountdownInterval);
    window._alarmCountdownInterval = null;
  }
  if (window._alarmStepTimer) {
    clearTimeout(window._alarmStepTimer);
    window._alarmStepTimer = null;
  }
  try {
    if (navigator.vibrate) navigator.vibrate(0);
  } catch {}
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch {}

  const muteBtn = el("btnReminderMuteNow");
  if (muteBtn) {
    muteBtn.classList.add("muted");
    muteBtn.textContent = "🔇 ההתראה הושתקה";
  }
  updateReminderStageBadge("🔇 ההתראה הושתקה");

  releaseAudioFocusIfIdle();
}

async function postToServiceWorker(message) {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const target = (reg && (reg.active || reg.waiting || reg.installing)) || navigator.serviceWorker.controller;
    if (target && typeof target.postMessage === "function") {
      target.postMessage(message);
    }
  } catch (e) {}
}

async function showSystemNotification(title, body, tagKey) {
  const soundMode = getEffectiveSoundMode();
  if (!areNotificationsEnabled() || soundMode === "silent") return;
  const tag = tagKey || `bnapp-rem-${Date.now()}`;
  const snoozeMins = getSnoozeMinutes();
  try {
    postToServiceWorker({
      type: "TRIGGER_SW_NOTIFICATION_NOW",
      key: tag,
      title,
      body,
      soundMode,
      snoozeMinutes: snoozeMins
    });
  } catch {}

  try {
    if ("Notification" in window && Notification.permission === "granted") {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && typeof reg.showNotification === "function") {
          await reg.showNotification(title, {
            body,
            icon: "./icon-192.png",
            badge: "./icon-192.png",
            vibrate: soundMode === "vibrate" ? [350, 180, 350, 180, 500] : [250, 150, 250],
            requireInteraction: true,
            renotify: true,
            tag,
            actions: [
              { action: "mute", title: "🔇 השתק" },
              { action: "snooze", title: `😴 נודניק (${snoozeMins} דק׳)` }
            ],
            data: {
              url: "./",
              key: tag,
              title,
              body,
              soundMode,
              snoozeMinutes: snoozeMins
            }
          });
          return;
        }
      }
      new Notification(title, { body, tag });
    }
  } catch {}
}

// ======================================================
// DIRECT REMINDER SCHEDULER + LIVE VISUAL COUNTDOWN BAR
// ======================================================
const directReminders = {};
const directTimeouts = {};
let activeWakeLock = null;

async function ensureWakeLockForShortReminder() {
  try {
    if ("wakeLock" in navigator && !activeWakeLock) {
      activeWakeLock = await navigator.wakeLock.request("screen");
      activeWakeLock.addEventListener("release", () => {
        activeWakeLock = null;
      });
    }
  } catch {}
}

function saveDirectRemindersToStorage() {
  try {
    localStorage.setItem("bnapp_direct_reminders", JSON.stringify(directReminders));
  } catch {}
}

// בודק האם האירוע שייך למשתמש הפעיל כרגע במכשיר (בנימין / ננה / משותף)
function shouldRemindCurrentUser(ev) {
  if (!ev) return true;
  const owner = ev.owner || "shared";
  const currentUser = state.currentUser || "binyamin";
  if (owner === "shared") return true;
  return owner === currentUser;
}

function wasEventRemindedForCurrentUser(ev) {
  if (!ev) return false;
  const currentUser = state.currentUser || "binyamin";
  const owner = ev.owner || "shared";
  if (owner === "shared") {
    return Boolean(ev[`remindedAt_${currentUser}`]);
  }
  return Boolean(ev.remindedAt || ev[`remindedAt_${currentUser}`]);
}

function getRemindedUpdatePayload(ev, now) {
  const currentUser = state.currentUser || "binyamin";
  const owner = ev?.owner || "shared";
  if (owner === "shared") {
    return { [`remindedAt_${currentUser}`]: now };
  }
  return {
    remindedAt: now,
    [`remindedAt_${currentUser}`]: now
  };
}

function getClearRemindedPayload() {
  return {
    remindedAt: null,
    remindedAt_binyamin: null,
    remindedAt_nana: null,
    remindedAt_shared: null
  };
}

function syncRemindersForCurrentUser() {
  Object.keys(directReminders).forEach((key) => {
    const rem = directReminders[key];
    if (!rem) return;
    const cachedEv = state.cache.events?.[rem.dateKey]?.[rem.id];
    const owner = cachedEv?.owner || rem.owner || "shared";
    if (!shouldRemindCurrentUser({ owner })) {
      cancelDirectReminder(key);
    }
  });
  checkDueReminders();
  renderActiveRemindersBar();
}

function loadDirectRemindersFromStorage() {
  try {
    const raw = localStorage.getItem("bnapp_direct_reminders");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const now = Date.now();
    Object.entries(parsed || {}).forEach(([key, rem]) => {
      if (!rem || rem.fired) return;
      if (!shouldRemindCurrentUser({ owner: rem.owner || "shared" })) return;
      if (rem.targetTs > now - 30 * 60 * 1000) {
        directReminders[key] = rem;
        armDirectTimeout(key);
      }
    });
    renderActiveRemindersBar();
    if (hasActivePendingReminders()) {
      startBackgroundKeepAliveAudio();
    }
  } catch {}
}

function armDirectTimeout(key) {
  const rem = directReminders[key];
  if (!rem || rem.fired) return;
  if (directTimeouts[key]) clearTimeout(directTimeouts[key]);

  const delay = Math.max(0, rem.targetTs - Date.now());
  if (delay <= 60 * 60 * 1000) {
    ensureWakeLockForShortReminder();
    startBackgroundKeepAliveAudio();
  }
  directTimeouts[key] = setTimeout(() => {
    fireDirectReminder(key);
  }, delay);
}

function scheduleDirectReminder({ id, dateKey, ev, targetTs }) {
  if (!id || !targetTs) return;
  const dk = dateKey || "undated";
  const key = `${dk}/${id}`;

  // אם האירוע שייך למשתמש השני (למשל אירוע של ננה כשבנימין מחובר במכשיר שלו) –
  // לא מפעילים שעון במכשיר הזה, אלא רק שומרים בענן כדי שהמכשיר של המשתמש השני יקבל את ההתראה!
  if (ev && !shouldRemindCurrentUser(ev)) {
    cancelDirectReminder(key);
    return;
  }

  // הגדרת תזכורת חדשה מפעילה אוטומטית את מצב ההתראות אם היה כבוי
  localStorage.setItem("notificationsEnabled", "true");

  const title = ev?.title || "אירוע / משימה";
  const startTime = ev?.startTime || "";
  const owner = ev?.owner || "shared";
  const timeInfo = startTime ? `שעה: ${startTime}` : `שעת תזכורת: ${formatTimeHM(new Date(targetTs))}`;

  getSharedAudioCtx();
  playConfirmTick();

  // אם אנחנו בתוך אפליקציית האנדרואיד המותקנת (BNAPP.apk) – רושמים שעון מעורר אמיתי של מערכת ההפעלה!
  if (hasNativeAndroidBridge()) {
    try {
      window.AndroidBridge.setNotificationsEnabled(true);
      window.AndroidBridge.scheduleAlarm(key, title, `${title} • ${timeInfo}`, Math.round(Number(targetTs)));
    } catch (e) {}
  }

  directReminders[key] = {
    key,
    id,
    dateKey: dk,
    title,
    startTime,
    owner,
    targetTs: Number(targetTs),
    fired: false
  };

  saveDirectRemindersToStorage();
  armDirectTimeout(key);
  startBackgroundKeepAliveAudio();
  renderActiveRemindersBar();

  postToServiceWorker({
    type: "SCHEDULE_SW_NOTIFICATION",
    key,
    title: `⏰ תזכורת BNAPP: ${title}`,
    body: `${title} • ${timeInfo}`,
    targetTs: Number(targetTs),
    soundMode: getEffectiveSoundMode(),
    snoozeMinutes: getSnoozeMinutes()
  });
}

function cancelDirectReminder(key) {
  if (hasNativeAndroidBridge()) {
    try { window.AndroidBridge.cancelAlarm(key); } catch (e) {}
  }
  if (directTimeouts[key]) {
    clearTimeout(directTimeouts[key]);
    delete directTimeouts[key];
  }
  if (directReminders[key]) {
    delete directReminders[key];
    saveDirectRemindersToStorage();
  }
  postToServiceWorker({
    type: "CANCEL_SW_NOTIFICATION",
    key
  });
  if (!hasActivePendingReminders() && !_isAlarmRinging) {
    stopKeepAliveAudio();
  }
  renderActiveRemindersBar();
}

function fireDirectReminder(key) {
  const rem = directReminders[key];
  if (!rem || rem.fired) return;
  rem.fired = true;

  // אם המשתמש עדיין על גרסת ה-APK הישנה – נבטל את השעון הישן של ה-APK כדי שלא יפעיל את ההתראה הישנה (0.9 שניות),
  // והאפליקציה תפעיל אוטומטית את ההתראה היוקרתית החדשה (8 שניות צלצול רגוע + חלונית עליונה עם השתק ונודניק)!
  if (hasNativeAndroidBridge() && !isUpdatedNativeApk()) {
    try {
      window.AndroidBridge.cancelAlarm(key);
      window.AndroidBridge.stopAlarm();
    } catch {}
  }

  if (directTimeouts[key]) {
    clearTimeout(directTimeouts[key]);
    delete directTimeouts[key];
  }
  delete directReminders[key];
  saveDirectRemindersToStorage();
  renderActiveRemindersBar();

  const { id, dateKey, title, startTime, owner } = rem;
  const cachedEv = state.cache.events?.[dateKey]?.[id];
  const effectiveEv = cachedEv || { title, startTime, owner: owner || "shared", _id: id, dateKey };

  // בדיקה כפולה שהתזכורת אכן מיועדת למשתמש הפעיל במכשיר זה
  if (id !== "test" && id !== "test-manual" && !shouldRemindCurrentUser(effectiveEv)) {
    return;
  }

  const now = Date.now();
  const remPayload = getRemindedUpdatePayload(effectiveEv, now);
  if (cachedEv) {
    Object.assign(cachedEv, remPayload);
  }
  if (id && dateKey && id !== "test" && id !== "test-manual") {
    update(ref(db, `events/${dateKey}/${id}`), remPayload).catch(() => {});
  }

  triggerReminderAlert({
    id,
    dateKey,
    ev: effectiveEv
  });
}

window._onSwReminderFired = (msg) => {
  if (msg && msg.key && directReminders[msg.key]) {
    fireDirectReminder(msg.key);
  }
};

function formatCountdownMMSS(msRemaining) {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function renderActiveRemindersBar() {
  // ביטול הצגת סרגל הספירה לאחור על המסך (ההתראות ממשיכות לפעול ברקע כרגיל)
  const bar = el("activeRemindersBar");
  if (!bar) return;
  bar.classList.add("hidden");
  bar.innerHTML = "";
}

function tickDirectReminders() {
  const now = Date.now();
  Object.keys(directReminders).forEach((key) => {
    const rem = directReminders[key];
    if (!rem || rem.fired) return;
    if (now >= rem.targetTs) {
      fireDirectReminder(key);
    }
  });
  renderActiveRemindersBar();
  checkDueReminders();
}

function triggerReminderAlert(item) {
  const soundMode = getEffectiveSoundMode();
  if (!areNotificationsEnabled() || soundMode === "silent") {
    if (item && (item.id === "test" || item.id === "test-manual")) {
      showToast("🔕 הטלפון/אפליקציה במצב שקט – ללא התראה (ניתן לשנות לצלצול או רטט בהגדרות)", 4000);
    }
    return;
  }
  const { id, dateKey, ev } = item;
  if (id !== "test" && id !== "test-manual" && ev && !shouldRemindCurrentUser(ev)) {
    return;
  }
  const titleText = ev?.title || "אירוע / משימה";
  const timeInfo = ev?.startTime ? `שעה: ${ev.startTime}` : (ev?.reminderTime ? `שעת תזכורת: ${ev.reminderTime}` : "");
  const notifBody = timeInfo ? `${titleText} • ${timeInfo}` : titleText;
  const snoozeMins = getSnoozeMinutes();

  // אם מדובר בבדיקה ידנית בתוך אפליקציית האנדרואיד המעודכנת – נפעיל גם את חלונית השעון המעורר העליונה של אנדרואיד
  if ((id === "test" || id === "test-manual") && isUpdatedNativeApk() && typeof window.AndroidBridge.triggerAlarmNow === "function") {
    try {
      window.AndroidBridge.triggerAlarmNow("test_alarm", titleText, notifBody);
    } catch {}
  } else if (hasNativeAndroidBridge() && !isUpdatedNativeApk()) {
    try {
      window.AndroidBridge.stopAlarm();
    } catch {}
  }

  // מפעיל את ההתראה לפי מצב השמע (במצב צלצול: 8 שניות צלצול רגוע ורק אז ג'יחרי מדבר; במצב רטט: רטט בלבד)
  startAlarmLoop(titleText);

  // התראת מערכת (עם כפתורי השתק ונודניק ישירות מהחלונית העליונה)
  showSystemNotification(`⏰ תזכורת: ${titleText}`, notifBody, `${dateKey}-${id}-${Date.now()}`);

  const executeSnoozeAction = async () => {
    stopAlarmLoop();
    el("reminderAlertModal")?.classList.add("hidden");
    el("luxuryTopAlarmBanner")?.classList.add("hidden");

    const mins = getSnoozeMinutes();
    const snoozeTs = Date.now() + mins * 60 * 1000;
    const snoozeDate = new Date(snoozeTs);
    const targetId = id || "snooze";
    const targetDk = dateKey || dateKeyFromDate(new Date());

    if (hasNativeAndroidBridge() && typeof window.AndroidBridge.snoozeAlarmNow === "function") {
      try {
        window.AndroidBridge.snoozeAlarmNow(`${targetDk}/${targetId}`, titleText, notifBody, mins);
      } catch {}
    }

    scheduleDirectReminder({
      id: targetId,
      dateKey: targetDk,
      ev: ev || { title: titleText },
      targetTs: snoozeTs
    });

    const clearRem = getClearRemindedPayload();
    if (state.cache.events[targetDk]?.[targetId]) {
      Object.assign(state.cache.events[targetDk][targetId], {
        reminderCustomTs: snoozeTs,
        reminderDate: dateKeyFromDate(snoozeDate),
        reminderTime: formatTimeHM(snoozeDate),
        ...clearRem
      });
    }
    showToast(`😴 נודניק הופעל – נזכיר שוב בעוד ${mins} דקות`);
    if (targetId !== "test" && targetId !== "test-manual") {
      await update(ref(db, `events/${targetDk}/${targetId}`), {
        reminderCustomTs: snoozeTs,
        reminderDate: dateKeyFromDate(snoozeDate),
        reminderTime: formatTimeHM(snoozeDate),
        ...clearRem
      });
    }
  };

  // חלונית התראה עליונה יוקרתית (בחלק העליון של המסך עם השתק ונודניק בלחיצה אחת)
  const topBanner = el("luxuryTopAlarmBanner");
  if (topBanner) {
    if (el("luxAlarmTitle")) el("luxAlarmTitle").textContent = titleText;
    if (el("luxAlarmMeta")) el("luxAlarmMeta").textContent = timeInfo || "הגיע זמן התזכורת";
    if (el("luxAlarmClock")) el("luxAlarmClock").textContent = formatTimeHM(new Date());
    if (el("btnLuxAlarmSnooze")) {
      el("btnLuxAlarmSnooze").textContent = `😴 נודניק (${snoozeMins} דק׳)`;
      el("btnLuxAlarmSnooze").onclick = executeSnoozeAction;
    }
    if (el("btnLuxAlarmMute")) {
      el("btnLuxAlarmMute").onclick = () => {
        stopAlarmLoop();
        topBanner.classList.add("hidden");
        el("reminderAlertModal")?.classList.add("hidden");
        showToast("🔇 ההתראה הושתקה", 2000);
      };
    }
    topBanner.classList.remove("hidden");
  }

  // חלון התראה קופץ בתוך האפליקציה (נשאר פעיל כרגיל כשנמצאים בתוך האפליקציה!)
  const modal = el("reminderAlertModal");
  if (modal) {
    el("reminderAlertTitle").textContent = titleText;
    el("reminderAlertMeta").textContent = timeInfo || "הגיע זמן התזכורת שהגדרת!";
    if (el("btnReminderSnooze")) {
      el("btnReminderSnooze").textContent = `⏰ הזכר לי שוב בעוד ${snoozeMins} דקות`;
    }
    modal.classList.remove("hidden");

    const muteNowBtn = el("btnReminderMuteNow");
    if (muteNowBtn) {
      muteNowBtn.onclick = () => {
        stopAlarmLoop();
        topBanner?.classList.add("hidden");
        showToast("🔇 השמע הושתק", 2000);
      };
    }

    const backdrop = el("reminderAlertBackdrop") || modal.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.onclick = () => {
        stopAlarmLoop();
        topBanner?.classList.add("hidden");
        modal.classList.add("hidden");
      };
    }

    el("btnReminderDone").onclick = () => {
      stopAlarmLoop();
      topBanner?.classList.add("hidden");
      modal.classList.add("hidden");
      if (id && id !== "test" && id !== "test-manual") {
        toggleTaskDone({ ...ev, id, _id: id, dateKey });
      }
    };

    el("btnReminderSnooze").onclick = executeSnoozeAction;

    el("btnReminderDismiss").onclick = () => {
      stopAlarmLoop();
      topBanner?.classList.add("hidden");
      modal.classList.add("hidden");
    };
  } else {
    showToast(`🔔 תזכורת: ${titleText}`, 6000);
  }
}

function checkDueReminders() {
  if (!areNotificationsEnabled()) return;
  const now = Date.now();
  const allEvents = state.cache.events || {};

  Object.entries(allEvents).forEach(([dateKey, dayItems]) => {
    Object.entries(dayItems || {}).forEach(([id, ev]) => {
      if (!ev || ev.completed === true) return;

      const key = `${dateKey}/${id}`;

      // בדיקת שיוך למשתמש (ננה / בנימין / משותף):
      if (!shouldRemindCurrentUser(ev)) {
        if (directReminders[key]) {
          cancelDirectReminder(key);
        }
        return;
      }

      if (wasEventRemindedForCurrentUser(ev)) return;

      const hasExplicitReminder = hasExplicitReminderSet(ev);
      if (isDefaultEvent(ev) && !hasExplicitReminder) return;

      const remindTs = getEventReminderTimestamp(ev, dateKey);
      if (!remindTs) return;

      // אם התזכורת בעתיד הקרוב (עד 12 שעות קדימה) ועדיין לא בסרגל הספירה לאחור – נחבר אותה!
      if (remindTs > now && remindTs - now <= 12 * 60 * 60 * 1000 && hasExplicitReminder) {
        if (!directReminders[key] || directReminders[key].targetTs !== remindTs) {
          const title = ev.title || "אירוע / משימה";
          const startTime = ev.startTime || "";
          const timeInfo = startTime ? `שעה: ${startTime}` : `שעת תזכורת: ${formatTimeHM(new Date(remindTs))}`;
          directReminders[key] = {
            key,
            id,
            dateKey,
            title,
            startTime,
            owner: ev.owner || "shared",
            targetTs: remindTs,
            fired: false
          };
          saveDirectRemindersToStorage();
          armDirectTimeout(key);
          renderActiveRemindersBar();
          if (hasNativeAndroidBridge()) {
            try {
              window.AndroidBridge.scheduleAlarm(
                String(key),
                String(title),
                `${title} • ${timeInfo}`,
                Math.round(Number(remindTs))
              );
            } catch (e) {}
          }
        }
        return;
      }

      // עבור תזכורת מפורשת: עד 30 דקות אחורה; עבור שעת התחלה רגילה: עד 5 דקות אחורה
      const maxWindowMs = hasExplicitReminder ? 30 * 60 * 1000 : 5 * 60 * 1000;

      if (now >= remindTs && now - remindTs < maxWindowMs) {
        const remPayload = getRemindedUpdatePayload(ev, now);
        Object.assign(ev, remPayload);
        if (directReminders[key]) {
          delete directReminders[key];
          saveDirectRemindersToStorage();
          renderActiveRemindersBar();
        }
        update(ref(db, `events/${dateKey}/${id}`), remPayload).catch(() => {});
        triggerReminderAlert({ id, dateKey, ev });
      }
    });
  });

  try {
    checkDailySummaryDue();
  } catch (e) {
    console.warn("checkDailySummaryDue error", e);
  }
}

function openQuickReminderModal(task) {
  const modal = el("reminderModal");
  if (!modal || !task) return;

  getSharedAudioCtx();

  const id = task._id || task.id;
  const dateKey = task.dateKey || dateKeyFromDate(state.currentDate);

  el("reminderModalItemTitle").textContent = `${task.title || "(ללא כותרת)"}${task.startTime ? " • " + task.startTime : ""}`;
  el("quickReminderMinutes").value = "";
  el("quickReminderDate").value = task.reminderDate || (dateKey !== "undated" ? dateKey : dateKeyFromDate(new Date()));
  el("quickReminderTime").value = task.reminderTime || "";

  modal.classList.remove("hidden");

  qsa("[data-close-reminder]", modal).forEach((b) => {
    b.onclick = () => modal.classList.add("hidden");
  });

  const saveReminderFields = async (fields, toastMsg, directTargetTs) => {
    getSharedAudioCtx();
    playConfirmTick();

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const clearRem = getClearRemindedPayload();
    if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
    if (state.cache.events[dateKey][id]) {
      Object.assign(state.cache.events[dateKey][id], fields, clearRem);
    }

    const updatedEv = state.cache.events[dateKey]?.[id] || { ...task, ...fields };
    const effectiveTs = directTargetTs || getEventReminderTimestamp(updatedEv, dateKey);

    if (effectiveTs && effectiveTs > Date.now()) {
      scheduleDirectReminder({
        id,
        dateKey,
        ev: updatedEv,
        targetTs: effectiveTs
      });
    } else if (fields.reminderCustomTs === null && fields.reminderMinutes === null && fields.reminderTime === null) {
      cancelDirectReminder(`${dateKey}/${id}`);
    }

    modal.classList.add("hidden");
    showToast(toastMsg || "🔔 תזכורת נשמרה", 3500);
    renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden")) {
      renderDayEvents(dateKey);
    }
    await update(ref(db, `events/${dateKey}/${id}`), {
      ...fields,
      ...clearRem
    });
  };

  qsa("[data-quick-rem]", modal).forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.quickRem;
      if (mode === "now") {
        modal.classList.add("hidden");
        triggerReminderAlert({ id, dateKey, ev: task });
        return;
      }
      if (mode === "sec10") {
        const targetTs = Date.now() + 10 * 1000;
        const dt = new Date(targetTs);
        saveReminderFields({
          reminderCustomTs: targetTs,
          reminderDate: dateKeyFromDate(dt),
          reminderTime: formatTimeHM(dt),
          reminderMinutes: null
        }, "🔔 התראה תופעל בעוד 10 שניות!", targetTs);
        return;
      }
      if (mode.startsWith("in")) {
        const addMins = Number(mode.replace("in", ""));
        const targetTs = Date.now() + addMins * 60000;
        const dt = new Date(targetTs);
        saveReminderFields({
          reminderCustomTs: targetTs,
          reminderDate: dateKeyFromDate(dt),
          reminderTime: formatTimeHM(dt),
          reminderMinutes: null
        }, `🔔 תזכורת בעוד ${addMins} דק׳ (ראה ספירה לאחור למעלה)`, targetTs);
      } else if (mode.startsWith("before")) {
        const beforeMins = Number(mode.replace("before", ""));
        let calcTs = null;
        if (task.startTime && dateKey && dateKey !== "undated") {
          const [h, m] = task.startTime.split(":").map(Number);
          const d = parseDateKey(dateKey);
          d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
          calcTs = d.getTime() - beforeMins * 60000;
        }
        // אם שעת ההתחלה של האירוע היום כבר עברה, נתזכר בעוד beforeMins דקות מעכשיו!
        if (!calcTs || calcTs <= Date.now()) {
          const fallbackMins = beforeMins > 0 ? beforeMins : 1;
          const targetTs = Date.now() + fallbackMins * 60000;
          const dt = new Date(targetTs);
          saveReminderFields({
            reminderCustomTs: targetTs,
            reminderDate: dateKeyFromDate(dt),
            reminderTime: formatTimeHM(dt),
            reminderMinutes: beforeMins
          }, `🔔 שעת האירוע חלפה – תזכורת הוגדרה לעוד ${fallbackMins} דק׳ מעכשיו!`, targetTs);
        } else {
          saveReminderFields({
            reminderMinutes: beforeMins,
            reminderCustomTs: calcTs,
            reminderDate: dateKey,
            reminderTime: formatTimeHM(new Date(calcTs))
          }, `🔔 תזכורת ${beforeMins === 0 ? "בזמן האירוע" : beforeMins + " דק׳ לפני"}`, calcTs);
        }
      }
    };
  });

  el("btnSaveQuickReminder").onclick = () => {
    const minsVal = el("quickReminderMinutes").value.trim();
    const dateVal = el("quickReminderDate").value;
    const timeVal = el("quickReminderTime").value;

    // אם המשתמש הזין מספר דקות בתיבת "הזכר לי בעוד X דקות מעכשיו" -> תמיד בעוד X דקות מעכשיו!
    if (minsVal !== "") {
      const mNum = Number(minsVal);
      if (!Number.isNaN(mNum) && mNum > 0) {
        const targetTs = Date.now() + mNum * 60000;
        const dt = new Date(targetTs);
        saveReminderFields({
          reminderMinutes: mNum,
          reminderCustomTs: targetTs,
          reminderDate: dateKeyFromDate(dt),
          reminderTime: formatTimeHM(dt)
        }, `🔔 תזכורת בעוד ${mNum} דק׳ (ספירה לאחור פעילה למעלה)`, targetTs);
        return;
      }
    }

    if (timeVal) {
      const baseDk = dateVal || (dateKey !== "undated" ? dateKey : dateKeyFromDate(new Date()));
      const dObj = parseDateKey(baseDk);
      const [h, m] = timeVal.split(":").map(Number);
      dObj.setHours(h || 0, m || 0, 0, 0);
      let targetTs = dObj.getTime();
      // אם בחר את השעה של הדקה הנוכחית שרק התחילה, נתזכר בעוד 10 שניות
      if (targetTs <= Date.now() && Date.now() - targetTs < 60000) {
        targetTs = Date.now() + 10000;
      }
      saveReminderFields({
        reminderCustomTs: targetTs,
        reminderDate: baseDk,
        reminderTime: timeVal,
        reminderMinutes: null
      }, `🔔 תזכורת הוגדרה ל-${timeVal}`, targetTs);
    } else {
      showToast("בחר זמן לתזכורת או הזן דקות מעכשיו");
    }
  };

  el("btnClearQuickReminder").onclick = () => {
    saveReminderFields({
      reminderMinutes: null,
      reminderCustomTs: null,
      reminderDate: null,
      reminderTime: null
    }, "🔕 התזכורת בוטלה", null);
  };
}

// =========================
// Gihari
// =========================
function initGihari() {
  el("btnGihari").onclick = () => openGihariModal();
  el("btnGihariSuggestNow").onclick = () => gihariSuggestNow();
  el("btnGihariPlaceTasks").onclick = () => gihariPlaceUndatedTasks();
}

function openGihariModal() {
  const modal = el("gihariModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
  qs(".modal-backdrop", modal)?.addEventListener("click", () => modal.classList.add("hidden"));

  const summaryEl = el("gihariSummary");
  const { dailyLoadMinutes, freeSlots } = computeLoadAndFreeSlots(new Date());
  const loadLabel = dailyLoadMinutes < 180 ? "יום קל" : dailyLoadMinutes < 360 ? "יום בינוני" : "יום עמוס";

  summaryEl.innerHTML =
    `<p>עומס יומי: <strong>${Math.round(dailyLoadMinutes / 60)} שעות</strong></p>` +
    `<p>זמני עומס: <strong>${loadLabel}</strong></p>` +
    `<p>חלונות פנויים: <strong>${freeSlots.length}</strong></p>`;

  el("gihariLog").innerHTML = "";

  const micBtn = el("gihariMicBtn");
  if (micBtn) {
    micBtn.onclick = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { alert("הדפדפן לא תומך בזיהוי דיבור"); return; }
      const rec = new SR();
      rec.lang = "he-IL";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.start();

      micBtn.disabled = true;
      micBtn.textContent = "מקשיב...";

      rec.onresult = (e) => {
        micBtn.disabled = false;
        micBtn.textContent = "🎤 דבר";
        const text = (e.results[0][0].transcript || "").trim();
        handleGihariVoiceCommand(text);
      };
      rec.onerror = () => { micBtn.disabled = false; micBtn.textContent = "🎤 דבר"; };
      rec.onend   = () => { micBtn.disabled = false; micBtn.textContent = "🎤 דבר"; };
    };
  }
}

function appendGihariLog(html) {
  const enhanced = wrapGihariHumor(html);
  const log = el("gihariLog");
  const msg = document.createElement("div");
  msg.className = "gihari-msg";
  msg.innerHTML = enhanced;
  log.appendChild(msg);

  let plain = enhanced.replace(/<[^>]+>/g, "");
  plain = plain.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  gihariSpeak(plain);
}

function logGihariCommand(text) {
  try {
    const newRef = push(ref(db, "gihariLogs"));
    set(newRef, { text, ts: Date.now() });
  } catch (e) {
    console.warn("failed to log gihari command", e);
  }
}

function computeLoadAndFreeSlots(date) {
  const dateKey = dateKeyFromDate(date);
  const events = state.cache.events[dateKey] || {};
  const busySegments = [];

  Object.values(events).forEach((ev) => {
    if (ev.owner && ev.owner !== state.currentUser && ev.owner !== "shared") return;
    if (!ev.startTime || !ev.endTime) return;
    const [sh, sm] = ev.startTime.split(":").map(Number);
    const [eh, em] = ev.endTime.split(":").map(Number);
    busySegments.push([sh * 60 + sm, eh * 60 + em]);
  });

  busySegments.sort((a, b) => a[0] - b[0]);

  const merged = [];
  busySegments.forEach((seg) => {
    if (!merged.length) merged.push(seg);
    else {
      const last = merged[merged.length - 1];
      if (seg[0] <= last[1]) last[1] = Math.max(last[1], seg[1]);
      else merged.push(seg);
    }
  });

  let totalBusy = 0;
  merged.forEach((seg) => (totalBusy += seg[1] - seg[0]));

  const freeSlots = [];
  const dayStart = 8 * 60;
  const dayEnd = 22 * 60;
  let cursor = dayStart;
  merged.forEach((seg) => {
    if (seg[0] - cursor >= 30) freeSlots.push([cursor, seg[0]]);
    cursor = Math.max(cursor, seg[1]);
  });
  if (dayEnd - cursor >= 30) freeSlots.push([cursor, dayEnd]);

  return { dailyLoadMinutes: totalBusy, freeSlots };
}

function gihariSuggestNow() {
  const now = new Date();
  const dateKey = dateKeyFromDate(now);
  const tasksToday = [];

  const items = state.cache.events[dateKey] || {};
  Object.entries(items).forEach(([id, ev]) => {
    if (ev.type !== "task") return;
    tasksToday.push({ id, dateKey, ...ev });
  });

  if (!tasksToday.length) {
    appendGihariLog("אין משימות להיום. תהנה מהזמן הפנוי שלך 🙌");
    return;
  }

  const urgencyScore = { today: 3, week: 2, month: 1, none: 0 };
  tasksToday.sort((a, b) => (urgencyScore[b.urgency] || 0) - (urgencyScore[a.urgency] || 0));

  const top = tasksToday[0];
  appendGihariLog(`<p>משימה הבאה: <strong>${top.title}</strong>.</p>`);
}

function gihariPlaceUndatedTasks() {
  const undatedTasks = [];
  Object.entries(state.cache.events).forEach(([dk, items]) => {
    Object.entries(items || {}).forEach(([id, ev]) => {
      if (ev.type !== "task") return;

      
      if (ev.dateKey && ev.dateKey !== "undated") return;
      undatedTasks.push({ id, dateKey: dk, ...ev });
    });
  });

  if (!undatedTasks.length) {
    appendGihariLog("אין משימות ללא תאריך לשיבוץ. 😌");
    return;
  }

  const today = new Date();
  const maxDaysAhead = 14;

  undatedTasks.forEach((task) => {
    const daysToSearch =
      task.urgency === "today" ? 0 :
      task.urgency === "week" ? 7 :
      task.urgency === "month" ? 14 : maxDaysAhead;

    let placed = false;
    for (let offset = 0; offset <= daysToSearch; offset++) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      const { freeSlots } = computeLoadAndFreeSlots(d);
      const duration = task.duration || 30;

      const suitableSlot = freeSlots.find(([start, end]) => end - start >= duration);
      if (!suitableSlot) continue;

      const startMinutes = suitableSlot[0];
      const startH = String(Math.floor(startMinutes / 60)).padStart(2, "0");
      const startM = String(startMinutes % 60).padStart(2, "0");
      const endMinutes = startMinutes + duration;
      const endH = String(Math.floor(endMinutes / 60)).padStart(2, "0");
      const endM = String(endMinutes % 60).padStart(2, "0");

      const newDk = dateKeyFromDate(d);
      const newRef = push(ref(db, `events/${newDk}`));

      set(newRef, { ...task, dateKey: newDk, startTime: `${startH}:${startM}`, endTime: `${endH}:${endM}`, _id: newRef.key });

      appendGihariLog(`<strong>${task.title}</strong> שובץ ${newDk} בשעה ${startH}:${startM}.`);
      placed = true;
      break;
    }
    if (!placed) appendGihariLog(`לא נמצא חלון זמן מתאים למשימה <strong>${task.title}</strong>.`);
  });
}

// =========================
// =========================
// Stats engine
// =========================

function moveTaskToDate(task, newDateKey) {
  const id = task._id || task.id;
  if (!id || !task.dateKey || !newDateKey) return;

  const oldRef = ref(db, `events/${task.dateKey}/${id}`);
  const newRef = ref(db, `events/${newDateKey}/${id}`);

  // מעתיק לתאריך חדש
  set(newRef, {
    ...task,
    dateKey: newDateKey
  });

  // מוחק מהישן
  remove(oldRef);

  showToast("המשימה נדחתה");
}

const ROUTINE_STAT_TITLES = [
  "שינה",
  "התארגנות",
  "נסיעות",
  "נסיעה לעבודה",
  "נסיעה לבית",
  "עבודה",
  "אוכל ומקלחות",
  "אוכל ומקלחת",
  "אוכל + מקלחת",
  "זמן פנוי"
];

const SMART_EVENT_DOMAINS = [
  {
    category: "SELS",
    keywords: ["sels"]
  },
  {
    category: "פגישות",
    keywords: [
      "לדבר עם", "לדבר ", "להתקשר", "טלפון", "שיחה", "שיחת", "פגישה", "פגישת",
      "להיפגש", "זום", "zoom", "ראיון", "דיון", "ייעוץ", "לחזור ל", "לצלצל", "ווצאפ"
    ]
  },
  {
    category: "תחזוקת בית",
    keywords: [
      "לנקות", "ניקיון", "ניקוי", "מקרר", "כביסה", "כלים", "לסדר", "סידור",
      "שטיפה", "לשטוף", "אבק", "זבל", "אשפה", "קניות", "סופר", "ללכת לקניות",
      "לבשל", "בישול", "אפייה", "לאפות", "תיקון", "לתקן", "גינה", "קניית",
      "מצעים", "גיהוץ", "לגהץ", "מטבח", "סלון", "ארון"
    ]
  },
  {
    category: "כושר ובריאות",
    keywords: [
      "אימון", "חדר כושר", "כושר", "ריצה", "לרוץ", "הליכה", "ספורט", "יוגה",
      "פילאטיס", "שחייה", "רופא", "מרפאה", "בדיקה", "תור ל", "שיניים", "פיזיותרפיה",
      "תרופות", "בית מרקחת", "כדורגל", "טניס"
    ]
  },
  {
    category: "לימודים והתפתחות",
    keywords: [
      "ללמוד", "לימודים", "קורס", "שיעור", "מבחן", "לקרוא", "קריאה", "ספר",
      "תרגול", "הרצאה", "מחקר", "עבודה על"
    ]
  },
  {
    category: "זוגיות ובילוי",
    keywords: [
      "דייט", "מסעדה", "סרט", "טיול", "מסיבה", "חברים", "משפחה", "הורים",
      "בית קפה", "קפה עם", "הופעה", "חופשה", "אירוח", "באולינג", "בילוי"
    ]
  },
  {
    category: "כספים ובירוקרטיה",
    keywords: [
      "בנק", "תשלום", "לשלם", "חשבון", "חשבונות", "ארנונה", "חשמל", "מים",
      "ביטוח", "רואה חשבון", "דואר", "טפסים", "משכנתא", "חוזה", "עירייה"
    ]
  },
  {
    category: "נסיעות ורכב",
    keywords: [
      "נסיעה", "לנסוע", "להסיע", "איסוף", "לאסוף", "מוסך", "טסט", "דלק",
      "לתדלק", "שטיפת רכב", "רכבת", "אוטובוס"
    ]
  }
];

function isRoutineStatEvent(ev) {
  if (!ev) return false;
  if (isDefaultEvent(ev)) return true;
  const t = (ev.title || "").trim();
  return ROUTINE_STAT_TITLES.includes(t);
}

function normalizeStatCategoryTitle(rawTitle) {
  const t = (rawTitle || "").trim();
  if (!t) return "משימה";
  if (/sels/i.test(t)) {
    return "SELS";
  }
  if (t === "אוכל + מקלחת" || t === "אוכל ומקלחת" || t === "אוכל ומקלחות" || t === "אוכל" || t === "מקלחת") {
    return "אוכל ומקלחות";
  }
  if (t === "נסיעה לעבודה" || t === "נסיעה לבית" || t === "נסיעות") {
    return "נסיעות";
  }
  return t;
}

function formatStatCategoryDisplay(catLabel) {
  if (catLabel === "SELS") return "🛗 SELS";
  return catLabel;
}

function detectSmartDomainCategory(rawTitle) {
  if (/sels/i.test(String(rawTitle || ""))) return "SELS";
  const clean = normalizeStatCategoryTitle(rawTitle);
  if (ROUTINE_STAT_TITLES.includes(clean)) return clean;
  const lower = clean.toLowerCase();
  for (const dom of SMART_EVENT_DOMAINS) {
    if (dom.keywords.some((kw) => lower.includes(kw))) {
      return dom.category;
    }
  }
  return null;
}

function buildSmartTitleResolver(allCompletedRawTitles) {
  // סופרים מילים ראשונות עבור אירועים שלא התאימו לקטגוריה מובנית, כדי למצוא מכנה משותף
  const STOP_WORDS = new Set(["את", "של", "עם", "על", "אל", "או", "גם", "כל", "זה"]);
  const firstWordCounts = {};

  allCompletedRawTitles.forEach((raw) => {
    const clean = normalizeStatCategoryTitle(raw);
    if (ROUTINE_STAT_TITLES.includes(clean)) return;
    if (detectSmartDomainCategory(clean)) return;
    const firstWord = clean.split(/\s+/)[0] || "";
    if (firstWord.length >= 3 && !STOP_WORDS.has(firstWord)) {
      firstWordCounts[firstWord] = (firstWordCounts[firstWord] || 0) + 1;
    }
  });

  return (rawTitle) => {
    const clean = normalizeStatCategoryTitle(rawTitle);
    if (ROUTINE_STAT_TITLES.includes(clean)) return clean;

    const domainCat = detectSmartDomainCategory(clean);
    if (domainCat) return domainCat;

    const firstWord = clean.split(/\s+/)[0] || "";
    if (firstWord.length >= 3 && (firstWordCounts[firstWord] || 0) >= 2) {
      return firstWord;
    }

    // אם אין מכנה משותף עם שום אירוע אחר – מוצג בנפרד בשמו המלא!
    return clean;
  };
}

function isEventRelevantForUser(ev, user) {
  if (!ev) return false;
  const owner = ev.owner || "shared";
  if (owner === "shared") return true;
  return owner === user;
}

function getEffectiveDurationMinutes(ev) {
  if (!ev) return 60;
  if (ev.startTime && ev.endTime) {
    const s = timeToMinutes(ev.startTime);
    const e = timeToMinutes(ev.endTime);
    if (e > s) return e - s;
  }
  if (ev.duration && Number(ev.duration) > 0) {
    return Number(ev.duration);
  }
  return 60; // ברירת מחדל: שעה אחת (60 דקות)
}

function getStatsDates(range) {
  const fromInput = el("completedFromDate");
  const toInput = el("completedToDate");

  if (fromInput && toInput && (!fromInput.value || !toInput.value)) {
    statsApplyPresetDates(range || state.statsRange || "day", true);
  }

  const fromVal = fromInput?.value;
  const toVal = toInput?.value;

  if (fromVal && toVal) {
    const start = parseDateKey(fromVal);
    const end = parseDateKey(toVal);
    start.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);
    if (start <= end) {
      const dates = [];
      const cur = new Date(start);
      let safety = 0;
      while (cur <= end && safety < 1500) {
        dates.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
        safety++;
      }
      if (dates.length > 0) return dates;
    }
  }

  // Fallback calculation if inputs are missing
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const dates = [];

  if (range === "day") {
    dates.push(new Date(now));
  } else if (range === "week") {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      dates.push(d);
    }
  } else if (range === "2weeks") {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      dates.push(d);
    }
  } else if (range === "month") {
    const y = now.getFullYear();
    const m = now.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      dates.push(new Date(y, m, d, 12, 0, 0, 0));
    }
  } else if (range === "year") {
    const y = now.getFullYear();
    for (let m = 0; m < 12; m++) {
      const days = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        dates.push(new Date(y, m, d, 12, 0, 0, 0));
      }
    }
  } else {
    dates.push(new Date(now));
  }

  return dates;
}

function computeStatsForDatesList(dates, user) {
  const totalDays = Math.max(1, dates.length);
  const totalHours = totalDays * 24;

  let sleepMinutes = 0;
  let prepMinutes = 0;
  let travelMinutes = 0;
  let workMinutes = 0;
  let foodShowerMinutes = 0;
  let freeMinutes = 0;
  const otherMap = {};
  const categoryBreakdown = {};

  const undatedEvents = state.cache.events?.["undated"] || {};

  // שלב 1: איסוף כל הכותרות של אירועים/משימות שבוצעו בטווח לצורך זיהוי מכנה משותף חכם
  const allCompletedTitles = [];
  dates.forEach((date) => {
    const dk = dateKeyFromDate(date);
    const dayEventsObj = state.cache.events?.[dk] || {};
    Object.values(dayEventsObj).forEach((ev) => {
      if (!ev || isDefaultEvent(ev) || !isEventRelevantForUser(ev, user)) return;
      if (!isRoutineStatEvent(ev) && !ev.completed && !ev.completedAt) return;
      allCompletedTitles.push(ev.title || "");
    });
  });
  Object.values(undatedEvents).forEach((ev) => {
    if (!ev || (!ev.completed && !ev.completedAt) || !isEventRelevantForUser(ev, user)) return;
    allCompletedTitles.push(ev.title || "");
  });

  const resolveCategory = buildSmartTitleResolver(allCompletedTitles);

  const addBreakdownItem = (catLabel, ev, durMins, isAutoRoutine = false) => {
    if (!categoryBreakdown[catLabel]) categoryBreakdown[catLabel] = [];
    categoryBreakdown[catLabel].push({
      _id: ev._id || ev.id,
      title: ev.title || "(ללא כותרת)",
      dateKey: ev.dateKey || "undated",
      startTime: ev.startTime || null,
      endTime: ev.endTime || null,
      owner: ev.owner || "shared",
      type: ev.type || "event",
      effectiveDuration: durMins,
      isAutoRoutine
    });
  };

  dates.forEach((date) => {
    const dk = dateKeyFromDate(date);
    const day = date.getDay();
    const dayTimeline = new Array(1440).fill("זמן פנוי");

    const isNanaTuesdayOff = user === "nana" && day === 2;
    if (isNanaTuesdayOff) {
      // ביום שלישי ההגדרות הקבועות הן של בנימין בלבד; לננה שינה 00:00-07:00 ושאר היום זמן פנוי
      for (let m = 0; m < 420; m++) dayTimeline[m] = "שינה";
      addBreakdownItem("שינה", { _id: "def_sleep", title: "שינה", dateKey: dk, startTime: "00:00", endTime: "07:00", owner: "nana", type: "event" }, 420, true);
    } else {
      const routineSpecs = getDailyRoutineSpecsForDay(day);
      routineSpecs.forEach((spec) => {
        if (spec.owner === "binyamin" && user !== "binyamin") return;
        const sMin = Math.max(0, Math.min(1439, timeToMinutes(spec.startTime)));
        const eMin = Math.max(sMin + 1, Math.min(1440, timeToMinutes(spec.endTime)));
        const cat = spec.statCategory || normalizeStatCategoryTitle(spec.title);
        for (let m = sMin; m < eMin; m++) {
          dayTimeline[m] = cat;
        }
        addBreakdownItem(
          cat,
          {
            _id: spec.key,
            title: spec.title,
            dateKey: dk,
            startTime: spec.startTime,
            endTime: spec.endTime,
            owner: spec.owner,
            type: "event"
          },
          eMin - sMin,
          true
        );
      });
    }

    const dayEventsObj = state.cache.events?.[dk] || {};
    const dayItems = Object.entries(dayEventsObj).map(([id, ev]) => ({
      ...ev,
      _id: ev._id || id,
      dateKey: dk
    }));

    // הוספת משימות ללא תאריך שסומנו כבוצעו ביום זה
    Object.entries(undatedEvents).forEach(([id, ev]) => {
      if (!ev || (!ev.completed && !ev.completedAt)) return;
      if (ev.completedAt) {
        const compDk = dateKeyFromDate(new Date(ev.completedAt));
        if (compDk === dk) {
          dayItems.push({ ...ev, _id: ev._id || id, dateKey: "undated" });
        }
      }
    });

    const seen = new Set();
    const untimedCompleted = [];
    const userGoalsList = Object.values(state.goals?.[user] || {}).filter((g) => g && g.title);

    dayItems.forEach((ev) => {
      if (!ev) return;
      if (!isEventRelevantForUser(ev, user)) return;
      if (isDefaultEvent(ev)) return;

      const isRoutine = isRoutineStatEvent(ev);
      const isDone = Boolean(ev.completed || ev.completedAt);

      // רק משימות ואירועים שסומנו כבוצעו נכנסים לעוגה (למעט אירועי שגרה)
      if (!isRoutine && !isDone) return;

      const rawClean = normalizeStatCategoryTitle(ev.title);
      let matchedGoalTitle = ev.goalTitle || null;
      if (!matchedGoalTitle && userGoalsList.length > 0 && typeof doesItemMatchGoal === "function") {
        const foundGoal = userGoalsList.find((g) => doesItemMatchGoal(ev, g.title));
        if (foundGoal) matchedGoalTitle = foundGoal.title;
      }
      const label = isSelsEvent(ev)
        ? "SELS"
        : matchedGoalTitle
          ? normalizeStatCategoryTitle(matchedGoalTitle)
          : resolveCategory(ev.title);
      const sig = `${rawClean}|${ev.owner || "shared"}|${ev.startTime || ""}|${ev.endTime || ""}|${ev.type || ""}`;
      if (seen.has(sig)) return;
      seen.add(sig);

      let dur = getEffectiveDurationMinutes(ev);
      if (dur <= 0) dur = 60;

      if (!isRoutine) {
        addBreakdownItem(label, ev, dur, false);
      }

      if (ev.startTime) {
        const startMin = Math.max(0, Math.min(1439, timeToMinutes(ev.startTime)));
        const endMin = Math.max(startMin + 1, Math.min(1440, startMin + dur));
        for (let m = startMin; m < endMin; m++) {
          dayTimeline[m] = label;
        }
      } else {
        untimedCompleted.push({ label, dur });
      }
    });

    // משימות/אירועים שבוצעו ללא שעת התחלה מקזזים מזמן פנוי (או משאר היום אם נגמר הזמן הפנוי)
    untimedCompleted.forEach(({ label, dur }) => {
      let remaining = dur;
      const replaceOrder = ["זמן פנוי", "עבודה", "אוכל ומקלחות", "נסיעות", "התארגנות", "שינה"];
      for (const targetCat of replaceOrder) {
        if (remaining <= 0) break;
        for (let m = 1439; m >= 0 && remaining > 0; m--) {
          if (dayTimeline[m] === targetCat) {
            dayTimeline[m] = label;
            remaining--;
          }
        }
      }
    });

    for (let m = 0; m < 1440; m++) {
      const cat = dayTimeline[m];
      if (cat === "שינה") sleepMinutes++;
      else if (cat === "התארגנות") prepMinutes++;
      else if (cat === "נסיעות") travelMinutes++;
      else if (cat === "עבודה") workMinutes++;
      else if (cat === "אוכל ומקלחות" || cat === "אוכל ומקלחת") foodShowerMinutes++;
      else if (cat === "זמן פנוי") freeMinutes++;
      else otherMap[cat] = (otherMap[cat] || 0) + 1;
    }
  });

  const fromKey = dateKeyFromDate(dates[0]);
  const toKey = dateKeyFromDate(dates[dates.length - 1]);

  return {
    dates,
    fromKey,
    toKey,
    totalDays,
    totalHours,
    sleepMinutes,
    prepMinutes,
    travelMinutes,
    workMinutes,
    foodShowerMinutes,
    freeMinutes,
    otherMap,
    categoryBreakdown
  };
}

function computeStats({ user, range }) {
  const dates = getStatsDates(range);
  return computeStatsForDatesList(dates, user);
}

function computeTargetStatuses(stats) {
  const results = [];
  const weeks = Math.max(1 / 7, (stats.totalDays || 1) / 7);
  const userGoals = state.goals?.[state.currentUser] || {};

  Object.values(userGoals).forEach((g) => {
    if (!g || !g.title || !g.weeklyHours) return;

    let actualHours = 0;
    const normGoal = normalizeStatCategoryTitle(g.title);

    if (normGoal === "שינה") {
      actualHours = stats.sleepMinutes / 60;
    } else if (normGoal === "התארגנות") {
      actualHours = (stats.prepMinutes || 0) / 60;
    } else if (normGoal === "נסיעות") {
      actualHours = (stats.travelMinutes || 0) / 60;
    } else if (normGoal === "עבודה") {
      actualHours = stats.workMinutes / 60;
    } else if (normGoal === "אוכל ומקלחות" || normGoal === "אוכל ומקלחת") {
      actualHours = stats.foodShowerMinutes / 60;
    } else if (normGoal === "זמן פנוי") {
      actualHours = stats.freeMinutes / 60;
    } else {
      actualHours = (stats.otherMap[normGoal] || 0) / 60;
    }

    const target = Number((g.weeklyHours * weeks).toFixed(1));
    const diff = actualHours - target;
    const pct = target > 0 ? Math.min(100, Math.round((actualHours / target) * 100)) : 100;

    let status = "ok";
    if (diff < -0.25) status = "low";
    if (diff > 0.25) status = "high";

    results.push({
      title: g.title,
      actualHours: Number(actualHours.toFixed(1)),
      targetHours: target,
      weeklyHours: g.weeklyHours,
      pct,
      diff,
      status
    });
  });

  return results;
}

function formatShortDateHe(dk) {
  if (!dk || dk === "undated") return "ללא תאריך";
  const parts = String(dk).split("-");
  if (parts.length !== 3) return String(dk);
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDateHeShort(dk) {
  return formatShortDateHe(dk);
}

function dateFromKey(dk) {
  if (!dk || dk === "undated") return new Date();
  return parseDateKey(dk);
}

function formatMinutesReadable(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return "0 דק׳";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} דק׳`;
  if (rem === 0) return `${h} ש׳`;
  return `${h} ש׳ ו-${rem} דק׳`;
}

function formatHoursClean(hours) {
  const rounded = Math.round(hours * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function getCategorizedStatsItems(dates, user) {
  const completedEvents = [];
  const completedTasks = [];
  const missedEvents = [];
  const missedTasks = [];

  if (!dates || !dates.length) {
    return { completedEvents, completedTasks, missedEvents, missedTasks };
  }

  const now = new Date();
  const todayKey = dateKeyFromDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const fromKey = dateKeyFromDate(dates[0]);
  const toKey = dateKeyFromDate(dates[dates.length - 1]);
  const fromTs = parseDateKey(fromKey).setHours(0, 0, 0, 0);
  const toTs = parseDateKey(toKey).setHours(23, 59, 59, 999);

  const seenIds = new Set();

  dates.forEach((date) => {
    const dk = dateKeyFromDate(date);
    const dayEvents = state.cache.events?.[dk] || {};

    Object.entries(dayEvents).forEach(([id, ev]) => {
      if (!ev) return;
      if (!isEventRelevantForUser(ev, user)) return;
      if (isRoutineStatEvent(ev)) return;

      // אם זה אב של סדרה חוזרת ויש לו מופע באותו יום (או שהיום הוחרג), נדלג על האב כדי לא לספור פעמיים
      if (shouldHideRecurringParentOnDate(ev, id, dk, dayEvents)) {
        return;
      }

      const uniqueKey = `${dk}|${id}`;
      if (seenIds.has(uniqueKey)) return;
      seenIds.add(uniqueKey);

      const item = {
        ...ev,
        _id: ev._id || id,
        dateKey: dk,
        effectiveDuration: getEffectiveDurationMinutes(ev)
      };

      const isDone = Boolean(ev.completed || ev.completedAt);
      const isTask = ev.type === "task";

      if (isDone) {
        if (isTask) completedTasks.push(item);
        else completedEvents.push(item);
      } else {
        // בדיקה אם האירוע/משימה כבר חלפו ללא ביצוע
        let hasPassed = false;
        if (dk < todayKey) {
          hasPassed = true;
        } else if (dk === todayKey) {
          if (ev.startTime) {
            const startMin = timeToMinutes(ev.startTime);
            const endMin = ev.endTime
              ? timeToMinutes(ev.endTime)
              : startMin + getEffectiveDurationMinutes(ev);
            hasPassed = endMin <= nowMinutes || startMin <= nowMinutes;
          } else {
            hasPassed = true;
          }
        }

        if (hasPassed) {
          if (isTask) missedTasks.push(item);
          else missedEvents.push(item);
        }
      }
    });
  });

  // משימות ללא תאריך ("undated") של המשתמש
  const undatedEvents = state.cache.events?.["undated"] || {};
  Object.entries(undatedEvents).forEach(([id, ev]) => {
    if (!ev) return;
    if (!isEventRelevantForUser(ev, user)) return;
    if (isRoutineStatEvent(ev)) return;

    const isDone = Boolean(ev.completed || ev.completedAt);
    const isTask = (ev.type || "task") === "task";
    const item = {
      ...ev,
      _id: ev._id || id,
      dateKey: "undated",
      effectiveDuration: getEffectiveDurationMinutes(ev)
    };

    if (isDone) {
      const compTs = ev.completedAt || 0;
      if (!compTs || (compTs >= fromTs && compTs <= toTs)) {
        if (isTask) completedTasks.push(item);
        else completedEvents.push(item);
      }
    }
  });

  const sortByDateAndTime = (a, b) => {
    const da = a.dateKey || "";
    const db = b.dateKey || "";
    if (da !== db) return db.localeCompare(da);
    return compareEventsByTimeAndContainment(a, b);
  };

  completedEvents.sort(sortByDateAndTime);
  completedTasks.sort(sortByDateAndTime);
  missedEvents.sort(sortByDateAndTime);
  missedTasks.sort(sortByDateAndTime);

  return {
    completedEvents,
    completedTasks,
    missedEvents,
    missedTasks
  };
}

function openStatCategoryBreakdown(categoryLabel) {
  const modal = el("statCategoryBreakdownModal");
  if (!modal) return;

  const titleEl = el("statCategoryBreakdownTitle");
  const subEl = el("statCategoryBreakdownSub");
  const listEl = el("statCategoryBreakdownList");

  const items = state.cache.lastStatsBreakdown?.[categoryLabel] || [];
  const totalMins = items.reduce((acc, it) => acc + (Number(it.effectiveDuration) || 60), 0);
  const totalHours = formatHoursClean(totalMins / 60);

  if (titleEl) titleEl.textContent = `📊 פירוט קטגוריה: ${formatStatCategoryDisplay(categoryLabel)}`;
  if (subEl) {
    if (ROUTINE_STAT_TITLES.includes(categoryLabel)) {
      subEl.textContent = `קטגוריית שגרה אוטומטית מתוך 24 שעות היממה`;
    } else {
      subEl.textContent = `${items.length} פריטים שבוצעו בקטגוריה זו • סה״כ ${totalHours} שעות`;
    }
  }

  const ownerLabel = (owner) =>
    owner === "shared" ? "משותף 👥" : owner === "nana" ? "נוי 💖" : "בנימין 💙";

  if (listEl) {
    if (!items.length) {
      listEl.innerHTML = `<div class="stats-empty-tab">זוהי קטגוריית בסיס יומית (ללא משימות ידניות נוספות).</div>`;
    } else {
      listEl.innerHTML = items
        .map((i) => {
          const durHours = formatHoursClean((i.effectiveDuration || 60) / 60);
          const timeStr =
            i.startTime && i.endTime
              ? `🕒 ${i.startTime}–${i.endTime} (${durHours} ש׳)`
              : `🕒 משך: ${durHours} ש׳`;
          const safeId = String(i._id || "").replace(/'/g, "\\'");
          const safeDk = String(i.dateKey || "").replace(/'/g, "\\'");

          return `
            <div class="stat-card stat-card-done">
              <div class="stat-card-top">
                <div class="stat-title">${i.title}</div>
                <span class="stat-owner-badge">${ownerLabel(i.owner)}</span>
              </div>
              <div class="stat-card-meta-row">
                <span>📅 ${formatShortDateHe(i.dateKey)}</span>
                <span>${timeStr}</span>
              </div>
              <div class="stat-card-actions">
                ${i.isAutoRoutine
                  ? `<span class="routine-auto-tag">✔ מבוצע אוטומטית (סדר יום קבוע)</span>`
                  : `<button type="button" class="ghost-pill small"
                      onclick="toggleTaskDone({ _id: '${safeId}', dateKey: '${safeDk}', completed: true }); document.getElementById('statCategoryBreakdownModal').classList.add('hidden');">
                      ↩ בטל בוצע
                    </button>`
                }
              </div>
            </div>
          `;
        })
        .join("");
    }
  }

  modal.classList.remove("hidden");
  qsa("[data-close-cat-breakdown]", modal).forEach((b) => {
    b.onclick = () => modal.classList.add("hidden");
  });
}

function renderStatsInsightsBar(stats, categorized) {
  const bar = el("statsInsightsBar");
  if (!bar) return;

  const doneCount = categorized.completedEvents.length + categorized.completedTasks.length;
  const missedCount = categorized.missedEvents.length + categorized.missedTasks.length;
  const totalActionable = doneCount + missedCount;
  const scorePct = totalActionable > 0 ? Math.round((doneCount / totalActionable) * 100) : 100;

  // חישוב השוואה חכמה מול התקופה הקודמת באותו אורך ימים
  const prevDates = [];
  if (stats.dates && stats.dates.length) {
    const firstDate = new Date(stats.dates[0]);
    for (let i = stats.totalDays; i >= 1; i--) {
      const d = new Date(firstDate);
      d.setDate(firstDate.getDate() - i);
      prevDates.push(d);
    }
  }

  let trendText = "";
  if (prevDates.length) {
    const prevStats = computeStatsForDatesList(prevDates, state.currentUser);
    const prevCat = getCategorizedStatsItems(prevDates, state.currentUser);
    const prevDone = prevCat.completedEvents.length + prevCat.completedTasks.length;

    const curTaskMins = Object.values(stats.otherMap).reduce((a, b) => a + b, 0);
    const prevTaskMins = Object.values(prevStats.otherMap).reduce((a, b) => a + b, 0);
    const diffTaskHours = (curTaskMins - prevTaskMins) / 60;
    const diffFreeHours = (stats.freeMinutes - prevStats.freeMinutes) / 60;

    const periodWordMap = {
      day: "אתמול",
      yesterday: "שלשום",
      week: "השבוע שלפני",
      lastweek: "השבוע שלפניו",
      "2weeks": "השבועיים שלפני",
      month: "התקופה המקבילה הקודמת",
      lastmonth: "החודש שלפניו",
      year: "השנה הקודמת"
    };
    const periodWord = periodWordMap[state.statsRange] || "התקופה הקודמת";

    if (Math.abs(diffTaskHours) >= 0.5) {
      const moreOrLess = diffTaskHours > 0 ? "יותר" : "פחות";
      trendText = `📈 מול ${periodWord}: השקעת ${formatHoursClean(Math.abs(diffTaskHours))} ש׳ ${moreOrLess} במשימות ואירועים (${doneCount} לעומת ${prevDone})`;
    } else if (Math.abs(diffFreeHours) >= 0.5) {
      const moreOrLess = diffFreeHours > 0 ? "יותר" : "פחות";
      trendText = `📈 מול ${periodWord}: היו לך ${formatHoursClean(Math.abs(diffFreeHours))} ש׳ ${moreOrLess} זמן פנוי`;
    } else {
      trendText = `📈 מול ${periodWord}: קצב יציב ומאוזן (${doneCount} משימות ואירועים שבוצעו)`;
    }
  }

  bar.innerHTML = `
    <div class="stats-insight-row">
      <div class="stats-score-badge">
        <span>🔥 ציון עמידה ביעדים: <strong>${scorePct}%</strong></span>
        <span class="stats-score-sub">(${doneCount} בוצעו מתוך ${totalActionable})</span>
      </div>
      <div class="stats-score-bar-track">
        <div class="stats-score-bar-fill" style="width:${scorePct}%"></div>
      </div>
      ${trendText ? `<div class="stats-trend-line">${trendText}</div>` : ""}
    </div>
  `;
}

function updateStats() {
  const currentRange = state.statsRange || "day";
  const stats = computeStats({
    user: state.currentUser,
    range: currentRange
  });

  state.cache.lastStatsBreakdown = stats.categoryBreakdown || {};

  const categorized = getCategorizedStatsItems(stats.dates, state.currentUser);
  renderStatsInsightsBar(stats, categorized);

  const userName = state.currentUser === "nana" ? "נוי (ננה)" : "בנימין";
  const rangeInfoEl = el("statsRangeInfo");
  if (rangeInfoEl) {
    const dateLabel =
      stats.fromKey === stats.toKey
        ? formatShortDateHe(stats.fromKey)
        : `${formatShortDateHe(stats.fromKey)} – ${formatShortDateHe(stats.toKey)}`;
    rangeInfoEl.innerHTML = `
      <span>👤 סטטיסטיקה: <strong>${userName}</strong></span>
      <span>📅 ${dateLabel} (${stats.totalDays} ${stats.totalDays === 1 ? "יום" : "ימים"} • <strong>${stats.totalHours} שעות = 100%</strong>)</span>
    `;
  }

  const centerEl = el("statsChartCenter");
  if (centerEl) {
    centerEl.innerHTML = `
      <div class="stats-center-hours">${stats.totalHours} ש׳</div>
      <div class="stats-center-sub">100% (${stats.totalDays === 1 ? "יממה" : stats.totalDays + " ימים"})</div>
    `;
  }

  const canvas = el("workFreeChart");
  if (!canvas || !window.Chart) return;

  const sleepHours = stats.sleepMinutes / 60;
  const prepHours = (stats.prepMinutes || 0) / 60;
  const travelHours = (stats.travelMinutes || 0) / 60;
  const workHours = stats.workMinutes / 60;
  const foodShowerHours = stats.foodShowerMinutes / 60;
  const freeHours = stats.freeMinutes / 60;

  const otherEntries = Object.entries(stats.otherMap)
    .filter(([, mins]) => mins > 0)
    .sort((a, b) => b[1] - a[1]);

  const baseItems = [
    { label: "עבודה", hours: workHours },
    { label: "שינה", hours: sleepHours },
    { label: "זמן פנוי", hours: freeHours },
    { label: "אוכל ומקלחות", hours: foodShowerHours },
    { label: "נסיעות", hours: travelHours },
    { label: "התארגנות", hours: prepHours },
    ...otherEntries.map(([label, mins]) => ({ label, hours: mins / 60 }))
  ].filter((item) => item.hours > 0.001);

  const labels = baseItems.map((i) => i.label);
  const data = baseItems.map((i) => Number(i.hours.toFixed(2)));
  const total = data.reduce((a, b) => a + b, 0) || stats.totalHours;

  const fallbackPalette = [
    "#10b981", // ירוק אמרלד
    "#ec4899", // ורוד
    "#06b6d4", // טורקיז
    "#8b5cf6", // סגול
    "#f43f5e", // קורל
    "#eab308", // זהב
    "#14b8a6", // טיל
    "#6366f1"  // אינדיגו
  ];
  let fallbackIndex = 0;
  const colors = labels.map((l) => {
    if (GOAL_COLORS[l]) return GOAL_COLORS[l];
    const c = fallbackPalette[fallbackIndex % fallbackPalette.length];
    fallbackIndex++;
    return c;
  });

  // ---- מקרא צבעים לחיץ (פתיחת חלונית פירוט קטגוריה בלחיצה!) ----
  const legendEl = el("statsLegend");
  if (legendEl) {
    legendEl.innerHTML = labels
      .map((label, idx) => {
        const hours = baseItems[idx].hours || 0;
        const pct = total > 0 ? ((hours / total) * 100).toFixed(1) : "0.0";
        const color = colors[idx];
        const countInCat = (state.cache.lastStatsBreakdown?.[label] || []).length;
        const countBadge = countInCat > 0 ? ` <span class="cat-count-tag">(${countInCat}) 🔍</span>` : "";
        const safeLabel = label.replace(/"/g, "&quot;");
        const displayLabel = formatStatCategoryDisplay(label);
        return `
          <div class="stats-legend-item clickable-legend" data-cat-label="${safeLabel}" title="לחץ לפירוט הקטגוריה">
            <span class="stats-legend-dot" style="background:${color};"></span>
            <span class="stats-legend-text">
              <strong>${displayLabel}${countBadge}</strong>
              <span class="stats-legend-val">${formatHoursClean(hours)} ש׳ (${pct}%)</span>
            </span>
          </div>
        `;
      })
      .join("");

    legendEl.querySelectorAll(".clickable-legend").forEach((row) => {
      row.onclick = () => {
        const cat = row.dataset.catLabel;
        if (cat) openStatCategoryBreakdown(cat);
      };
    });
  }

  // ---- סיכום יעדים ומטרות שבועיות בתוך הסטטיסטיקה ----
  const summaryEl = el("statsSummary");
  if (summaryEl) {
    const targetStatuses = computeTargetStatuses(stats);
    if (!targetStatuses.length) {
      summaryEl.innerHTML = `
        <div class="stats-goals-inline-empty" onclick="document.getElementById('btnOpenGoals')?.click()">
          🎯 עדיין לא הוגדרו מטרות שבועיות לסטטיסטיקה – <strong>לחץ כאן להגדרת מטרות</strong>
        </div>
      `;
    } else {
      summaryEl.innerHTML = `
        <div class="stats-goals-inline-header" onclick="document.getElementById('btnOpenGoals')?.click()">
          <span>🎯 עמידה במטרות בטווח הנבחר (לחץ לפירוט ושיפור)</span>
          <span class="stats-goals-inline-link">ניהול מטרות ⬅️</span>
        </div>
        <div class="stats-goals-inline-grid">
          ${targetStatuses
            .map((t) => {
              const diff = Math.abs(t.diff).toFixed(1);
              const statusTxt =
                t.status === "high"
                  ? `🏆 מעל היעד (+${diff} ש׳)`
                  : t.status === "low"
                    ? `⏳ חסרות ${diff} ש׳`
                    : `✅ היעד הושג!`;
              const barColor =
                t.status === "low"
                  ? "linear-gradient(90deg,#f59e0b,#ef4444)"
                  : "linear-gradient(90deg,#10b981,#22c55e)";
              return `
                <div class="stats-goal-card-inline" onclick="document.getElementById('btnOpenGoals')?.click()">
                  <div class="stats-goal-card-top">
                    <strong>🎯 ${t.title}</strong>
                    <span class="stats-goal-card-hours">${t.actualHours} / ${t.targetHours} ש׳ (${t.pct}%)</span>
                  </div>
                  <div class="goal-progress-track" style="height:6px;margin:4px 0;">
                    <div class="goal-progress-fill" style="width:${t.pct}%;background:${barColor};"></div>
                  </div>
                  <div class="stats-goal-card-status">${statusTxt}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }
  }

  const ctx = canvas.getContext("2d");
  if (!workFreeChart) {
    workFreeChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: "rgba(15, 23, 42, 0.75)"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "66%",
        onClick: (evt, activeEls) => {
          if (activeEls && activeEls.length > 0) {
            const idx = activeEls[0].index;
            const clickedLabel = workFreeChart.data.labels[idx];
            if (clickedLabel) openStatCategoryBreakdown(clickedLabel);
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = Number(context.raw) || 0;
                const dataset = context.chart.data.datasets[0].data || [];
                const sum = dataset.reduce((a, b) => a + b, 0);
                const pct = sum > 0 ? ((val / sum) * 100).toFixed(1) : "0.0";
                return `${context.label}: ${formatHoursClean(val)} ש׳ (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } else {
    workFreeChart.data.labels = labels;
    workFreeChart.data.datasets[0].data = data;
    workFreeChart.data.datasets[0].backgroundColor = colors;
    workFreeChart.update();
  }

  renderCompletedCards(stats.dates, categorized);
}

function renderCompletedCards(datesOverride, categorizedOverride) {
  const container = el("statsCompleted");
  if (!container) return;

  const dates = datesOverride || getStatsDates(state.statsRange || "day");
  const {
    completedEvents,
    completedTasks,
    missedEvents,
    missedTasks
  } = categorizedOverride || getCategorizedStatsItems(dates, state.currentUser);

  if (!state.ui.openStatsTabs) {
    state.ui.openStatsTabs = {};
  }

  const todayKey = dateKeyFromDate(new Date());
  const ownerLabel = (owner) =>
    owner === "shared" ? "משותף 👥" : owner === "nana" ? "נוי 💖" : "בנימין 💙";

  const makeCardsHtml = (items, isCompletedList, itemTypeFilter) => {
    if (!items.length) {
      return `<div class="stats-empty-tab">אין פריטים בקטגוריה זו בטווח הנבחר</div>`;
    }
    const hasPastItems = !isCompletedList && items.some((x) => x.dateKey && x.dateKey < todayKey);
    const rolloverBarHtml = hasPastItems
      ? `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
           <button type="button" class="primary-pill small" onclick="rolloverPastUncompletedToToday('${itemTypeFilter}')">
             ⏭️ העבר הכל להיום
           </button>
         </div>`
      : "";

    return (
      rolloverBarHtml +
      items
        .map((i) => {
          const durHours = formatHoursClean((i.effectiveDuration || 60) / 60);
          const timeStr =
            i.startTime && i.endTime
              ? `🕒 ${i.startTime}–${i.endTime} (${durHours} ש׳)`
              : i.startTime
                ? `🕒 ${i.startTime} (${durHours} ש׳)`
                : `🕒 משך מחושב: ${durHours} ש׳`;
          const safeId = String(i._id || i.id || "").replace(/'/g, "\\'");
          const safeDk = String(i.dateKey || "").replace(/'/g, "\\'");

          return `
            <div class="stat-card ${isCompletedList ? "stat-card-done" : "stat-card-missed"}">
              <div class="stat-card-top">
                <div class="stat-title">${i.title || "(ללא כותרת)"}</div>
                <span class="stat-owner-badge">${ownerLabel(i.owner)}</span>
              </div>
              <div class="stat-card-meta-row">
                <span>📅 ${formatShortDateHe(i.dateKey)}</span>
                <span>${timeStr}</span>
              </div>
              <div class="stat-card-actions">
                ${isCompletedList ? "" : `
                <button type="button" class="ghost-pill small" onclick="moveItemToNextDay('${safeId}', '${safeDk}')">⏭️ ליום הבא</button>
                <button type="button" class="ghost-pill small" onclick="postponeItemById('${safeId}', '${safeDk}')">📅 דחיה</button>`}
                <button type="button" class="ghost-pill small ${isCompletedList ? "" : "stat-mark-done-btn"}"
                  onclick="toggleTaskDone({ _id: '${safeId}', dateKey: '${safeDk}', completed: ${isCompletedList ? "true" : "false"} })">
                  ${isCompletedList ? "↩ בטל בוצע" : "✔ סמן כבוצע"}
                </button>
              </div>
            </div>
          `;
        })
        .join("")
    );
  };

  const sections = [
    {
      id: "tabCompletedEvents",
      title: "אירועים שבוצעו",
      items: completedEvents,
      icon: "📅",
      isCompleted: true,
      typeFilter: "event",
      badgeClass: "stat-tab-done"
    },
    {
      id: "tabCompletedTasks",
      title: "משימות שבוצעו",
      items: completedTasks,
      icon: "✔",
      isCompleted: true,
      typeFilter: "task",
      badgeClass: "stat-tab-done"
    },
    {
      id: "tabMissedEvents",
      title: "אירועים שחלפו ללא ביצוע",
      items: missedEvents,
      icon: "⏳",
      isCompleted: false,
      typeFilter: "event",
      badgeClass: "stat-tab-missed"
    },
    {
      id: "tabMissedTasks",
      title: "משימות שחלפו ללא ביצוע",
      items: missedTasks,
      icon: "⚠️",
      isCompleted: false,
      typeFilter: "task",
      badgeClass: "stat-tab-missed"
    }
  ];

  container.innerHTML = sections
    .map((sec) => {
      const isOpen = Boolean(state.ui.openStatsTabs[sec.id]);
      return `
        <div class="completed-section ${sec.badgeClass}">
          <button type="button" class="completed-header" data-toggle-id="${sec.id}">
            <span class="completed-header-title">${sec.icon} ${sec.title}</span>
            <span class="completed-header-right">
              <span class="completed-count-pill">${sec.items.length}</span>
              <span class="completed-chevron">${isOpen ? "▲" : "▼"}</span>
            </span>
          </button>
          <div id="${sec.id}" class="completed-body ${isOpen ? "" : "hidden"}">
            <div class="cards-grid">
              ${makeCardsHtml(sec.items, sec.isCompleted, sec.typeFilter)}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".completed-header").forEach((h) => {
    h.onclick = () => {
      const id = h.dataset.toggleId;
      toggleCompletedSection(id);
    };
  });
}

function toggleCompletedSection(id) {
  const bodyEl = document.getElementById(id);
  if (!bodyEl) return;
  const isNowHidden = bodyEl.classList.toggle("hidden");
  if (!state.ui.openStatsTabs) state.ui.openStatsTabs = {};
  state.ui.openStatsTabs[id] = !isNowHidden;
  const btn = document.querySelector(`.completed-header[data-toggle-id="${id}"] .completed-chevron`);
  if (btn) btn.textContent = isNowHidden ? "▼" : "▲";
}

// ===============================
// Voice Command Handler (תמציתי)
// ===============================
async function handleGihariVoiceCommand(text) {
  logGihariCommand(text);

  if (text.includes("תוסיף לי")) {
    createEventFromGihari(text);
    return;
  }

  appendGihariLog("שמעתי, אבל לא בטוח מה לעשות. תגיד למשל: 'תוסיף לי אירוע למחר בשעה 17'.");
}

function parseCommandTargetDate(text) {
  const d = new Date();
  if (text.includes("מחרתיים")) d.setDate(d.getDate() + 2);
  else if (text.includes("מחר")) d.setDate(d.getDate() + 1);
  else if (text.includes("שבוע הבא")) d.setDate(d.getDate() + 7);

  const m = text.match(/([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{2,4})/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const yy = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return new Date(yy, mo, dd);
  }
  return d;
}

function parseCommandHour(text) {
  const mNum = text.match(/בשעה\s*([0-9]{1,2})/);
  if (!mNum) return 17;
  let h = parseInt(mNum[1], 10);
  if ((text.includes("אחר הצהריים") || text.includes("בערב")) && h < 12) h += 12;
  return h;
}

function createEventFromGihari(text) {
  const targetDate = parseCommandTargetDate(text);
  const hour = parseCommandHour(text);
  const startH = String(hour).padStart(2, "0");
  const startM = "00";
  const endHour = Math.min(hour + 2, 23);
  const endH = String(endHour).padStart(2, "0");

  let title = "אירוע";
  let address = "";
  const addIdx = text.indexOf("תוסיף לי");
  if (addIdx >= 0) {
    let after = text.slice(addIdx + "תוסיף לי".length).trim();
    const beIdx = after.indexOf(" ב");
    if (beIdx >= 0) {
      title = after.slice(0, beIdx).trim();
      address = after.slice(beIdx + 1).trim();
    } else title = after.trim();
  }

  const dk = dateKeyFromDate(targetDate);
  const newRef = push(ref(db, `events/${dk}`));
  set(newRef, {
    type: "event",
    owner: state.currentUser,
    title,
    description: "",
    dateKey: dk,
    startTime: `${startH}:${startM}`,
    endTime: `${endH}:${startM}`,
    duration: (endHour - hour) * 60,
    address,
    urgency: "none",
    recurring: "none",
    _id: newRef.key
  });

  appendGihariLog(`קבעתי לך אירוע <strong>${title}</strong> ב-${dk} בשעה ${startH}:${startM}.`);
}

// ===============================
// Postpone modal helpers
// ===============================
let _postponeTask = null;

function openPostponeModal(task) {
  _postponeTask = task;
  el("postponeModal")?.classList.remove("hidden");

  // ברירת מחדל: מחר באותה שעה
  if (el("postponeDateInput")) el("postponeDateInput").value = getTomorrowKey();
  if (el("postponeTimeInput")) el("postponeTimeInput").value = task.startTime || "";

  document.querySelectorAll("[data-close-postpone]").forEach((b) => {
    b.onclick = () => el("postponeModal")?.classList.add("hidden");
  });

  el("postponeOk").onclick = async () => {
    const date = el("postponeDateInput").value;
    const time = el("postponeTimeInput").value || null;
    if (!date) return;
    el("postponeModal").classList.add("hidden");
    await moveItemsToDate([_postponeTask], date, time);
    showToast(`📅 נדחה ל-${formatShortDateHe(date)}${time ? " " + time : ""}`);
  };
}
async function deleteTaskSmart(task) {
  const id = task._id || task.id;
  if (!id || !task.dateKey) return;

  const isRecSeries = Boolean(
    task.isRecurringParent ||
    task.__isOrphanSeries ||
    task.__isMultiDateSeries ||
    (task.recurring && task.recurring !== "none" && !task.isRecurringInstance)
  );

  // אם מוחקים סדרה חוזרת (או כרטיס מחלונית משימות חוזרות / אירועים חוזרים) – מוחקים את כל המופעים שלה מהלוח!
  if (isRecSeries) {
    const seriesParentId = task.__seriesParentId || task.parentId || String(id).replace(/_\d{4}-\d{2}-\d{2}$/, "");
    const targetTitle = (task.title || "").trim();
    const targetType = task.type || "event";
    const removals = {};

    Object.entries(state.cache.events).forEach(([dk, items]) => {
      Object.entries(items || {}).forEach(([cid, ev]) => {
        if (!ev || isDefaultEvent(ev)) return;
        const evBaseId = ev.parentId || String(ev._id || cid).replace(/_\d{4}-\d{2}-\d{2}$/, "");
        const sameSeriesId = seriesParentId && (
          cid === seriesParentId ||
          ev.parentId === seriesParentId ||
          evBaseId === seriesParentId ||
          String(cid).startsWith(seriesParentId + "_")
        );
        const sameTitleAndType =
          targetTitle &&
          (ev.title || "").trim() === targetTitle &&
          (ev.type || "event") === targetType &&
          (ev.isRecurringInstance || ev.isRecurringParent || (ev.recurring && ev.recurring !== "none") || task.__isMultiDateSeries);

        if (sameSeriesId || sameTitleAndType) {
          delete items[cid];
          removals[`${dk}/${cid}`] = null;
        }
      });
    });

    if (state.cache.events[task.dateKey]?.[id]) {
      delete state.cache.events[task.dateKey][id];
    }
    removals[`${task.dateKey}/${id}`] = null;

    renderCalendar();
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
      renderDayEvents(state.ui.openDayKey);
    }
    try { updateStats(); } catch {}

    await update(ref(db, "events"), removals);
    showToast("🗑 כל מופעי הסדרה החוזרת נמחקו");
  } else {
    // מחיקה רגילה של מופע בודד
    const singleRemovals = {};
    if (state.cache.events[task.dateKey]?.[id]) {
      delete state.cache.events[task.dateKey][id];
    }
    singleRemovals[`${task.dateKey}/${id}`] = null;
    cancelDirectReminder(`${task.dateKey}/${id}`);

    if (task.isRecurringInstance || task.parentId || /_\d{4}-\d{2}-\d{2}$/.test(String(id))) {
      markRecurringParentExcludedDate(task.parentId || id, task.dateKey, singleRemovals);
    }

    renderCalendar();
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
      renderDayEvents(state.ui.openDayKey);
      updateDayRolloverButton(state.ui.openDayKey);
    }
    try { updateStats(); } catch {}

    await update(ref(db, "events"), singleRemovals);
    showToast("נמחק");
  }

  // סגירת חלונית עריכה אם פתוחה
  el("editModal")?.classList.add("hidden");
}
// ===============================
// Recurring materializer
async function materializeRecurringTask(task) {
  if (!task || !task.dateKey || task.dateKey === "undated" || !task._id) return;

  const baseSeriesId = task.__cleanSeriesId || task.parentId || String(task._id).replace(/_\d{4}-\d{2}-\d{2}$/, "");
  const cleanTask = { ...task };
  delete cleanTask.__cleanSeriesId;
  delete cleanTask.__isOrphanSeries;
  delete cleanTask.__isMultiDateSeries;
  delete cleanTask.__instancesCount;
  delete cleanTask.__seriesParentId;
  delete cleanTask.__recurringEvent;

  const start = parseDateKey(cleanTask.dateKey);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);

  const customRule =
    cleanTask.recurring === "custom"
      ? parseCustomRecurrenceRule({
          weekdays: cleanTask.recurringWeekdays || [],
          monthDaysStr: Array.isArray(cleanTask.recurringMonthDays)
            ? cleanTask.recurringMonthDays.join(",")
            : cleanTask.recurringMonthDays || "",
          freeText: cleanTask.recurringCustomText || ""
        })
      : null;

  const multi = {};

  // ניקוי מופעים ישנים של אותה סדרה לפני יצירה מחדש (למשל בעת עריכת ימים/שעות של משימה חוזרת)
  Object.entries(state.cache.events || {}).forEach(([dk, items]) => {
    Object.entries(items || {}).forEach(([cid, ev]) => {
      if (!ev || cid === cleanTask._id) return;
      if (
        ev.parentId === cleanTask._id ||
        ev.parentId === baseSeriesId ||
        String(cid).startsWith(baseSeriesId + "_")
      ) {
        delete items[cid];
        multi[`${dk}/${cid}`] = null;
      }
    });
  });

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dk = dateKeyFromDate(d);

    // daily = כל יום, ללא סינון
    if (cleanTask.recurring === "weekly" && d.getDay() !== start.getDay()) continue;
    if (cleanTask.recurring === "monthly_greg" && d.getDate() !== start.getDate()) continue;
    if (
      cleanTask.recurring === "yearly_greg" &&
      (d.getDate() !== start.getDate() || d.getMonth() !== start.getMonth())
    ) continue;
    if (cleanTask.recurring === "custom") {
      if (!doesDateMatchCustomRecurrence(d, start, customRule)) continue;
    }

    const id = `${baseSeriesId}_${dk}`;
    const inst = {
      ...cleanTask,
      _id: id,
      parentId: cleanTask._id,
      isRecurringParent: null,
      isRecurringInstance: true,
      dateKey: dk
    };
    multi[`${dk}/${id}`] = inst;
    if (!state.cache.events[dk]) state.cache.events[dk] = {};
    state.cache.events[dk][id] = inst;
  }
  // כתיבה אחת מרוכזת – מהיר גם לחזרה יומית (365 מופעים)
  if (Object.keys(multi).length > 0) {
    await update(ref(db, "events"), multi);
  }
}
// ===============================
// =========================
// Stats
// =========================
let workFreeChart, tasksChart;


const doughnutCenterTextPlugin = {
  id: "centerText",
  afterDraw(chart, args, options) {
    const { ctx } = chart;
    const centerX = chart.getDatasetMeta(0).data[0].x;
    const centerY = chart.getDatasetMeta(0).data[0].y;

    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(options.text, centerX, centerY);
    ctx.restore();
  }
};
function getNextDayKey(dk) {
  if (!dk || dk === "undated") return getTomorrowKey();
  const d = parseDateKey(dk);
  d.setDate(d.getDate() + 1);
  return dateKeyFromDate(d);
}

function openGoalsModal(opts = {}) {
  const modal = el("goalsModal");
  if (!modal) return;

  const showMotzashBanner = Boolean(opts && opts.showMotzashBanner);

  // סגירה ב־X או רקע – מחברים תחילה כדי שתמיד יעבוד גם אם יש שגיאה בנתונים!
  const closeGoals = () => modal.classList.add("hidden");
  modal.querySelectorAll("[data-close-goals], .modal-header .icon-btn").forEach((b) => {
    b.onclick = closeGoals;
  });
  const backdrop = modal.querySelector(".modal-backdrop");
  if (backdrop) backdrop.onclick = closeGoals;

  modal.classList.remove("hidden");

  // קובע בעלים לפי המשתמש הנוכחי
  const ownerSelect = el("goalOwner");
  if (ownerSelect) {
    ownerSelect.value = state.currentUser;
    ownerSelect.onchange = () => {
      try { renderGoals(); } catch (e) { console.warn(e); }
      try { renderGoalsProgress(showMotzashBanner); } catch (e) { console.warn(e); }
    };
  }

  try {
    renderGoals();
  } catch (e) {
    console.warn("renderGoals error:", e);
  }
  try {
    renderGoalsProgress(showMotzashBanner);
  } catch (e) {
    console.warn("renderGoalsProgress error:", e);
  }
}

function doesItemMatchGoal(ev, goalTitle) {
  if (!ev || !ev.title || !goalTitle) return false;
  if (/sels/i.test(goalTitle) && isSelsEvent(ev)) {
    return true;
  }
  const normEv = normalizeStatCategoryTitle(ev.title).toLowerCase();
  const normGoal = normalizeStatCategoryTitle(goalTitle).toLowerCase();
  if (!normEv || !normGoal) return false;
  if (normEv === normGoal || normEv.includes(normGoal) || normGoal.includes(normEv)) {
    return true;
  }
  const smartEv = (detectSmartDomainCategory(ev.title) || "").toLowerCase();
  const smartGoal = (detectSmartDomainCategory(goalTitle) || "").toLowerCase();
  if (smartEv && (smartEv === normGoal || (smartGoal && smartEv === smartGoal))) {
    return true;
  }
  return false;
}

function findBestFreeSlotToday(user) {
  const todayKey = dateKeyFromDate(new Date());
  const dayEvents = Object.values(state.cache.events?.[todayKey] || {}).filter(
    (ev) => ev && isEventRelevantForUser(ev, user) && !isDefaultEvent(ev) && ev.startTime
  );
  const busy = new Array(1440).fill(false);
  dayEvents.forEach((ev) => {
    const st = Math.max(0, Math.min(1439, timeToMinutes(ev.startTime)));
    const dur = Math.max(30, getEffectiveDurationMinutes(ev) || 60);
    const et = Math.min(1440, st + dur);
    for (let m = st; m < et; m++) busy[m] = true;
  });

  const now = new Date();
  const minStart = Math.max(18 * 60, (now.getHours() + 1) * 60);
  for (let m = minStart; m <= 22 * 60; m += 30) {
    let free = true;
    for (let k = m; k < m + 60 && k < 1440; k++) {
      if (busy[k]) { free = false; break; }
    }
    if (free) return minutesToTime(m);
  }
  return "19:00";
}

function renderGoalsProgress(showMotzashBanner = false) {
  const container = el("goalsProgress");
  if (!container) return;

  const owner = el("goalOwner")?.value || state.currentUser;
  const userLabel = owner === "binyamin" ? "בנימין" : "נוי";
  const goalsObj = state.goals?.[owner] || {};
  const goalEntries = Object.entries(goalsObj);

  const motzashHtml = showMotzashBanner
    ? `
      <div class="motzash-goals-banner">
        <div class="motzash-goals-title">✨ שבוע טוב ומבורך!</div>
        <div class="motzash-goals-sub">זה הזמן לקבוע ביומן משבצות קבועות לעמידה במטרות השבועיות שלכם:</div>
      </div>
    `
    : "";

  // חישוב לפי טווח הסטטיסטיקות (או 7 ימים אחרונים אם נמצאים על יום בודד כדי להשוות ליעד שבועי)
  let dates = getStatsDates(state.statsRange || "week");
  let isWeeklyContext = false;
  if (!dates || dates.length <= 1) {
    dates = [];
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      dates.push(d);
    }
    isWeeklyContext = true;
  }

  const weeks = Math.max(1 / 7, dates.length / 7);
  const stats = computeStatsForDatesList(dates, owner);
  const todayKey = dateKeyFromDate(new Date());

  if (!goalEntries.length) {
    container.innerHTML = `
      ${motzashHtml}
      <div class="goals-empty-box">
        <div class="goals-empty-title">🎯 עדיין לא הוגדרו מטרות שבועיות עבור ${userLabel}</div>
        <div class="goals-empty-sub">בחרו מטרה מהירה להוספה בלחיצה או פתחו את "ניהול והוספת מטרות" למטה:</div>
        <div class="goals-preset-chips">
          <button type="button" class="chip" onclick="window.quickAddPresetGoal('SELS', 4)">🛗 SELS (4 ש׳/שבוע)</button>
          <button type="button" class="chip" onclick="window.quickAddPresetGoal('אימון כושר', 3)">💪 אימון כושר (3 ש׳/שבוע)</button>
          <button type="button" class="chip" onclick="window.quickAddPresetGoal('לימודים וקריאה', 4)">📚 לימודים וקריאה (4 ש׳/שבוע)</button>
          <button type="button" class="chip" onclick="window.quickAddPresetGoal('זמן זוגי איכותי', 5)">💑 זמן זוגי (5 ש׳/שבוע)</button>
          <button type="button" class="chip" onclick="window.quickAddPresetGoal('ספורט והליכה', 2.5)">🏃 ספורט והליכה (2.5 ש׳/שבוע)</button>
        </div>
      </div>
    `;
    const detailsEl = el("goalsManageDetails");
    if (detailsEl) detailsEl.open = true;
    return;
  }

  let totalGoalsCount = goalEntries.length;
  let achievedGoalsCount = 0;

  const cardsHtml = goalEntries.map(([goalId, g]) => {
    const targetHours = Number((g.weeklyHours * weeks).toFixed(1));
    const completedItems = [];
    const uncompletedItems = [];
    const seenIds = new Set();

    dates.forEach((d) => {
      const dk = dateKeyFromDate(d);
      const dayEvents = state.cache.events?.[dk] || {};
      Object.entries(dayEvents).forEach(([id, ev]) => {
        if (!ev) return;
        if (shouldHideRecurringParentOnDate(ev, id, dk, dayEvents)) return;
        if (!isEventRelevantForUser(ev, owner)) return;
        if (isDefaultEvent(ev)) return;
        if (!doesItemMatchGoal(ev, g.title)) return;

        const key = `${dk}/${id}`;
        if (seenIds.has(key)) return;
        seenIds.add(key);

        const durMins = Math.max(15, getEffectiveDurationMinutes(ev) || 60);
        const itemObj = {
          ...ev,
          _id: id,
          dateKey: dk,
          durMins,
          durHours: durMins / 60
        };

        if (ev.completed || ev.completedAt) {
          completedItems.push(itemObj);
        } else {
          uncompletedItems.push(itemObj);
        }
      });
    });

    // גם משימות ללא תאריך שתואמות למטרה
    Object.entries(state.cache.events?.undated || {}).forEach(([id, ev]) => {
      if (!ev || !isEventRelevantForUser(ev, owner)) return;
      if (!doesItemMatchGoal(ev, g.title)) return;
      const durMins = Math.max(15, getEffectiveDurationMinutes(ev) || 60);
      const itemObj = { ...ev, _id: id, dateKey: "undated", durMins, durHours: durMins / 60 };
      if (ev.completed || ev.completedAt) {
        completedItems.push(itemObj);
      } else {
        uncompletedItems.push(itemObj);
      }
    });

    const normGoal = normalizeStatCategoryTitle(g.title);
    let doneHours = completedItems.reduce((acc, it) => acc + it.durHours, 0);
    if (normGoal === "שינה") doneHours = stats.sleepMinutes / 60;
    else if (normGoal === "עבודה") doneHours = stats.workMinutes / 60;
    else if (normGoal === "אוכל ומקלחת") doneHours = stats.foodShowerMinutes / 60;
    else if (normGoal === "זמן פנוי") doneHours = stats.freeMinutes / 60;
    else if (stats.otherMap[normGoal] && stats.otherMap[normGoal] / 60 > doneHours) {
      doneHours = stats.otherMap[normGoal] / 60;
    }

    const uncompletedHours = uncompletedItems.reduce((acc, it) => acc + it.durHours, 0);
    const pct = targetHours > 0 ? Math.min(100, Math.round((doneHours / targetHours) * 100)) : 0;
    const missingHours = Math.max(0, Number((targetHours - doneHours).toFixed(1)));

    if (pct >= 95 || missingHours <= 0.1) achievedGoalsCount++;

    let statusBadge = `<span class="goal-status-badge low">⚠️ חסרות ${missingHours} ש׳</span>`;
    let barColor = "linear-gradient(90deg, #f59e0b, #ef4444)";
    if (pct >= 95 || missingHours <= 0.1) {
      statusBadge = `<span class="goal-status-badge ok">🏆 היעד הושג! (${pct}%)</span>`;
      barColor = "linear-gradient(90deg, #10b981, #22c55e)";
    } else if (pct >= 50) {
      statusBadge = `<span class="goal-status-badge mid">🔥 בדרך ליעד (${pct}%)</span>`;
      barColor = "linear-gradient(90deg, #3b82f6, #06b6d4)";
    }

    // בניית המלצות חכמות ומעשיות לשיפור
    const bestSlot = findBestFreeSlotToday(owner);
    const potentialPct = targetHours > 0
      ? Math.min(100, Math.round(((doneHours + uncompletedHours) / targetHours) * 100))
      : 100;

    let tipsHtml = "";
    if (pct >= 95 || missingHours <= 0.1) {
      tipsHtml = `
        <div class="goal-rec-item">✨ כל הכבוד! עמדתם ביעד של <strong>"${g.title}"</strong> (${doneHours.toFixed(1)} מתוך ${targetHours} ש׳).</div>
        <div class="goal-rec-item">🚀 <strong>טיפ לצמיחה:</strong> אם תרצו לאתגר את עצמכם בשבוע הבא, נסו להעלות את היעד השבועי ב-30 דקות.</div>
      `;
    } else {
      const sessionsNeeded = Math.max(1, Math.ceil((missingHours * 60) / 45));
      if (uncompletedItems.length > 0) {
        tipsHtml += `
          <div class="goal-rec-item">
            📌 יש לכם <strong>${uncompletedItems.length} משימות שהוגדרו למטרה זו ולא בוצעו</strong> (${uncompletedHours.toFixed(1)} ש׳). השלמה שלהן תקפיץ אתכם מ-<strong>${pct}% ל-${potentialPct}%</strong> מהיעד!
          </div>
        `;
      }
      tipsHtml += `
        <div class="goal-rec-item">
          💡 <strong>איך להשלים את הפער (${missingHours} ש׳):</strong> פרקו את הזמן החסר ל-<strong>${sessionsNeeded} מפגשים קצרים של 45 דק׳</strong> במקום לחכות לבלוק זמן ארוך.
        </div>
        <div class="goal-rec-item">
          ⏰ <strong>הזמן הפנוי הטוב ביותר היום:</strong> סביב השעה <strong>${bestSlot}</strong> הלו"ז שלכם פנוי – מומלץ לשבץ שם משימת "${g.title}" עכשיו.
        </div>
      `;
    }

    const completedListHtml = completedItems.length
      ? completedItems.map((it) => `
          <div class="goal-mini-item done">
            <span>✔ <strong>${it.title}</strong> <small>(${it.dateKey !== "undated" ? formatDateHeShort(it.dateKey) : "ללא תאריך"}${it.startTime ? " • " + it.startTime : ""} • ${formatMinutesReadable(it.durMins)})</small></span>
          </div>
        `).join("")
      : `<div class="goal-mini-empty">עדיין לא סומנו משימות שבוצעו למטרה זו בטווח הנבחר</div>`;

    const uncompletedListHtml = uncompletedItems.length
      ? uncompletedItems.map((it) => `
          <div class="goal-mini-item missed">
            <div class="goal-mini-info">
              <span>⏳ <strong>${it.title}</strong> <small>(${it.dateKey !== "undated" ? formatDateHeShort(it.dateKey) : "ללא תאריך"}${it.startTime ? " • " + it.startTime : ""} • ${formatMinutesReadable(it.durMins)})</small></span>
            </div>
            <div class="goal-mini-actions">
              <button type="button" class="ghost-pill small" onclick="window.completeGoalItemInline('${it.dateKey}','${it._id}')">✔ בוצע</button>
              <button type="button" class="ghost-pill small" onclick="window.moveGoalItemInline('${it.dateKey}','${it._id}')">⏭️ ${it.dateKey < todayKey ? "להיום" : "למחר"}</button>
            </div>
          </div>
        `).join("")
      : `<div class="goal-mini-empty">אין משימות פתוחות שלא בוצעו למטרה זו 🎉</div>`;

    const safeTitle = String(g.title).replace(/'/g, "\\'");

    return `
      <div class="goal-card-box">
        <div class="goal-card-top">
          <div>
            <div class="goal-card-title">🎯 ${g.title}</div>
            <div class="goal-card-sub">בוצעו <strong>${doneHours.toFixed(1)} ש׳</strong> מתוך יעד של <strong>${targetHours} ש׳</strong> (${g.weeklyHours} ש׳/שבוע)</div>
          </div>
          ${statusBadge}
        </div>

        <div class="goal-progress-track">
          <div class="goal-progress-fill" style="width:${pct}%; background:${barColor};"></div>
        </div>

        <div class="goal-lists-grid">
          <div class="goal-list-col done-col">
            <div class="goal-list-header">✅ בוצעו (${completedItems.length})</div>
            ${completedListHtml}
          </div>
          <div class="goal-list-col missed-col">
            <div class="goal-list-header">❌ לא בוצעו (${uncompletedItems.length})</div>
            ${uncompletedListHtml}
          </div>
        </div>

        <div class="goal-rec-box">
          <div class="goal-rec-title">💡 מה כדאי לעשות כדי לשפר את השגת המטרה:</div>
          ${tipsHtml}
          <div class="goal-rec-actions">
            <button type="button" class="primary-pill small" onclick="window.quickScheduleGoal('${safeTitle}', '${bestSlot}', '${owner}')">
              ➕ שבץ "${g.title}" להיום (${bestSlot})
            </button>
            ${uncompletedItems.length > 0 ? `
              <button type="button" class="ghost-pill small" onclick="window.rolloverAllGoalUncompleted('${safeTitle}', '${owner}')">
                ⏭️ העבר ${uncompletedItems.length} שלא בוצעו להיום/מחר
              </button>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  const rangeLabel = isWeeklyContext
    ? "7 ימים אחרונים (השוואה ליעד שבועי)"
    : `${formatDateHeShort(dateKeyFromDate(dates[0]))} – ${formatDateHeShort(dateKeyFromDate(dates[dates.length - 1]))}`;

  container.innerHTML = `
    ${motzashHtml}
    <div class="goals-summary-banner">
      <div>
        <div class="goals-summary-title">📊 מעקב מטרות – ${userLabel}</div>
        <div class="goals-summary-sub">טווח בדיקה: ${rangeLabel}</div>
      </div>
      <div class="goals-summary-score">
        <strong>${achievedGoalsCount}/${totalGoalsCount}</strong> מטרות הושגו
      </div>
    </div>
    ${cardsHtml}
  `;
}

async function quickAddPresetGoal(title, weeklyHours) {
  const owner = el("goalOwner")?.value || state.currentUser;
  if (!state.goals[owner]) state.goals[owner] = {};
  const id = Date.now();
  state.goals[owner][id] = { title, weeklyHours: Number(weeklyHours) };
  await update(ref(db, "goals"), state.goals);
  renderGoals();
  renderGoalsProgress();
  try { updateStats(); } catch {}
  showToast(`🎯 המטרה "${title}" נוספה!`);
}

async function completeGoalItemInline(dateKey, id) {
  const ev = state.cache.events?.[dateKey]?.[id];
  if (!ev) return;
  const nowTs = Date.now();
  ev.completed = true;
  ev.completedAt = nowTs;
  await update(ref(db, `events/${dateKey}/${id}`), { completed: true, completedAt: nowTs });
  showToast("✔ סומן כבוצע! המטרות והסטטיסטיקה עודכנו");
  renderGoalsProgress();
  try { updateStats(); } catch {}
  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
}

async function moveGoalItemInline(dateKey, id) {
  const todayKey = dateKeyFromDate(new Date());
  const targetKey = dateKey < todayKey ? todayKey : getNextDayKey(todayKey);
  await moveItemsToDate([{ dateKey, id }], targetKey);
  renderGoalsProgress();
  try { updateStats(); } catch {}
}

async function rolloverAllGoalUncompleted(goalTitle, owner) {
  const dates = getStatsDates(state.statsRange || "week");
  const checkDates = dates && dates.length > 1 ? dates : (() => {
    const arr = [];
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      arr.push(d);
    }
    return arr;
  })();

  const todayKey = dateKeyFromDate(new Date());
  const toToday = [];
  const toTomorrow = [];

  checkDates.forEach((d) => {
    const dk = dateKeyFromDate(d);
    const dayEvents = state.cache.events?.[dk] || {};
    Object.entries(dayEvents).forEach(([id, ev]) => {
      if (!ev || ev.completed || ev.completedAt) return;
      if (shouldHideRecurringParentOnDate(ev, id, dk, dayEvents)) return;
      if (!isEventRelevantForUser(ev, owner)) return;
      if (!doesItemMatchGoal(ev, goalTitle)) return;
      if (dk < todayKey) toToday.push({ dateKey: dk, id });
      else if (dk === todayKey) toTomorrow.push({ dateKey: dk, id });
    });
  });

  if (toToday.length) await moveItemsToDate(toToday, todayKey);
  if (toTomorrow.length) await moveItemsToDate(toTomorrow, getNextDayKey(todayKey));
  renderGoalsProgress();
  try { updateStats(); } catch {}
}

function quickScheduleGoal(goalTitle, startTime, owner) {
  el("goalsModal")?.classList.add("hidden");
  const todayKey = dateKeyFromDate(new Date());
  const st = startTime || "19:00";
  const endMins = Math.min(23 * 60 + 59, timeToMinutes(st) + 45);
  openEditModal({
    dateKey: todayKey,
    type: "task",
    title: goalTitle,
    startTime: st,
    endTime: minutesToTime(endMins),
    owner: owner || state.currentUser
  });
}

// =========================
// Daily Summary Notification & Modal (21:00 default, configurable)
// =========================
function getDailySummaryTime() {
  return (
    state.settings?.dailySummaryTime ||
    localStorage.getItem("bnapp_daily_summary_time") ||
    "21:00"
  );
}

async function saveDailySummaryTime() {
  const input = el("settingsSummaryTime");
  const val = (input?.value || "21:00").trim();
  if (!/^\d{2}:\d{2}$/.test(val)) {
    showToast("נא לבחור שעה תקינה");
    return;
  }
  state.settings.dailySummaryTime = val;
  try {
    localStorage.setItem("bnapp_daily_summary_time", val);
    // איפוס הדגל של היום כדי שאם בחרו שעה עתידית היום זה יקפוץ בשעה החדשה
    const todayKey = dateKeyFromDate(new Date());
    localStorage.removeItem(`bnapp_daily_summary_fired_${todayKey}`);
  } catch {}
  scheduleDailySummaryAlarm();
  try {
    await update(ref(db, "settings"), { dailySummaryTime: val });
  } catch (e) {
    console.warn("Failed saving dailySummaryTime to Firebase", e);
  }
  showToast(`🕘 שעת הסיכום היומי עודכנה ל-${val}`);
}

function scheduleDailySummaryAlarm() {
  const timeStr = getDailySummaryTime();
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return;

  const now = new Date();
  const target = new Date();
  target.setHours(hh, mm, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  if (hasNativeAndroidBridge()) {
    try {
      window.AndroidBridge.scheduleAlarm(
        "daily_summary_alarm",
        "📊 הסיכום היומי שלכם מוכן!",
        "לחצו לצפייה בסטטיסטיקה היומית ולהעברת משימות שלא בוצעו למחר",
        Math.round(target.getTime())
      );
    } catch (e) {
      console.warn("scheduleDailySummaryAlarm native error", e);
    }
  }
}

function checkDailySummaryDue() {
  try {
    checkMotzeiShabbatGoalsPrompt();
  } catch (e) {
    console.warn("checkMotzeiShabbatGoalsPrompt error:", e);
  }

  const timeStr = getDailySummaryTime();
  const [hh, mm] = timeStr.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return;

  const now = new Date();
  const todayKey = dateKeyFromDate(now);
  const firedKey = `bnapp_daily_summary_fired_${todayKey}`;
  if (localStorage.getItem(firedKey) === "1") return;

  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  const diffMs = now.getTime() - target.getTime();

  // אם הגיעה שעת הסיכום היומי (ועד שעתיים אחריה אם פתחו את האפליקציה קצת אחרי)
  if (diffMs >= 0 && diffMs <= 2 * 60 * 60 * 1000) {
    try {
      localStorage.setItem(firedKey, "1");
    } catch {}

    playReminderSound();
    showSystemNotification(
      `📊 סיכום יומי (${timeStr}) – בנימין & נוי`,
      "בואו לראות את הסטטיסטיקה של היום ולהעביר משימות שלא בוצעו למחר בלחיצה אחת!",
      `daily-summary-${todayKey}`
    );
    openDailySummaryModal(todayKey);
    // קובעים מראש את ההתראה למחר
    setTimeout(scheduleDailySummaryAlarm, 2000);
  }
}

// =========================
// התראת תחילת שבוע (שעתיים אחרי צאת שבת / מוצ"ש) לקביעת זמן לעמידה במטרות
// =========================
function getThisWeeksFridayAndSaturday() {
  const now = new Date();
  const day = now.getDay(); // 0=ראשון .. 6=שבת
  // אם היום שבת (6) -> שישי היה אתמול (-1); אם היום ראשון (0) -> שישי היה לפני יומיים (-2)
  const friday = new Date(now);
  if (day === 6) {
    friday.setDate(now.getDate() - 1);
  } else {
    friday.setDate(now.getDate() + (5 - day));
  }
  friday.setHours(12, 0, 0, 0);
  const saturday = new Date(friday);
  saturday.setDate(friday.getDate() + 1);
  return { friday, saturday };
}

async function scheduleMotzeiShabbatGoalsAlarm() {
  try {
    const { friday, saturday } = getThisWeeksFridayAndSaturday();
    const info = await ensureShabbatForWeek(friday);
    let targetTs;
    if (info && info.havdalah) {
      targetTs = info.havdalah.getTime() + 2 * 60 * 60 * 1000; // שעתיים אחרי צאת שבת
    } else {
      const fallbackSat = new Date(saturday);
      fallbackSat.setHours(20, 30, 0, 0);
      targetTs = fallbackSat.getTime();
    }

    if (targetTs > Date.now() && hasNativeAndroidBridge()) {
      window.AndroidBridge.scheduleAlarm(
        "weekly_goals_motzash",
        "🎯 שבוע טוב! זמן לתכנן את המטרות השבועיות",
        "עברו שעתיים מצאת שבת – לחצו לקביעת זמן ביומן לעמידה במטרות השבוע!",
        Math.round(targetTs)
      );
    }
  } catch (e) {
    console.warn("scheduleMotzeiShabbatGoalsAlarm error:", e);
  }
}

function checkMotzeiShabbatGoalsPrompt() {
  const now = new Date();
  const day = now.getDay();
  // פועל במוצ"ש (שבת בערב, שעתיים אחרי צאת שבת)
  if (day !== 6) return;

  const friday = new Date(now);
  friday.setDate(now.getDate() - 1);
  friday.setHours(12, 0, 0, 0);
  const fridayKey = dateKeyFromDate(friday);
  const satKey = dateKeyFromDate(now);
  const firedKey = `bnapp_motzash_goals_fired_${satKey}`;
  if (localStorage.getItem(firedKey) === "1") return;

  const shabbatInfo = state.cache.shabbat?.[fridayKey];
  if (!shabbatInfo) {
    ensureShabbatForWeek(friday).then(() => scheduleMotzeiShabbatGoalsAlarm()).catch(() => {});
  }

  let targetTs;
  if (shabbatInfo && shabbatInfo.havdalah) {
    targetTs = shabbatInfo.havdalah.getTime() + 2 * 60 * 60 * 1000; // שעתיים אחרי צאת שבת
  } else {
    const fallback = new Date(now);
    fallback.setHours(20, 30, 0, 0);
    targetTs = fallback.getTime();
  }

  const diffMs = now.getTime() - targetTs;
  if (diffMs >= 0 && diffMs <= 3.5 * 60 * 60 * 1000) {
    try {
      localStorage.setItem(firedKey, "1");
    } catch {}

    playReminderSound();
    showSystemNotification(
      "🎯 שבוע טוב! זמן לקבוע מטרות לשבוע החדש",
      "עברו שעתיים מצאת שבת – בואו נשבץ עכשיו זמן ביומן לעמידה במטרות השבועיות!",
      `motzash-goals-${satKey}`
    );
    openGoalsModal({ showMotzashBanner: true });
  }
}

function openDailySummaryModal(dateKey = dateKeyFromDate(new Date())) {
  const modal = el("dailySummaryModal");
  if (!modal) return;

  const closeSummary = () => modal.classList.add("hidden");
  qsa("[data-close-daily-summary], [data-close-summary], .modal-header .icon-btn", modal).forEach((b) => {
    b.onclick = closeSummary;
  });
  const backdrop = modal.querySelector(".modal-backdrop");
  if (backdrop) backdrop.onclick = closeSummary;

  modal.classList.remove("hidden");
  try {
    renderDailySummaryModal(dateKey);
  } catch (e) {
    console.warn("renderDailySummaryModal error:", e);
  }
}

function renderDailySummaryModal(dateKey = dateKeyFromDate(new Date())) {
  const body = el("dailySummaryBody");
  const titleEl = el("dailySummaryTitle");
  if (!body) return;

  const user = state.currentUser;
  const userName = user === "binyamin" ? "בנימין" : "נוי";
  if (titleEl) {
    titleEl.textContent = `📊 סיכום יומי – ${userName} (${formatDateHeShort(dateKey)})`;
  }

  const dayDate = dateFromKey(dateKey);
  const stats = computeStatsForDatesList([dayDate], user);

  const dayEventsObj = state.cache.events?.[dateKey] || {};
  const completedToday = [];
  const uncompletedToday = [];

  Object.entries(dayEventsObj).forEach(([id, ev]) => {
    if (!ev) return;
    if (shouldHideRecurringParentOnDate(ev, id, dateKey, dayEventsObj)) return;
    if (!isEventRelevantForUser(ev, user)) return;
    if (isDefaultEvent(ev) || isRoutineStatEvent(ev)) return;

    const item = { ...ev, _id: id, dateKey };
    if (ev.completed || ev.completedAt) {
      completedToday.push(item);
    } else {
      uncompletedToday.push(item);
    }
  });

  const totalActionable = completedToday.length + uncompletedToday.length;
  const scorePct = totalActionable > 0
    ? Math.round((completedToday.length / totalActionable) * 100)
    : 100;

  const customCatsHtml = Object.entries(stats.otherMap || {})
    .map(([cat, mins]) => `<span class="summary-stat-pill custom">${cat === "SELS" ? "🛗" : "✨"} ${cat}: <strong>${formatMinutesReadable(mins)}</strong></span>`)
    .join("");

  const uncompletedHtml = uncompletedToday.length
    ? uncompletedToday.map((it) => `
        <div class="summary-missed-row">
          <div class="summary-missed-info">
            <strong>${it.type === "task" ? "📝" : "📅"} ${it.title}</strong>
            <small>${it.startTime ? it.startTime : "ללא שעה"} • ${it.owner === "shared" ? "משותף" : userName}</small>
          </div>
          <div class="summary-missed-actions">
            <button type="button" class="ghost-pill small" onclick="window.completeDailySummaryItem('${dateKey}','${it._id}')">✔ בוצע</button>
            <button type="button" class="ghost-pill small" onclick="window.moveDailySummaryItemToTomorrow('${dateKey}','${it._id}')">⏭️ למחר</button>
          </div>
        </div>
      `).join("")
    : `<div class="goal-mini-empty">🎉 מדהים! כל המשימות והאירועים של היום בוצעו במלואם!</div>`;

  const completedHtml = completedToday.length
    ? completedToday.map((it) => `
        <div class="goal-mini-item done">
          <span>✔ <strong>${it.title}</strong> ${it.startTime ? `<small>(${it.startTime})</small>` : ""}</span>
        </div>
      `).join("")
    : `<div class="goal-mini-empty">עדיין לא סומנו משימות שבוצעו היום</div>`;

  body.innerHTML = `
    <div class="daily-summary-score-card">
      <div>
        <div class="daily-summary-score-title">מד עמידה במשימות היום</div>
        <div class="daily-summary-score-sub">בוצעו ${completedToday.length} מתוך ${totalActionable} משימות ואירועים</div>
      </div>
      <div class="daily-summary-score-badge">${scorePct}%</div>
    </div>

    <div class="daily-summary-24h-box">
      <div class="daily-summary-sec-title">🕒 פילוח 24 שעות היממה (${userName}):</div>
      <div class="summary-stat-pills">
        <span class="summary-stat-pill">💼 עבודה: <strong>${formatMinutesReadable(stats.workMinutes)}</strong></span>
        <span class="summary-stat-pill">🟢 זמן פנוי: <strong>${formatMinutesReadable(stats.freeMinutes)}</strong></span>
        <span class="summary-stat-pill">🍽️ אוכל ומקלחות: <strong>${formatMinutesReadable(stats.foodShowerMinutes)}</strong></span>
        <span class="summary-stat-pill">🚗 נסיעות: <strong>${formatMinutesReadable(stats.travelMinutes || 0)}</strong></span>
        <span class="summary-stat-pill">🪥 התארגנות: <strong>${formatMinutesReadable(stats.prepMinutes || 0)}</strong></span>
        <span class="summary-stat-pill">😴 שינה: <strong>${formatMinutesReadable(stats.sleepMinutes)}</strong></span>
        ${customCatsHtml}
      </div>
    </div>

    <div class="daily-summary-section">
      <div class="daily-summary-sec-title">⏳ מה לא בוצע היום (${uncompletedToday.length}):</div>
      <div class="daily-summary-list">${uncompletedHtml}</div>
      ${uncompletedToday.length > 0 ? `
        <button type="button" class="primary-pill full-width" style="margin-top:8px;" onclick="window.rolloverAllTodayToTomorrow('${dateKey}')">
          ⏭️ העבר את כל מה שלא בוצע למחר (${uncompletedToday.length})
        </button>
      ` : ""}
    </div>

    <div class="daily-summary-section">
      <div class="daily-summary-sec-title">✅ מה בוצע היום (${completedToday.length}):</div>
      <div class="daily-summary-list">${completedHtml}</div>
    </div>
  `;
}

async function completeDailySummaryItem(dateKey, id) {
  const ev = state.cache.events?.[dateKey]?.[id];
  if (!ev) return;
  const nowTs = Date.now();
  ev.completed = true;
  ev.completedAt = nowTs;
  await update(ref(db, `events/${dateKey}/${id}`), { completed: true, completedAt: nowTs });
  showToast("✔ סומן כבוצע!");
  renderDailySummaryModal(dateKey);
  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
  try { updateStats(); } catch {}
}

async function moveDailySummaryItemToTomorrow(dateKey, id) {
  const nextKey = getNextDayKey(dateKey);
  await moveItemsToDate([{ dateKey, id }], nextKey);
  renderDailySummaryModal(dateKey);
  try { updateStats(); } catch {}
}

async function rolloverAllTodayToTomorrow(dateKey) {
  const items = getUncompletedItemsOfDay(dateKey);
  if (!items.length) return;
  const nextKey = getNextDayKey(dateKey);
  await moveItemsToDate(items, nextKey);
  renderDailySummaryModal(dateKey);
  try { updateStats(); } catch {}
}

   
   
// =========================
// Delete confirmation modal
// =========================
function openDeleteConfirm({ text, onConfirm }) {
  const modal = el("deleteConfirmModal");
  if (!modal) return;

  el("confirmText").textContent = text;
  modal.classList.remove("hidden");

  el("confirmCancel").onclick = () => {
    modal.classList.add("hidden");
  };

  el("confirmOk").onclick = () => {
    modal.classList.add("hidden");
    onConfirm(); // 👈 רק כאן מתבצעת פעולה
  };

  modal.querySelector(".modal-backdrop").onclick = () => {
    modal.classList.add("hidden");
  };
}


// =========================
// Render goals (per user)
// =========================
function renderGoals() {
  const box = el("goalsList");
  if (!box) return;

  box.innerHTML = "";

  const owner = state.currentUser;
  const goals = state.goals?.[owner] || {};

  Object.entries(goals).forEach(([id, g]) => {
    const div = document.createElement("div");
    div.className = "task-item";

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="task-title">${g.title}</div>
          <div class="task-meta">${g.weeklyHours} ש׳ / שבוע</div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="ghost-pill small edit-goal">✏️</button>
          <button class="ghost-pill small delete-goal">🗑</button>
        </div>
      </div>
    `;

    // ✏️ עריכת שעות
div.querySelector(".edit-goal").onclick = () => {
  editingGoalId = id;

  el("goalTitle").value = g.title;
  el("goalHours").value = g.weeklyHours;
  el("goalOwner").value = owner;

  el("btnAddGoal").textContent = "שמור שינויים";
  const detailsEl = el("goalsManageDetails");
  if (detailsEl) detailsEl.open = true;
  el("goalsModal").classList.remove("hidden");
};

    // 🗑 מחיקה
    div.querySelector(".delete-goal").onclick = () => {
      openDeleteConfirm({
        text: `למחוק את המטרה "${g.title}"?`,
        onConfirm: () => {
          delete state.goals[owner][id];
          update(ref(db, "goals"), state.goals);
          renderGoals();
          renderGoalsProgress();
          updateStats();
        }
      });
    };

    box.appendChild(div);
  });
}
// =========================
// Stats date range helpers (auto vs manual)
// =========================
function statsMarkManualDates() {
  localStorage.setItem("bnapp_stats_manualDates", "1");

  const from = el("completedFromDate")?.value || "";
  const to = el("completedToDate")?.value || "";
  localStorage.setItem("bnapp_stats_from", from);
  localStorage.setItem("bnapp_stats_to", to);
}

function statsApplyPresetDates(range, force = false) {
  if (!force && localStorage.getItem("bnapp_stats_manualDates") === "1") return;

  const fromInput = el("completedFromDate");
  const toInput = el("completedToDate");
  if (!fromInput || !toInput) return;

  const now = new Date();
  now.setHours(12, 0, 0, 0);

  let fromDate = new Date(now);
  let toDate = new Date(now);

  if (range === "day") {
    fromDate = new Date(now);
    toDate = new Date(now);
  } else if (range === "week") {
    toDate = new Date(now);
    fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 6);
  } else if (range === "2weeks") {
    toDate = new Date(now);
    fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 13);
  } else if (range === "month") {
    const y = now.getFullYear();
    const m = now.getMonth();
    fromDate = new Date(y, m, 1, 12, 0, 0, 0);
    toDate = new Date(y, m + 1, 0, 12, 0, 0, 0);
  } else if (range === "year") {
    const y = now.getFullYear();
    fromDate = new Date(y, 0, 1, 12, 0, 0, 0);
    toDate = new Date(y, 11, 31, 12, 0, 0, 0);
  } else if (range === "yesterday") {
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 1);
    toDate = new Date(fromDate);
  } else if (range === "lastweek") {
    // שבוע קודם מלא: ראשון עד שבת
    const thisSunday = new Date(now);
    thisSunday.setDate(now.getDate() - now.getDay());
    fromDate = new Date(thisSunday);
    fromDate.setDate(thisSunday.getDate() - 7);
    toDate = new Date(thisSunday);
    toDate.setDate(thisSunday.getDate() - 1);
  } else if (range === "lastmonth") {
    const y = now.getFullYear();
    const m = now.getMonth();
    fromDate = new Date(y, m - 1, 1, 12, 0, 0, 0);
    toDate = new Date(y, m, 0, 12, 0, 0, 0);
  }

  fromInput.value = dateKeyFromDate(fromDate);
  toInput.value = dateKeyFromDate(toDate);

  localStorage.setItem("bnapp_stats_from", fromInput.value);
  localStorage.setItem("bnapp_stats_to", toInput.value);
}

// =========================
// App init
// =========================
function initApp() {

// 🔥 טעינת משתמש שמור
const savedUser = localStorage.getItem("bnapp_currentUser");
if (savedUser) {
  state.currentUser = savedUser;
}
  
  loadVoices();
  initTheme();
  initBottomNav();
  initTasksFilters();
  initShopping();
  initFirebaseListeners();

  el("btnOpenGoals").onclick = openGoalsModal;
  el("btnAddGoal").onclick = () => {
    const title = el("goalTitle").value.trim();
    const hours = Number(el("goalHours").value);
    const owner = el("goalOwner").value;

    if (!title || isNaN(hours) || hours <= 0 || !owner) return;

    if (!state.goals[owner]) {
      state.goals[owner] = {};
    }

    if (editingGoalId) {
      state.goals[owner][editingGoalId] = {
        ...state.goals[owner][editingGoalId],
        title,
        weeklyHours: hours
      };
    } else {
      const id = Date.now();
      state.goals[owner][id] = {
        title,
        weeklyHours: hours
      };
    }

    update(ref(db, "goals"), state.goals);

    editingGoalId = null;
    el("goalTitle").value = "";
    el("goalHours").value = "";
    el("btnAddGoal").textContent = "הוסף מטרה";

    renderGoals();
    renderGoalsProgress();
    showToast("🎯 המטרה נשמרה בהצלחה!");
    try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
  };

  // =========================
  // Stats range selector & custom dates
  // =========================
  const rangeButtons = document.querySelectorAll("#statsRangeSelector .segmented-btn, #statsPastSelector .segmented-btn");
  const fromInput = el("completedFromDate");
  const toInput = el("completedToDate");
  const customDatesCard = el("statsCustomDatesCard");
  const btnToggleDates = el("btnToggleCustomDates");

  // Initialize default range to "day" (24h = 100%)
  localStorage.removeItem("bnapp_stats_manualDates");
  statsApplyPresetDates(state.statsRange || "day", true);

  rangeButtons.forEach((btn) => {
    btn.onclick = () => {
      rangeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      state.statsRange = btn.dataset.range;
      localStorage.removeItem("bnapp_stats_manualDates");
      statsApplyPresetDates(state.statsRange, true);
      updateStats();
    };
  });

  if (btnToggleDates && customDatesCard) {
    btnToggleDates.onclick = () => {
      customDatesCard.classList.toggle("hidden");
    };
  }

  if (el("btnCloseCustomDates") && customDatesCard) {
    el("btnCloseCustomDates").onclick = () => {
      customDatesCard.classList.add("hidden");
    };
  }

  if (el("btnStatsToday") && fromInput && toInput) {
    el("btnStatsToday").onclick = () => {
      const todayStr = dateKeyFromDate(new Date());
      fromInput.value = todayStr;
      toInput.value = todayStr;
      state.statsRange = "day";
      rangeButtons.forEach((b) => b.classList.toggle("active", b.dataset.range === "day"));
      statsMarkManualDates();
      updateStats();
    };
  }

  if (el("btnStatsYesterday") && fromInput && toInput) {
    el("btnStatsYesterday").onclick = () => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = dateKeyFromDate(y);
      fromInput.value = yStr;
      toInput.value = yStr;
      state.statsRange = "day";
      rangeButtons.forEach((b) => b.classList.toggle("active", b.dataset.range === "day"));
      statsMarkManualDates();
      updateStats();
    };
  }

  if (fromInput) {
    fromInput.onchange = () => {
      if (toInput && toInput.value && fromInput.value > toInput.value) {
        toInput.value = fromInput.value;
      }
      statsMarkManualDates();
      updateStats();
    };
  }

  if (toInput) {
    toInput.onchange = () => {
      if (fromInput && fromInput.value && toInput.value < fromInput.value) {
        fromInput.value = toInput.value;
      }
      statsMarkManualDates();
      updateStats();
    };
  }

  
  initGihari();


  // user select -> state.currentUser
const userSel = el("userSelect");
if (userSel) {
  // טעינה ראשונית מה־state
  userSel.value = state.currentUser;

  userSel.onchange = () => {
    state.currentUser = userSel.value || "binyamin";

    // 🔥 שמירה קבועה
    localStorage.setItem("bnapp_currentUser", state.currentUser);

    syncRemindersForCurrentUser();
    renderCalendar();
    if (!el("dayModal")?.classList.contains("hidden") && state.ui.openDayKey) {
      renderDayEvents(state.ui.openDayKey);
    }
    renderTasks(
      qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated"
    );
    updateStats();
  };
}
  el("btnPrevMonth").onclick = () => { state.currentDate.setMonth(state.currentDate.getMonth() - 1); renderCalendar(); };
  el("btnNextMonth").onclick = () => { state.currentDate.setMonth(state.currentDate.getMonth() + 1); renderCalendar(); };
  el("btnToday").onclick = () => { state.currentDate = new Date(); renderCalendar(); };
  el("btnFabAdd").onclick = () => openEditModal({});
  el("btnAddTask").onclick = () => openEditModal({});

  el("btnCity").onclick = () => qs('[data-target="settingsSection"]')?.click();
  el("btnSaveCity").onclick = saveCitySettings;
  if (el("btnUseGps")) {
    el("btnUseGps").onclick = useGpsLocation;
  }
  if (el("settingsSummaryTime")) {
    el("settingsSummaryTime").value = getDailySummaryTime();
  }
  if (el("btnSaveSummaryTime")) {
    el("btnSaveSummaryTime").onclick = saveDailySummaryTime;
  }
  if (el("btnShowSummaryNow")) {
    el("btnShowSummaryNow").onclick = () => openDailySummaryModal();
  }

  // הגדרת זמן ברירת מחדל לנודניק בהגדרות היומן
  syncSnoozeUI();
  if (el("btnSaveSnoozeMinutes")) {
    el("btnSaveSnoozeMinutes").onclick = () => saveSnoozeMinutes();
  }
  qsa("#snoozePresetChips [data-snooze-preset]").forEach((btn) => {
    btn.onclick = () => {
      const mins = Number(btn.dataset.snoozePreset);
      if (mins > 0) saveSnoozeMinutes(mins);
    };
  });

  // ווידג'ט יוקרתי למסך הבית ובראש היומן (תצוגה חיה + כפתור + להוספה מהירה + עדכון אוטומטי)
  if (el("btnWidgetQuickAdd")) {
    el("btnWidgetQuickAdd").onclick = (e) => {
      e.stopPropagation();
      openQuickAddFromWidget();
    };
  }
  if (el("btnCalWidgetQuickAdd")) {
    el("btnCalWidgetQuickAdd").onclick = (e) => {
      e.stopPropagation();
      openQuickAddFromWidget();
    };
  }
  if (el("btnToggleTopCalWidget")) {
    el("btnToggleTopCalWidget").onclick = () => {
      const nextState = !isTopCalWidgetEnabled();
      setTopCalWidgetEnabled(nextState);
      showToast(nextState ? "✨ הווידג'ט היוקרתי מופיע כעת בראש היומן!" : "הווידג'ט בראש היומן הוסתר");
    };
  }
  if (el("btnRefreshWidgetPreview")) {
    el("btnRefreshWidgetPreview").onclick = () => {
      syncWidgetDataAndPreview(true);
      showToast("🌤️ נתוני הווידג'ט רועננו!");
    };
  }
  if (el("btnInstallHomeWidget")) {
    el("btnInstallHomeWidget").onclick = handleInstallHomeWidget;
  }
  if (el("btnLiveAutoUpdate")) {
    el("btnLiveAutoUpdate").onclick = forceLiveAutoUpdateNow;
  }
  syncTopCalWidgetVisibility();
  syncWidgetDataAndPreview(true);
  setInterval(() => syncWidgetDataAndPreview(false), 60000);

  // בדיקה האם נפתח מכפתור ה-"+" של הווידג'ט במסך הבית (?action=add_task)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("action") === "add_task") {
      setTimeout(() => {
        openQuickAddFromWidget();
        try {
          urlParams.delete("action");
          const cleanSearch = urlParams.toString();
          const cleanUrl = window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "");
          window.history.replaceState({}, "", cleanUrl);
        } catch {}
      }, 350);
    }
  } catch {}

  scheduleDailySummaryAlarm();
  scheduleMotzeiShabbatGoalsAlarm();

  // מאזין גלובלי לסגירת כל מודאל בלחיצה על כפתור ה-X או על הרקע הכהה
  document.addEventListener("click", (e) => {
    const closeTrigger = e.target.closest(
      ".modal-backdrop, .modal-header .icon-btn, [data-close-modal], [data-close-day], [data-close-edit], [data-close-postpone], [data-close-picker], [data-close-conflict], [data-close-goals], [data-close-summary], [data-close-daily-summary], [data-close-reminder], [data-close-special], [data-close-cat-breakdown], [data-close-rollover]"
    );
    if (closeTrigger) {
      const parentModal = closeTrigger.closest(".modal");
      if (parentModal) {
        if (parentModal.id === "reminderAlertModal") {
          stopAlarmLoop();
        }
        parentModal.classList.add("hidden");
      }
    }
  });

  el("btnThemeToggle").onclick = toggleTheme;
  el("btnRequestNotifications").onclick = async () => {
    setAppSoundMode("ring");
    await requestNotifications();
  };
  if (el("btnTestNotificationNow")) {
    el("btnTestNotificationNow").onclick = testNotificationNow;
  }
  if (el("btnDisableNotifications")) {
    el("btnDisableNotifications").onclick = () => {
      setAppSoundMode("silent");
      showToast("🔕 התראות הושתקו (מצב שקט)");
    };
  }
  qsa("#soundModeSelector [data-sound-mode]").forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.soundMode;
      setAppSoundMode(mode);
      if (mode === "ring") {
        playConfirmTick();
        showToast("🔊 מצב צלצול: 8 שניות צלצול רגוע ואז ג'יחרי מדבר");
      } else if (mode === "vibrate") {
        try { if (navigator.vibrate) navigator.vibrate([220, 120, 220]); } catch {}
        showToast("📳 מצב רטט: התראות ברטט בלבד ללא קול");
      } else {
        showToast("🔕 מצב שקט: ללא התראות קוליות וללא רטט");
      }
    };
  });
  syncSoundModeButtons();
  if (hasNativeAndroidBridge() || window.location.search.includes("native=1")) {
    const promo = el("apkInstallPromo");
    if (promo) promo.style.display = "none";
  }
  el("btnOpenWaze").onclick = openWazeFromForm;

  el("editForm").addEventListener("submit", handleEditFormSubmit);

  renderCalendar();
  renderTasks();
  renderShoppingList();
  try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }

  loadDirectRemindersFromStorage();
  setInterval(tickDirectReminders, 1000);
  setTimeout(tickDirectReminders, 500);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tickDirectReminders();
  });
  window.addEventListener("focus", tickDirectReminders);
  window.addEventListener("pageshow", tickDirectReminders);

  // ===== expose functions for inline HTML handlers =====
  window.toggleCompletedSection = toggleCompletedSection;
  window.toggleTaskDone = toggleTaskDone;
  window.openSpecialEventsModal = openSpecialEventsModal;
  window.openStatCategoryBreakdown = openStatCategoryBreakdown;
  window.rolloverPastUncompletedToToday = rolloverPastUncompletedToToday;
  window.moveItemToNextDay = moveItemToNextDay;
  window.postponeItemById = postponeItemById;
  window.quickAddPresetGoal = quickAddPresetGoal;
  window.completeGoalItemInline = completeGoalItemInline;
  window.moveGoalItemInline = moveGoalItemInline;
  window.rolloverAllGoalUncompleted = rolloverAllGoalUncompleted;
  window.quickScheduleGoal = quickScheduleGoal;
  window.openDailySummaryModal = openDailySummaryModal;
  window.completeDailySummaryItem = completeDailySummaryItem;
  window.moveDailySummaryItemToTomorrow = moveDailySummaryItemToTomorrow;
  window.rolloverAllTodayToTomorrow = rolloverAllTodayToTomorrow;
  window.openQuickAddFromWidget = openQuickAddFromWidget;
}

// ===================================================
// ווידג'ט יוקרתי למסך הבית (יום, מזג אוויר, מיקום, משימה קרובה וכפתור +)
// ===================================================
let _widgetWeatherCache = {
  ts: 0,
  cityKey: "",
  temp: "22°",
  emoji: "☀️",
  label: "נעים ובהיר"
};

function openQuickAddFromWidget() {
  const todayKey = dateKeyFromDate(new Date());
  openEditModal({
    dateKey: todayKey,
    type: "task",
    owner: state.currentUser || "binyamin"
  });
}

function isTopCalWidgetEnabled() {
  try {
    return localStorage.getItem("bnapp_show_top_cal_widget") !== "0";
  } catch {
    return true;
  }
}

function setTopCalWidgetEnabled(enabled) {
  try {
    localStorage.setItem("bnapp_show_top_cal_widget", enabled ? "1" : "0");
  } catch {}
  syncTopCalWidgetVisibility();
}

function syncTopCalWidgetVisibility() {
  const enabled = isTopCalWidgetEnabled();
  const topWidget = el("topCalendarLuxuryWidget");
  if (topWidget) {
    topWidget.classList.toggle("hidden", !enabled);
  }
  const toggleBtn = el("btnToggleTopCalWidget");
  if (toggleBtn) {
    toggleBtn.textContent = enabled
      ? "✨ ווידג'ט יוקרתי בראש היומן: פעיל ✅ (לחץ להסתרה)"
      : "✨ הפעל ווידג'ט יוקרתי בראש היומן";
    toggleBtn.className = enabled ? "primary-pill full-width" : "ghost-pill full-width";
  }
}

async function forceLiveAutoUpdateNow() {
  showToast("⚡ מסנכרן ומעדכן את כל השינויים אוטומטית...", 2500);
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        try { await r.update(); } catch {}
      }
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  setTimeout(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(Date.now()));
    window.location.replace(url.toString());
  }, 500);
}

function handleInstallHomeWidget() {
  setTopCalWidgetEnabled(true);
  syncWidgetDataAndPreview(false);
  if (hasNativeAndroidBridge() && typeof window.AndroidBridge.requestPinWidget === "function") {
    try {
      const pinned = window.AndroidBridge.requestPinWidget();
      if (pinned) {
        showToast("📲 אשר את חלונית ההוספה כדי להצמיד את הווידג'ט למסך הבית!");
        return;
      }
    } catch (e) {
      console.warn("requestPinWidget error:", e);
    }
  }
  const helpBox = el("widgetInstallHelpBox");
  if (helpBox) {
    helpBox.classList.remove("hidden");
    helpBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  showToast("✨ הווידג'ט היוקרתי הופעל בראש היומן! (למסך הבית בטלפון – ראה הנחיות למטה)", 4000);
}

function findClosestUpcomingEventForWidget() {
  const now = new Date();
  const todayKey = dateKeyFromDate(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(now.getDate() + 1);
  const tomorrowKey = dateKeyFromDate(tomorrowDate);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const collectForDay = (dk, isToday) => {
    const dayObj = state.cache.events?.[dk] || {};
    const list = [];
    Object.entries(dayObj).forEach(([id, ev]) => {
      if (!ev || isDefaultEvent(ev) || isRoutineStatEvent(ev)) return;
      if (ev.completed || ev.completedAt) return;
      if (shouldHideRecurringParentOnDate(ev, id, dk, dayObj)) return;
      if (!isEventRelevantForUser(ev, state.currentUser)) return;

      let startMins = 23 * 60 + 59;
      if (ev.startTime) {
        const parsed = timeToMinutes(ev.startTime);
        if (Number.isFinite(parsed)) startMins = parsed;
      }
      if (isToday && ev.startTime && startMins + 30 < nowMins) {
        return;
      }
      list.push({
        ...ev,
        _id: id,
        dateKey: dk,
        _sortMins: startMins,
        _isToday: isToday
      });
    });
    list.sort((a, b) => a._sortMins - b._sortMins);
    return list;
  };

  const todayItems = collectForDay(todayKey, true);
  if (todayItems.length > 0) return todayItems[0];

  const tomorrowItems = collectForDay(tomorrowKey, false);
  if (tomorrowItems.length > 0) return tomorrowItems[0];

  // בדיקת משימות ללא תאריך אם אין משימות להיום או למחר
  const undatedObj = state.cache.events?.["undated"] || {};
  for (const [id, ev] of Object.entries(undatedObj)) {
    if (!ev || ev.completed || ev.completedAt) continue;
    if (!isEventRelevantForUser(ev, state.currentUser)) continue;
    return { ...ev, _id: id, dateKey: "undated", _isUndated: true };
  }

  return null;
}

async function fetchWidgetWeatherIfNeeded(forceRefresh = false) {
  try {
    await ensureCityCoords();
  } catch {
    return _widgetWeatherCache;
  }
  const lat = state.settings.cityLat || 31.7683;
  const lon = state.settings.cityLon || 35.2137;
  const cityKey = `${lat},${lon}`;
  const now = Date.now();

  if (!forceRefresh && _widgetWeatherCache.cityKey === cityKey && now - _widgetWeatherCache.ts < 15 * 60 * 1000) {
    return _widgetWeatherCache;
  }

  const todayStr = dateKeyFromDate(new Date());
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=temperature_2m,weather_code` +
    `&timezone=${encodeURIComponent(state.settings.cityTz || "auto")}` +
    `&start_date=${todayStr}&end_date=${todayStr}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data.hourly && Array.isArray(data.hourly.temperature_2m) && data.hourly.temperature_2m.length) {
      const curHour = String(new Date().getHours()).padStart(2, "0") + ":00";
      const idx = data.hourly.time.findIndex((t) => t.endsWith(curHour));
      const i = idx >= 0 ? idx : Math.min(12, data.hourly.temperature_2m.length - 1);
      const tempNum = Math.round(data.hourly.temperature_2m[i]);
      const code = data.hourly.weather_code[i];
      const mapped = mapOpenMeteoWeather(code);
      _widgetWeatherCache = {
        ts: now,
        cityKey,
        temp: `${tempNum}°`,
        emoji: mapped.emoji || "☀️",
        label: mapped.label || "נעים"
      };
    }
  } catch {}
  return _widgetWeatherCache;
}

async function syncWidgetDataAndPreview(forceWeather = false) {
  const now = new Date();
  const hebDays = ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];
  const dayName = hebDays[now.getDay()] || "היום";
  const gregDateStr = now.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
  let hebDateStr = "";
  try {
    hebDateStr = formatHebrewDate(now) || "";
  } catch {}
  const dateLine = hebDateStr ? `${gregDateStr} • ${hebDateStr}` : gregDateStr;
  const city = state.settings.city || localStorage.getItem("bnapp_city") || "ירושלים";
  const locText = `📍 ${city}`;

  const nextEv = findClosestUpcomingEventForWidget();
  let nextIcon = "✨";
  let nextTitle = "אין משימות או אירועים קרובים";
  let nextTime = "הכל פנוי! לחץ על + להוספה";

  if (nextEv) {
    nextIcon = getSmartFunnyEventIcon(nextEv) || (nextEv.type === "task" ? "📝" : "📅");
    nextTitle = nextEv.title || "משימה קרובה";
    const dayPrefix = nextEv._isToday ? "היום" : (nextEv._isUndated ? "ללא תאריך" : "מחר");
    const timePart = nextEv.startTime
      ? `🕒 ${nextEv.startTime}${nextEv.endTime ? "–" + nextEv.endTime : ""}`
      : (nextEv.type === "task" ? "משימה פתוחה" : "כל היום");
    nextTime = `${dayPrefix} • ${timePart}`;
  }

  // עדכון מיידי של הווידג'ט בהגדרות ובראש היומן
  const bindWidgetSet = (prefix) => {
    if (el(`${prefix}Day`)) el(`${prefix}Day`).textContent = dayName;
    if (el(`${prefix}Date`)) el(`${prefix}Date`).textContent = dateLine;
    if (el(`${prefix}Location`)) el(`${prefix}Location`).textContent = locText;
    if (el(`${prefix}WeatherEmoji`)) el(`${prefix}WeatherEmoji`).textContent = _widgetWeatherCache.emoji;
    if (el(`${prefix}Temp`)) el(`${prefix}Temp`).textContent = _widgetWeatherCache.temp;
    if (el(`${prefix}WeatherDesc`)) el(`${prefix}WeatherDesc`).textContent = _widgetWeatherCache.label;
    if (el(`${prefix}NextIcon`)) el(`${prefix}NextIcon`).textContent = nextIcon;
    if (el(`${prefix}NextTitle`)) el(`${prefix}NextTitle`).textContent = nextTitle;
    if (el(`${prefix}NextTime`)) el(`${prefix}NextTime`).textContent = nextTime;

    const nextBox = el(`${prefix}NextBox`);
    if (nextBox) {
      nextBox.onclick = () => {
        if (nextEv && nextEv._id && nextEv.dateKey) {
          openEditModal({ id: nextEv._id, dateKey: nextEv.dateKey });
        } else {
          openQuickAddFromWidget();
        }
      };
    }
  };

  bindWidgetSet("widgetPreview");
  bindWidgetSet("calWidget");

  const pushToAndroidWidget = () => {
    if (hasNativeAndroidBridge() && typeof window.AndroidBridge.updateWidgetData === "function") {
      try {
        window.AndroidBridge.updateWidgetData(
          JSON.stringify({
            day: dayName,
            date: dateLine,
            location: locText,
            temp: _widgetWeatherCache.temp,
            weatherEmoji: _widgetWeatherCache.emoji,
            weatherLabel: _widgetWeatherCache.label,
            nextTitle,
            nextTime,
            nextIcon
          })
        );
      } catch {}
    }
  };

  pushToAndroidWidget();

  const w = await fetchWidgetWeatherIfNeeded(forceWeather);
  if (w) {
    ["widgetPreview", "calWidget"].forEach((prefix) => {
      if (el(`${prefix}WeatherEmoji`)) el(`${prefix}WeatherEmoji`).textContent = w.emoji;
      if (el(`${prefix}Temp`)) el(`${prefix}Temp`).textContent = w.temp;
      if (el(`${prefix}WeatherDesc`)) el(`${prefix}WeatherDesc`).textContent = w.label;
    });
    pushToAndroidWidget();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}





                                
