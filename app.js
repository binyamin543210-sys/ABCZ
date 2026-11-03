// BNAPP V3.5.2 – לוגיקה ראשית
// דורש:
// - firebase-config.js (db)
// - Chart.js (global Chart)
// - hebcal.noloc.min.js (global Hebcal) - עם fallback אם לא נטען

function hasNativeAndroidBridge() {
  return typeof window.AndroidBridge !== "undefined" && window.AndroidBridge !== null;
}

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("./sw.js?v=blue10").then((reg) => {
    try { reg.update(); } catch (e) {}
  }).catch(() => {});

  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.type === "SW_FORCE_RELOAD") {
      window.location.reload();
    } else if (msg.type === "SW_REMINDER_FIRED" && msg.key) {
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
    calendarOwnerFilter: "all",
    tasksOwnerFilter: "all",
    shoppingSortByDept: true
  },

  // מטרות שבועיות – מנוהלות מדף סטטיסטיקות
  goals: {
    binyamin: {},
    nana: {}
  }
};

const GOAL_COLORS = {
  "שינה": "#60a5fa",          // תכלת (7 שעות: 00:00–07:00)
  "עבודה": "#ef4444",         // אדום (10 שעות: 07:00–17:00)
  "אוכל ומקלחת": "#f59e0b",   // כתום (שעה: 17:00–18:00)
  "אוכל + מקלחת": "#f59e0b",  // כתום
  "זמן פנוי": "#22c55e",      // ירוק (6 שעות: 18:00–00:00)
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

function matchesQuickOwnerFilter(ev, filterMode = "all") {
  if (!ev) return false;
  if (!filterMode || filterMode === "all") return true;
  const owner = ev.owner || "shared";
  if (filterMode === "mine") return owner === state.currentUser;
  if (filterMode === "shared") return owner === "shared";
  return true;
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

  if (ev.type === "event" && owner === "shared") {
    if (t === "שינה" && ev.startTime === "00:00" && (ev.endTime === "08:00" || ev.endTime === "07:00")) return true;
    if (t === "עבודה" && (ev.startTime === "08:00" || ev.startTime === "07:00") && ev.endTime === "17:00") return true;
    if ((t === "אוכל + מקלחת" || t === "אוכל ומקלחת") && ev.startTime === "17:00" && (ev.endTime === "18:30" || ev.endTime === "18:00")) return true;
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
  return state.settings.city || "ירושלים";
}

// --- Open-Meteo helpers (מזג אוויר בלי API KEY) ---
async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=he&format=json`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!data.results || !data.results.length) throw new Error("עיר לא נמצאה");
  const r = data.results[0];
  state.settings.cityLat = r.latitude;
  state.settings.cityLon = r.longitude;
  state.settings.cityTz = r.timezone;

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

async function ensureCityCoords() {
  if (state.settings.cityLat && state.settings.cityLon && state.settings.cityTz) return;
  await geocodeCity(getCity());
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

async function ensureDefaultDayEvents(date) {
  const dateKey = dateKeyFromDate(date);
  const day = date.getDay();

  const existing = state.cache.events[dateKey] || {};
  const titles = Object.values(existing).map(e => (e.title || "").trim());

  const toCreate = [];

  // שינה – 00:00 עד 07:00 (7 שעות)
  if (!titles.includes("שינה")) {
    toCreate.push({
      type: "event",
      owner: "shared",
      title: "שינה",
      startTime: "00:00",
      endTime: "07:00",
      dateKey,
      isDefault: true
    });
  }

  // ימי חול: עבודה (07:00 עד 17:00 – 10 שעות) ואוכל ומקלחת (17:00 עד 18:00 – שעה)
  if (day >= 0 && day <= 4) {
    if (!titles.includes("עבודה")) {
      toCreate.push({
        type: "event",
        owner: "shared",
        title: "עבודה",
        startTime: "07:00",
        endTime: "17:00",
        dateKey,
        isDefault: true
      });
    }

    if (!titles.includes("אוכל + מקלחת") && !titles.includes("אוכל ומקלחת")) {
      toCreate.push({
        type: "event",
        owner: "shared",
        title: "אוכל ומקלחת",
        startTime: "17:00",
        endTime: "18:00",
        dateKey,
        isDefault: true
      });
    }
  }

  for (const ev of toCreate) {
    const refNew = push(ref(db, `events/${dateKey}`));
    await set(refNew, { ...ev, _id: refNew.key });
  }
}
// --- יצירת אירועי ברירת מחדל לכל ימי החודש המוצג ---
async function preloadDefaultEventsForVisibleMonth() {
  const year = state.currentDate.getFullYear();
  const month = state.currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const dateKey = dateKeyFromDate(d);

    // אם כבר יש אירועים – לא לגעת
    if (state.cache.events[dateKey]) continue;

    await ensureDefaultDayEvents(new Date(d));
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
// ---------- דיבור + הומור של ג'יחרי ----------
let gihariVoice = null;
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  gihariVoice =
    voices.find((v) => v.lang === "he-IL" && (v.name.includes("Google") || v.name.toLowerCase().includes("wavenet") || v.name.toLowerCase().includes("enhanced"))) ||
    voices.find((v) => v.lang === "he-IL") ||
    voices[0] ||
    null;
}
if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = loadVoices;

function gihariSpeak(text) {
  if (!("speechSynthesis" in window) || !text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "he-IL";
  utter.rate = 1.03;
  utter.pitch = 1.0;
  if (gihariVoice) utter.voice = gihariVoice;
  speechSynthesis.speak(utter);
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

    const realEvents = Object.values(events).filter(
      (ev) => !isDefaultEvent(ev) && matchesQuickOwnerFilter(ev, state.ui.calendarOwnerFilter || "all")
    );
    
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

    let eventCount = 0;
    realEvents.forEach((ev) => {
      const dot = document.createElement("div");
      dot.className = "event-dot";
      if (ev.type === "task") dot.classList.add("task");
      if (ev.owner) dot.classList.add(`owner-${ev.owner}`);
      pointsRow.appendChild(dot);
      eventCount++;
    });

    if (realEvents.length > 0) cell.appendChild(pointsRow);
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
  if (pastMissed.length > 0) {
    btn.classList.remove("hidden");
    btn.textContent = `⏭️ העבר ${pastMissed.length} שחלפו להיום`;
    btn.onclick = () => rolloverPastUncompletedToToday("all");
  } else {
    btn.classList.add("hidden");
  }
}

async function rolloverPastUncompletedToToday(typeFilter = "all") {
  const items = getPastUncompletedItemsForUser(typeFilter);
  if (!items.length) {
    showToast("אין פריטים שחלפו להעברה להיום");
    return;
  }
  const todayKey = dateKeyFromDate(new Date());
  if (!state.cache.events[todayKey]) state.cache.events[todayKey] = {};

  for (const item of items) {
    const id = item._id || item.id;
    const oldDk = item.dateKey;
    if (!id || !oldDk || oldDk === todayKey) continue;

    const updatedObj = {
      ...item,
      _id: id,
      dateKey: todayKey
    };
    delete updatedObj.effectiveDuration;

    state.cache.events[todayKey][id] = updatedObj;
    if (state.cache.events[oldDk]) {
      delete state.cache.events[oldDk][id];
    }

    try {
      await set(ref(db, `events/${todayKey}/${id}`), updatedObj);
      await remove(ref(db, `events/${oldDk}/${id}`));
    } catch (e) {
      console.warn("Rollover error:", e);
    }
  }

  renderCalendar();
  renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
  try { updateStats(); } catch {}
  showToast(`⏭️ הועברו ${items.length} פריטים להיום!`);
}

// =========================
// Tasks
// =========================
function renderTasks(filter = "undated") {
  updateRolloverMissedButton();
  const list = el("tasksList");
  if (!list) return;
  list.innerHTML = "";
  const allTasks = [];

  Object.entries(state.cache.events).forEach(([dateKey, items]) => {
    Object.entries(items || {}).forEach(([id, ev]) => {
      // ⛔ לא מציג פריטים שבוצעו
      if (ev.completed === true) return;

      // סינון מהיר לפי משתמש (הכל / רק שלי / משותף)
      if (!matchesQuickOwnerFilter(ev, state.ui.tasksOwnerFilter || "all")) return;

      // ⛔ חסימה מוחלטת של מופעי חזרות (משימות + אירועים)
      if (ev.isRecurringInstance === true) {
        return;
      }

      // משימות רגילות – רק אם זה לא מופע
      if (ev.type === "task" && !ev.isRecurringInstance) {
        allTasks.push({ id, dateKey, ...ev });
        return;
      }

      // אירועים רגילים (לא חוזרים) – ❌ בלי ברירת מחדל
      if (
        ev.type === "event" &&
        (!ev.recurring || ev.recurring === "none") &&
        !isDefaultEvent(ev)
      ) {
        allTasks.push({ id, dateKey, ...ev });
        return;
      }
      // אירועים חוזרים בלבד
      if (
        ev.type === "event" &&
        ev.recurring &&
        ev.recurring !== "none" &&
        ev.isRecurringParent === true
      ) {
        allTasks.push({
          id,
          dateKey,
          ...ev,
          __recurringEvent: true
        });
      }
    });
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

  // קודם מתוארכות
  if (aHasDate && bHasDate) {
    return a.dateKey.localeCompare(b.dateKey);
  }

  // מתוארכת לפני לא מתוארכת
  if (aHasDate && !bHasDate) return -1;
  if (!aHasDate && bHasDate) return 1;

  // שתיהן ללא תאריך → לפי דחיפות
  const ua = urgencyRank[a.urgency || "none"];
  const ub = urgencyRank[b.urgency || "none"];
  return ua - ub;
});

 const filtered = allTasks.filter((task) => {
  const hasDate = task.dateKey && task.dateKey !== "undated";
  const isRecurringParent = task.isRecurringParent === true;

  switch (filter) {

    // משימות
    case "undated":
      return task.type === "task" && !hasDate;

    case "dated":
      return task.type === "task" && hasDate && !isRecurringParent;

    case "recurring":
      return task.type === "task" && isRecurringParent;

    // אירועים
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

  filtered.forEach((task) => {
    const item = document.createElement("div");
    item.className = "task-item";

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title || "(ללא כותרת)";
    if (task.__recurringEvent) {
  title.textContent += " (אירוע חוזר)";
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
    if (task.duration) parts.push(`${task.duration} דק'`);
    if (task.urgency) {
      const map = { today: "היום", week: "השבוע", month: "החודש", none: "לא דחוף" };
      parts.push(`דחיפות: ${map[task.urgency] || task.urgency}`);
    }
    const remLabel = formatReminderLabel(task);
    if (remLabel) parts.push(remLabel);
    meta.textContent = parts.join(" • ");

    const actions = document.createElement("div");
    actions.className = "task-actions";

    if (filter === "recurring") {

      
      const delAllBtn = document.createElement("button");
      delAllBtn.className = "ghost-pill small";
      delAllBtn.textContent = "🗑 מחק הכל";
      delAllBtn.onclick = () => deleteTaskSmart(task);
      actions.appendChild(delAllBtn);
    }

    // מחיקה רגילה (ללא תאריך / עם תאריך)
if (filter !== "recurring") {
  const delBtn = document.createElement("button");
  delBtn.className = "ghost-pill small";
  delBtn.textContent = "🗑 מחיקה";
  delBtn.onclick = () => deleteTaskSmart(task);
  actions.appendChild(delBtn);
}
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
  if (!el("dayModal")?.classList.contains("hidden")) renderDayEvents(task.dateKey);
  try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }

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
  ensureDefaultDayEvents(date).then(() => {
  renderDayEvents(dateKey);
});


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

const list = Object.entries(events)
  .map(([id, ev]) => ({ id, ...ev }))
  .sort((a, b) => {
    const aHasTime = !!a.startTime;
    const bHasTime = !!b.startTime;

    // מי שיש לו שעה – תמיד קודם
    if (aHasTime && !bHasTime) return -1;
    if (!aHasTime && bHasTime) return 1;

    // לשניהם יש שעה → מיין לפי שעה
    if (aHasTime && bHasTime) {
      return a.startTime.localeCompare(b.startTime);
    }

    // לשניהם אין שעה → השאר בסוף, בלי להזיז
    return 0;
  });

  list.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "card";
    if (ev.owner) card.classList.add(`owner-${ev.owner}`);

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = ev.title || "(ללא כותרת)";

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
    parts.push(ev.type === "task" ? "משימה" : "אירוע");
    const remLabel = formatReminderLabel(ev);
    if (remLabel) parts.push(remLabel);
    meta.textContent = parts.join(" • ");

    const desc = document.createElement("div");
    desc.className = "task-meta";
    desc.textContent = ev.description || "";

    const actions = document.createElement("div");
    actions.className = "task-actions";

    // =========================
    // DONE BUTTON (DAY MODAL)
    // =========================
    if (!isDefaultEvent(ev)) {
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
    }

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

    card.appendChild(header);
    card.appendChild(meta);
    if (ev.description) card.appendChild(desc);
    card.appendChild(actions);

    container.appendChild(card);
  });
}


// =========================
// Edit modal + CRUD
// =========================
function openEditModal({ dateKey, id } = {}) {
  const modal = el("editModal");
  const form = el("editForm");
  if (!modal || !form) return;

  modal.classList.remove("hidden");
  form.reset();

  const dk = dateKey || dateKeyFromDate(state.currentDate);
  form.elements["date"].value = dk;
  form.elements["owner"].value = state.currentUser;

  form.dataset.editDateKey = dk || "";
  form.dataset.editId = id || "";

  // אם עריכה - למלא
  if (id && dk && state.cache.events[dk] && state.cache.events[dk][id]) {
    const ev = state.cache.events[dk][id];
    form.elements["type"].value = ev.type || "event";
    form.elements["owner"].value = ev.owner || state.currentUser;
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
  }

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
  if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
  state.cache.events[dateKey][existingId] = { ...eventObj, _id: existingId };
  el("editModal").classList.add("hidden");
  renderCalendar();
  renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden")) renderDayEvents(dateKey);
  const rTs = getEventReminderTimestamp(eventObj, dateKey);
  if (rTs && rTs > Date.now()) {
    scheduleDirectReminder({ id: existingId, dateKey, ev: { ...eventObj, _id: existingId }, targetTs: rTs });
    showToast(`🔔 עודכן! תזכורת ב-${formatTimeHM(new Date(rTs))}`, 3500);
  } else {
    cancelDirectReminder(`${dateKey}/${existingId}`);
    showToast("עודכן", 2500);
  }
  update(ref(db, `events/${dateKey}/${existingId}`), eventObj);
} else {
  const newRef = push(ref(db, `events/${dateKey}`));
  const newId = newRef.key || String(Date.now());
  const fullObj = { ...eventObj, _id: newId };
  if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
  state.cache.events[dateKey][newId] = fullObj;
  el("editModal").classList.add("hidden");
  renderCalendar();
  renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
  if (!el("dayModal")?.classList.contains("hidden")) renderDayEvents(dateKey);
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
    const newRef = push(ref(db, `events/${dateKey}`));
    const newId = newRef.key || String(Date.now());
    const fullObj = { ...newEvent, _id: newId };
    if (!state.cache.events[dateKey]) state.cache.events[dateKey] = {};
    state.cache.events[dateKey][newId] = fullObj;
    el("editModal").classList.add("hidden");
    renderCalendar();
    renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
    if (!el("dayModal")?.classList.contains("hidden")) renderDayEvents(dateKey);
    const rTs = getEventReminderTimestamp(fullObj, dateKey);
    if (rTs && rTs > Date.now()) {
      scheduleDirectReminder({ id: newId, dateKey, ev: fullObj, targetTs: rTs });
      showToast(`🔔 נשמר! תזכורת ב-${formatTimeHM(new Date(rTs))}`, 3500);
    } else {
      showToast("נשמר למרות ההתנגשות", 2500);
    }
    await set(newRef, fullObj);
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
  setActiveScreenMeta("calendarSection");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
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

  // מתגי סינון מהיר בלוח השנה (הכל | רק שלי | משותף)
  const calOwnerBtns = qsa("#calendarOwnerFilter .owner-filter-btn");
  calOwnerBtns.forEach((btn) => {
    btn.onclick = () => {
      calOwnerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.ui.calendarOwnerFilter = btn.dataset.ownerFilter || "all";
      renderCalendar();
    };
  });

  // מתגי סינון מהיר בדף משימות (הכל | רק שלי | משותף)
  const taskOwnerBtns = qsa("#tasksOwnerFilter .owner-filter-btn");
  taskOwnerBtns.forEach((btn) => {
    btn.onclick = () => {
      taskOwnerBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.ui.tasksOwnerFilter = btn.dataset.ownerFilter || "all";
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

  for (const [dk, items] of Object.entries(all)) {
    for (const [id, ev] of Object.entries(items || {})) {
      if (!ev || ev.type !== "event") continue;

      if (isDefaultEvent(ev) && ev.isDefault !== true) {
        await update(ref(db, `events/${dk}/${id}`), { isDefault: true });
      }
    }
  }
}

function initFirebaseListeners() {
  onValue(ref(db, "events"), (snap) => {
    state.cache.events = snap.val() || {};
    migrateDefaultsOnce();
    renderCalendar();
    renderTasks(qs("#tasksTypeSegmented .segmented-btn.active")?.dataset.filter || "undated");
    try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
    checkDueReminders();
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
    state.settings.city = settings.city || null;
    state.settings.cityLat = settings.cityLat || null;
    state.settings.cityLon = settings.cityLon || null;
    state.settings.cityTz = settings.cityTz || null;
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

    state.targets = settings.targets || state.targets;

    el("cityLabel").textContent = state.settings.city || "לא נבחרה";
    el("settingsCityInput").value = state.settings.city || "";
  });
  if (el("targetSleep")) {
    el("targetSleep").value = state.targets["שינה"]?.hours ?? 8;
  }
  if (el("targetWork")) {
    el("targetWork").value = state.targets["עבודה"]?.hours ?? 8;
  }
}

async function saveCitySettings() {
  const city = el("settingsCityInput").value.trim();
  state.settings.city = city || null;
  el("cityLabel").textContent = city || "לא נבחרה";

  try {
    if (state.settings.city) await geocodeCity(state.settings.city);
    await update(ref(db, "settings"), {
      city: state.settings.city,
      cityLat: state.settings.cityLat || null,
      cityLon: state.settings.cityLon || null,
      cityTz: state.settings.cityTz || null
    });
    showToast("נשמר");
  } catch (e) {
    console.error("Failed to save city settings", e);
    await update(ref(db, "settings"), { city: state.settings.city });
    showToast("נשמר");
  }
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

function getAlarmMelodyWavUrl() {
  if (_alarmMelodyWavUrl) return _alarmMelodyWavUrl;
  const sampleRate = 22050;
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
  const noteDur = 0.28;
  const totalSec = notes.length * noteDur + 0.25;
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
      const env = Math.exp(-localT * 5.5) * Math.min(1, localT / 0.01);
      sample = (Math.sin(2 * Math.PI * freq * localT) * 0.75 + Math.sin(4 * Math.PI * freq * localT) * 0.25) * env;
    }
    const pcm = Math.max(-32767, Math.min(32767, Math.floor(sample * 24000)));
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
  audio.preload = "auto";
  audio.style.display = "none";
  document.body.appendChild(audio);

  // אם אנדרואיד מנסה להשהות את האודיו בעת כיבוי המסך כשיש תזכורת פעילה – נחדש מיד!
  audio.addEventListener("pause", () => {
    if (_isAlarmRinging) return;
    if (hasActivePendingReminders() && areNotificationsEnabled()) {
      audio.play().catch(() => {});
    }
  });

  _bgAudioEl = audio;
  return _bgAudioEl;
}

function hasActivePendingReminders() {
  const now = Date.now();
  return Object.values(directReminders).some((r) => r && !r.fired && r.targetTs > now - 5000);
}

function startBackgroundKeepAliveAudio() {
  if (!areNotificationsEnabled()) return;
  if (_isAlarmRinging) return;
  try {
    const audio = getBgAudioPlayer();
    const keepUrl = getKeepAliveWavUrl();
    audio.onended = null;
    audio.onerror = null;
    if (audio.src !== keepUrl) {
      audio.src = keepUrl;
    }
    audio.loop = true;
    audio.volume = 0.05;
    audio.play().catch(() => {});

    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "תזכורת פעילה ביומן 🔔",
          artist: "BNAPP – ג'יחרי מתזכר ברקע",
          album: "BNAPP"
        });
        navigator.mediaSession.playbackState = "playing";
      } catch {}
    }
  } catch {}
}

function stopKeepAliveAudio() {
  if (_isAlarmRinging) return;
  try {
    if (_bgAudioEl) {
      _bgAudioEl.onended = null;
      _bgAudioEl.onerror = null;
      _bgAudioEl.loop = false;
      _bgAudioEl.pause();
    }
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "none"; } catch {}
    }
  } catch {}
}

function warmUpSpeechEngine() {
  try {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const warm = new SpeechSynthesisUtterance(" ");
      warm.lang = "he-IL";
      warm.volume = 0.01;
      speechSynthesis.speak(warm);
    }
  } catch {}
}

document.addEventListener("click", () => {
  getSharedAudioCtx();
  if (hasActivePendingReminders() && areNotificationsEnabled() && !_isAlarmRinging) {
    startBackgroundKeepAliveAudio();
  }
}, { passive: true });

document.addEventListener("touchstart", () => {
  getSharedAudioCtx();
  if (hasActivePendingReminders() && areNotificationsEnabled() && !_isAlarmRinging) {
    startBackgroundKeepAliveAudio();
  }
}, { passive: true });

// צליל אישור קצר בעת לחיצה על הגדרת תזכורת + פתיחת ערוץ שמע ודיבור לרקע/מסך כבוי
function playConfirmTick() {
  try {
    warmUpSpeechEngine();
    const ctx = getSharedAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.13);
  } catch {}
}

function playReminderSound() {
  if (!areNotificationsEnabled()) return;
  try {
    const ctx = getSharedAudioCtx();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.32, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.35);
    });
  } catch (e) {
    console.warn("Audio reminder failed:", e);
  }
}

function speakGihariLoud(text) {
  if (!areNotificationsEnabled() || !text) return;
  try {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.resume();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "he-IL";
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      if (gihariVoice) utter.voice = gihariVoice;
      speechSynthesis.speak(utter);
    }
  } catch {}
}

// מפעיל לולאת שעון מעורר + קריינות קולית של ג'יחרי (עובד גם כשהאתר סגור ברקע וגם כשהמסך כבוי!)
function startAlarmLoop(titleText = "אירוע ביומן") {
  if (!areNotificationsEnabled()) return;
  stopAlarmLoop();
  _isAlarmRinging = true;
  _alarmCycleIndex = 0;
  _currentAlarmTitle = titleText;

  const speechText = `תזכורת מג'יחרי: ${titleText}`;
  const ttsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=he&q=${encodeURIComponent(speechText)}`;
  const alarmUrl = getAlarmMelodyWavUrl();
  const audio = getBgAudioPlayer();

  audio.loop = false;
  audio.volume = 1.0;

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `🔔 תזכורת: ${titleText}`,
        artist: "ג'יחרי – BNAPP",
        album: "BNAPP"
      });
      navigator.mediaSession.playbackState = "playing";
    } catch {}
  }

  const runNextStep = (stepType) => {
    if (!_isAlarmRinging || !areNotificationsEnabled()) return;

    if (stepType === "chime") {
      if (_alarmCycleIndex >= 4) {
        stopAlarmLoop();
        return;
      }
      _alarmCycleIndex++;
      playReminderSound();
      try {
        if (navigator.vibrate) navigator.vibrate([500, 180, 500, 180, 700]);
      } catch {}

      audio.onended = () => runNextStep("tts");
      audio.onerror = () => runNextStep("tts");
      audio.src = alarmUrl;
      audio.volume = 1.0;
      audio.play().catch(() => {
        // אם הניגון נכשל מסיבה כלשהי, נעבור לקריינות אחרי 1.5 שניות
        window._alarmStepTimer = setTimeout(() => runNextStep("tts"), 1500);
      });
    } else if (stepType === "tts") {
      if (!_isAlarmRinging || !areNotificationsEnabled()) return;
      // מפעיל גם קריינות Web Speech וגם קריינות בנגן ה-HTML5 (שפועל גם כשהמסך כבוי!)
      audio.onended = () => {
        if (!_isAlarmRinging) return;
        runNextStep("chime");
      };
      audio.onerror = () => {
        speakGihariLoud(speechText);
        window._alarmStepTimer = setTimeout(() => runNextStep("chime"), 2800);
      };
      audio.src = ttsUrl;
      audio.volume = 1.0;
      audio.play().catch(() => {
        speakGihariLoud(speechText);
        window._alarmStepTimer = setTimeout(() => runNextStep("chime"), 2800);
      });
    }
  };

  runNextStep("chime");
}

function stopAlarmLoop() {
  _isAlarmRinging = false;
  if (hasNativeAndroidBridge()) {
    try { window.AndroidBridge.stopAlarm(); } catch (e) {}
  }
  if (window._alarmLoopTimer) {
    clearInterval(window._alarmLoopTimer);
    window._alarmLoopTimer = null;
  }
  if (window._alarmStepTimer) {
    clearTimeout(window._alarmStepTimer);
    window._alarmStepTimer = null;
  }
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch {}

  if (hasActivePendingReminders() && areNotificationsEnabled()) {
    startBackgroundKeepAliveAudio();
  } else {
    stopKeepAliveAudio();
  }
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
  if (!areNotificationsEnabled()) return;
  const tag = tagKey || `bnapp-rem-${Date.now()}`;
  try {
    postToServiceWorker({
      type: "TRIGGER_SW_NOTIFICATION_NOW",
      key: tag,
      title,
      body
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
            vibrate: [500, 180, 500, 180, 700],
            requireInteraction: true,
            renotify: true,
            tag
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
    title: `🔔 תזכורת BNAPP: ${title}`,
    body: `${title} • ${timeInfo}`,
    targetTs: Number(targetTs)
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
  if (!areNotificationsEnabled()) return;
  const { id, dateKey, ev } = item;
  if (id !== "test" && id !== "test-manual" && ev && !shouldRemindCurrentUser(ev)) {
    return;
  }
  const titleText = ev?.title || "אירוע / משימה";
  const timeInfo = ev?.startTime ? `שעה: ${ev.startTime}` : (ev?.reminderTime ? `שעת תזכורת: ${ev.reminderTime}` : "");
  const notifBody = timeInfo ? `${titleText} • ${timeInfo}` : titleText;

  // מפעיל גם את מנגנון השעון המעורר וגם קריינות קולית של ג'יחרי (עובד גם ברקע וגם כשהמסך כבוי!)
  startAlarmLoop(titleText);

  // התראת מערכת
  showSystemNotification(`🔔 תזכורת: ${titleText}`, notifBody, `${dateKey}-${id}-${Date.now()}`);

  // חלון התראה קופץ באפליקציה (מעל כל המודאלים!)
  const modal = el("reminderAlertModal");
  if (modal) {
    el("reminderAlertTitle").textContent = titleText;
    el("reminderAlertMeta").textContent = timeInfo || "הגיע זמן התזכורת שהגדרת!";
    modal.classList.remove("hidden");

    el("btnReminderDone").onclick = () => {
      stopAlarmLoop();
      modal.classList.add("hidden");
      if (id && id !== "test" && id !== "test-manual") {
        toggleTaskDone({ ...ev, id, _id: id, dateKey });
      }
    };

    el("btnReminderSnooze").onclick = async () => {
      stopAlarmLoop();
      modal.classList.add("hidden");
      const snoozeTs = Date.now() + 10 * 60 * 1000;
      const snoozeDate = new Date(snoozeTs);
      const targetId = id || "snooze";
      const targetDk = dateKey || dateKeyFromDate(new Date());

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
      showToast("⏰ נדחה ב-10 דקות (ספירה לאחור פעילה למעלה)");
      if (targetId !== "test" && targetId !== "test-manual") {
        await update(ref(db, `events/${targetDk}/${targetId}`), {
          reminderCustomTs: snoozeTs,
          reminderDate: dateKeyFromDate(snoozeDate),
          reminderTime: formatTimeHM(snoozeDate),
          ...clearRem
        });
      }
    };

    el("btnReminderDismiss").onclick = () => {
      stopAlarmLoop();
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
  "עבודה",
  "אוכל ומקלחת",
  "אוכל + מקלחת",
  "זמן פנוי"
];

const SMART_EVENT_DOMAINS = [
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
  if (t === "אוכל + מקלחת" || t === "אוכל" || t === "מקלחת") return "אוכל ומקלחת";
  return t;
}

function detectSmartDomainCategory(rawTitle) {
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

  const addBreakdownItem = (catLabel, ev, durMins) => {
    if (!categoryBreakdown[catLabel]) categoryBreakdown[catLabel] = [];
    categoryBreakdown[catLabel].push({
      _id: ev._id || ev.id,
      title: ev.title || "(ללא כותרת)",
      dateKey: ev.dateKey || "undated",
      startTime: ev.startTime || null,
      endTime: ev.endTime || null,
      owner: ev.owner || "shared",
      type: ev.type || "event",
      effectiveDuration: durMins
    });
  };

  dates.forEach((date) => {
    const dk = dateKeyFromDate(date);
    // 1440 דקות ביממה (24 שעות = 100%)
    // 00:00-07:00 (0..419) -> 7 שעות שינה
    // 07:00-17:00 (420..1019) -> 10 שעות עבודה
    // 17:00-18:00 (1020..1079) -> 1 שעה אוכל ומקלחת
    // 18:00-00:00 (1080..1439) -> 6 שעות זמן פנוי
    const dayTimeline = new Array(1440);
    for (let m = 0; m < 420; m++) dayTimeline[m] = "שינה";
    for (let m = 420; m < 1020; m++) dayTimeline[m] = "עבודה";
    for (let m = 1020; m < 1080; m++) dayTimeline[m] = "אוכל ומקלחת";
    for (let m = 1080; m < 1440; m++) dayTimeline[m] = "זמן פנוי";

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

    dayItems.forEach((ev) => {
      if (!ev) return;
      if (!isEventRelevantForUser(ev, user)) return;
      if (isDefaultEvent(ev)) return;

      const isRoutine = isRoutineStatEvent(ev);
      const isDone = Boolean(ev.completed || ev.completedAt);

      // רק משימות ואירועים שסומנו כבוצעו נכנסים לעוגה (למעט אירועי שגרה)
      if (!isRoutine && !isDone) return;

      const rawClean = normalizeStatCategoryTitle(ev.title);
      const label = resolveCategory(ev.title);
      const sig = `${rawClean}|${ev.owner || "shared"}|${ev.startTime || ""}|${ev.endTime || ""}|${ev.type || ""}`;
      if (seen.has(sig)) return;
      seen.add(sig);

      let dur = getEffectiveDurationMinutes(ev);
      if (dur <= 0) dur = 60;

      if (!isRoutine) {
        addBreakdownItem(label, ev, dur);
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
      const replaceOrder = ["זמן פנוי", "עבודה", "אוכל ומקלחת", "שינה"];
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
      else if (cat === "עבודה") workMinutes++;
      else if (cat === "אוכל ומקלחת") foodShowerMinutes++;
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
  const weeks = (stats.totalDays || 1) / 7;
  const userGoals = state.goals?.[state.currentUser] || {};

  Object.values(userGoals).forEach((g) => {
    if (!g || !g.title || !g.weeklyHours) return;

    let actualHours = 0;
    const normGoal = normalizeStatCategoryTitle(g.title);

    if (normGoal === "שינה") {
      actualHours = stats.sleepMinutes / 60;
    } else if (normGoal === "עבודה") {
      actualHours = stats.workMinutes / 60;
    } else if (normGoal === "אוכל ומקלחת") {
      actualHours = stats.foodShowerMinutes / 60;
    } else if (normGoal === "זמן פנוי") {
      actualHours = stats.freeMinutes / 60;
    } else {
      actualHours = (stats.otherMap[normGoal] || 0) / 60;
    }

    const target = g.weeklyHours * weeks;
    const diff = actualHours - target;

    let status = "ok";
    if (diff < -0.5) status = "low";
    if (diff > 0.5) status = "high";

    results.push({
      title: g.title,
      diff,
      status
    });
  });

  return results;
}

function formatShortDateHe(dk) {
  if (!dk || dk === "undated") return "ללא תאריך";
  const parts = dk.split("-");
  if (parts.length !== 3) return dk;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
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

      // אם זה אב של סדרה חוזרת ויש לו מופע באותו יום, נדלג על האב כדי לא לספור פעמיים
      if (ev.isRecurringParent && ev.recurring && ev.recurring !== "none") {
        const instanceId = `${id}_${dk}`;
        if (dayEvents[instanceId]) return;
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
    return (a.startTime || "23:59").localeCompare(b.startTime || "23:59");
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

  if (titleEl) titleEl.textContent = `📊 פירוט קטגוריה: ${categoryLabel}`;
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
                <button type="button" class="ghost-pill small"
                  onclick="toggleTaskDone({ _id: '${safeId}', dateKey: '${safeDk}', completed: true }); document.getElementById('statCategoryBreakdownModal').classList.add('hidden');">
                  ↩ בטל בוצע
                </button>
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

    const periodWord =
      stats.totalDays === 1
        ? "אתמול"
        : stats.totalDays === 7
          ? "שבוע שעבר"
          : "התקופה הקודמת";

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
    { label: "אוכל ומקלחת", hours: foodShowerHours },
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
        return `
          <div class="stats-legend-item clickable-legend" data-cat-label="${safeLabel}" title="לחץ לפירוט הקטגוריה">
            <span class="stats-legend-dot" style="background:${color};"></span>
            <span class="stats-legend-text">
              <strong>${label}${countBadge}</strong>
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

  // ---- סיכום יעדים ----
  const summaryEl = el("statsSummary");
  if (summaryEl) {
    const targetStatuses = computeTargetStatuses(stats);
    summaryEl.innerHTML = targetStatuses
      .map((t) => {
        const diff = Math.abs(t.diff).toFixed(1);
        const text =
          t.status === "high"
            ? `אקסטרה ${diff} ש׳`
            : t.status === "low"
              ? `חסר ${diff} ש׳`
              : `מדויק ביעד`;
        const textColor =
          t.status === "high"
            ? "#4ade80"
            : t.status === "low"
              ? "#f87171"
              : "#60a5fa";
        const dotColor = GOAL_COLORS[t.title] || "#9ca3af";
        return `
          <div class="stats-goal-chip" style="color:${textColor}">
            <span class="stats-legend-dot" style="background:${dotColor};"></span>
            <strong>${t.title}:</strong> <span>${text}</span>
          </div>
        `;
      })
      .join("");
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

  document.querySelectorAll("[data-close-postpone]").forEach((b) => {
    b.onclick = () => el("postponeModal")?.classList.add("hidden");
  });

el("postponeOk").onclick = () => {
  const date = el("postponeDateInput").value;
  const time = el("postponeTimeInput").value || _postponeTask.startTime;

  if (!date) return;

  moveTaskToDate(_postponeTask, date, time);
  el("postponeModal").classList.add("hidden");
};
}
async function deleteTaskSmart(task) {
  const id = task._id || task.id;
  if (!id || !task.dateKey) return;

  // אם זה אב של חזרה – מוחקים רק מופעים עתידיים
  if (task.isRecurringParent) {
    const now = new Date();

    Object.entries(state.cache.events).forEach(([dk, items]) => {
      const d = parseDateKey(dk);
      if (d < now) return; // ⛔ לא מוחקים עבר

      Object.entries(items || {}).forEach(([cid, ev]) => {
        if (ev.parentId === id) {
          remove(ref(db, `events/${dk}/${cid}`));
        }
      });
    });

    // מוחקים את האב עצמו
    await remove(ref(db, `events/${task.dateKey}/${id}`));

    showToast("נמחקו מופעים עתידיים");
  } else {
    // מחיקה רגילה
    await remove(ref(db, `events/${task.dateKey}/${id}`));
    showToast("נמחק");
  }

  // סגירת חלוניות
  el("editModal")?.classList.add("hidden");
  el("dayModal")?.classList.add("hidden");
}
// ===============================
// Recurring materializer
async function materializeRecurringTask(task) {
  if (!task || !task.dateKey || !task._id) return;

  const start = parseDateKey(task.dateKey);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dk = dateKeyFromDate(d);

    if (task.recurring === "weekly" && d.getDay() !== start.getDay()) continue;
    if (task.recurring === "monthly_greg" && d.getDate() !== start.getDate()) continue;
    if (
      task.recurring === "yearly_greg" &&
      (d.getDate() !== start.getDate() || d.getMonth() !== start.getMonth())
    ) continue;

    const id = `${task._id}_${dk}`;
    await set(ref(db, `events/${dk}/${id}`), {
      ...task,
      _id: id,
      parentId: task._id,
      isRecurringInstance: true,
      dateKey: dk
    });
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
function openGoalsModal() {
  const modal = el("goalsModal");
  if (!modal) return;

  modal.classList.remove("hidden");

  // קובע בעלים לפי המשתמש הנוכחי
  const ownerSelect = el("goalOwner");
  if (ownerSelect) {
    ownerSelect.value = state.currentUser;
  }

  renderGoals();

  // סגירה ב־X או רקע
  modal.querySelectorAll("[data-close-goals]").forEach(b => {
    b.onclick = () => modal.classList.add("hidden");
  });

  const backdrop = modal.querySelector(".modal-backdrop");
  if (backdrop) backdrop.onclick = () => modal.classList.add("hidden");
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

    el("goalsModal").classList.add("hidden");
    renderGoals();
    try { updateStats(); } catch (e) { console.warn("updateStats error:", e); }
  };

  // =========================
  // Stats range selector & custom dates
  // =========================
  const rangeButtons = document.querySelectorAll("#statsRangeSelector .segmented-btn");
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
  el("btnThemeToggle").onclick = toggleTheme;
  el("btnRequestNotifications").onclick = requestNotifications;
  if (el("btnTestNotificationNow")) {
    el("btnTestNotificationNow").onclick = testNotificationNow;
  }
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}





                                
