// BNAPP V3.5.2 – לוגיקה ראשית
// דורש:
// - firebase-config.js (db)
// - Chart.js (global Chart)
// - hebcal.noloc.min.js (global Hebcal) - עם fallback אם לא נטען

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}


import { ref, onValue, set, push, update, remove } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";
import { db } from "./firebase-config.js";
import {
  getMessaging,
  getToken
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging.js";

import { firebaseApp } from "./firebase-config.js";

const messaging = getMessaging(firebaseApp);


const state = {
  currentUser: "binyamin",
  currentDate: new Date(),
  statsRange: "week",

  settings: {
    city: null,
    cityLat: null,
    cityLon: null,
    cityTz: null
  },

  cache: {
    events: {},
    shopping: {},
    holidays: {},
    holidaysLoadedYear: null,
    shabbat: {}
  },

  ui: {
    darkMode: false,
    notificationsGranted: false
  },

  // מטרות שבועיות – מנוהלות מדף סטטיסטיקות
goals: {
  binyamin: {},
  nana: {}
}
};

const GOAL_COLORS = {
  "שינה": "#60a5fa",   // תכלת
  "עבודה": "#ef4444", // אדום
  "אוכל + מקלחת": "#f59e0b" // כתום
};

let editingGoalId = null;

const el = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
function isDefaultEvent(ev) {
  if (!ev) return false;

  // תופס גם true וגם "true" וגם 1
  if (
    ev.isDefault === true ||
    ev.isDefault === "true" ||
    ev.isDefault === 1 ||
    ev.isDefault === "1"
  ) return true;

  // גיבוי לדאטה ישן
  const t = (ev.title || "").trim();
  const owner = ev.owner || "";

  if (ev.type === "event" && owner === "shared") {
    if (t === "שינה" && ev.startTime === "00:00" && ev.endTime === "08:00") return true;
    if (t === "עבודה" && ev.startTime === "08:00" && ev.endTime === "17:00") return true;
    if (t === "אוכל + מקלחת" && ev.startTime === "17:00" && ev.endTime === "18:30") return true;
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
  const titles = Object.values(existing).map(e => e.title);

  const toCreate = [];

  // שינה – תמיד
  if (!titles.includes("שינה")) {
    toCreate.push({
      type: "event",
      owner: "shared",
      title: "שינה",
      startTime: "00:00",
      endTime: "08:00",
      dateKey,
      isDefault: true
    });
  }

  // ימי חול
  if (day >= 0 && day <= 4) {
    if (!titles.includes("עבודה")) {
      toCreate.push({
        type: "event",
        owner: "shared",
        title: "עבודה",
        startTime: "08:00",
        endTime: "17:00",
        dateKey,
        isDefault: true
      });
    }

    if (!titles.includes("אוכל + מקלחת")) {
      toCreate.push({
        type: "event",
        owner: "shared",
        title: "אוכל + מקלחת",
        startTime: "17:00",
        endTime: "18:30",
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

function showToast(text = "בוצע") {
  const t = el("toast");
  if (!t) return;
  t.textContent = text;
  t.classList.remove("hidden");
setTimeout(() => t.classList.add("hidden"), 500);
}

function applyBackground(bg) {
  document.body.className =
    document.body.className.replace(/bg-\d+/g, "");
  document.body.classList.add("bg-" + bg);
  localStorage.setItem("appBackground", bg);
}

const savedBg = localStorage.getItem("appBackground");
if (savedBg) applyBackground(savedBg);

document.querySelectorAll("#bgSelector button").forEach(btn => {
  btn.onclick = () => applyBackground(btn.dataset.bg);
});


// ===============================
// Notifications – Request Permission
// ===============================
const btnNotif = document.getElementById("btnRequestNotifications");

if (btnNotif) {
  btnNotif.onclick = async () => {
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      alert("חייב לאשר התראות כדי שזה יעבוד");
      return;
    }

    const token = await getToken(messaging, {
      vapidKey: "BFzkYCDuV_Ij_b3PQtswrDNnPe4xTVUbxYBJKkLx7YEkERrgOSOYC6KeZ1kNUuABeQV1GZ_xYIVnbU27Rseozss"
    });

    console.log("FCM TOKEN:", token);
    alert("התראות הופעלו בהצלחה");
  };

  
}
const btnDisableNotif = document.getElementById("btnDisableNotifications");

if (btnDisableNotif) {
  btnDisableNotif.onclick = () => {
    localStorage.setItem("notificationsEnabled", "false");
    alert("התראות כובו");
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
  ev => !isDefaultEvent(ev)
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
Object.values(events).forEach((ev) => {
  // ❌ לא מציג נקודה לאירועי ברירת מחדל
if (isDefaultEvent(ev)) return;

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
}

// =========================
// Tasks
// =========================
function renderTasks(filter = "undated") {
  const list = el("tasksList");
  if (!list) return;
  list.innerHTML = "";
  const allTasks = [];

Object.entries(state.cache.events).forEach(([dateKey, items]) => {
  Object.entries(items || {}).forEach(([id, ev]) => {

    
    // ⛔ לא מציג פריטים שבוצעו
if (ev.completed === true) return;


    // ⛔ חסימה מוחלטת של מופעי חזרות (משימות + אירועים)
if (ev.isRecurringInstance === true) {
  return;
}

  // משימות רגילות – רק אם זה לא מופע
if (ev.type === "task" && !ev.isRecurringInstance) {
  allTasks.push({ id, dateKey, ...ev });
  return;
}

    // אירועים רגילים (לא חוזרים)
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

    const postponeBtn = document.createElement("button");
    postponeBtn.className = "ghost-pill small";
    postponeBtn.textContent = "דחיה";
    postponeBtn.onclick = () => openPostponeModal(task);

    actions.appendChild(doneBtn);
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

  const isDone = !!task.completed;

  update(ref(db, `events/${task.dateKey}/${id}`), {
    completed: !isDone,
    completedAt: isDone ? null : Date.now()
  });

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
    meta.textContent = parts.join(" • ");

    const desc = document.createElement("div");
    desc.className = "task-meta";
    desc.textContent = ev.description || "";

    const actions = document.createElement("div");
    actions.className = "task-actions";

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
    form.elements["recurring"].value = ev.recurring || "none";
    form.elements["urgency"].value = ev.urgency || "none";
  }

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
  const bd = qs(".modal-backdrop", modal);
  if (bd) bd.onclick = () => modal.classList.add("hidden");
// =========================
  // Live time validation (before save)
  // =========================
  const startInput = form.elements["startTime"];
  const endInput = form.elements["endTime"];

  function validateTimesLive() {
    const start = startInput.value;
    const end = endInput.value;

    if (start && end && isEndBeforeStart(start, end)) {
      showToast("⛔ שעת סיום חייבת להיות אחרי שעת התחלה");
      endInput.value = "";
      endInput.focus();
    }
  }

  startInput.onchange = validateTimesLive;
  endInput.onchange = validateTimesLive;
  
}

async function handleEditFormSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;

  const data = Object.fromEntries(new FormData(form).entries());

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
    reminderMinutes: data.reminderMinutes ? Number(data.reminderMinutes) : null,
    recurring: data.recurring || "none",
    urgency: data.urgency || "none"
  };

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
  await update(ref(db, `events/${dateKey}/${existingId}`), eventObj);
  showToast("עודכן");
  el("editModal").classList.add("hidden");
} else {
  const newRef = push(ref(db, `events/${dateKey}`));
  await set(newRef, { ...eventObj, _id: newRef.key });

  if (eventObj.recurring && eventObj.recurring !== "none") {
    const parentTask = { ...eventObj, _id: newRef.key, parentId: null, isRecurringParent: true };
    await update(newRef, parentTask);
    await materializeRecurringTask(parentTask);
  }

  showToast("נשמר");
  el("editModal").classList.add("hidden");
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
    await set(newRef, { ...newEvent, _id: newRef.key });

    showToast("נשמר למרות ההתנגשות");
    el("editModal").classList.add("hidden");
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
function initBottomNav() {
  const btns = qsa(".bottom-nav .nav-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
      qsa(".screen").forEach((s) => s.classList.remove("active"));
      el(targetId)?.classList.add("active");
    });
  });
}

function initTasksFilters() {
  const btns = qsa("#tasksSection .segmented-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTasks(btn.dataset.filter);
    });
  });
}

function initShopping() {
  const listTabs = qsa("#shoppingSection .segmented-btn");
  listTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      listTabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderShoppingList();
    });
  });
  el("btnAddShopping").onclick = addShoppingItem;
}

function getCurrentShoppingListKey() {
  const active = qs("#shoppingSection .segmented-btn.active");
  return active ? (active.dataset.list || "default") : "default";
}

function addShoppingItem() {
  const input = el("shoppingInput");
  const text = (input.value || "").trim();
  if (!text) return;
  const listKey = getCurrentShoppingListKey();
  const newRef = push(ref(db, `shopping/${listKey}`));
  set(newRef, { text, completed: false });
  input.value = "";
}

function renderShoppingList() {
  const ul = el("shoppingList");
  if (!ul) return;
  ul.innerHTML = "";

  const listKey = getCurrentShoppingListKey();
  const itemsObj = state.cache.shopping[listKey] || {};
  Object.entries(itemsObj).forEach(([id, item]) => {
    const li = document.createElement("li");
    li.className = "shopping-item";
    if (item.completed) li.classList.add("completed");

    const label = document.createElement("span");
    label.textContent = item.text;

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "ghost-pill small";
    toggleBtn.textContent = item.completed ? "בטל ✔" : "✔";
    toggleBtn.onclick = () => update(ref(db, `shopping/${listKey}/${id}`), { completed: !item.completed });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ghost-pill small";
    deleteBtn.textContent = "🗑";
    deleteBtn.onclick = async () => {
      await remove(ref(db, `shopping/${listKey}/${id}`));
      showToast("נמחק");
    };

    li.appendChild(label);
    li.appendChild(toggleBtn);
    li.appendChild(deleteBtn);
    ul.appendChild(li);
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
    renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
    updateStats();
  });

  onValue(ref(db, "goals"), snap => {
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

function requestNotifications() {
  if (!("Notification" in window)) return;
  Notification.requestPermission().then((perm) => {
    state.ui.notificationsGranted = perm === "granted";
    showToast(state.ui.notificationsGranted ? "התראות הופעלו" : "התראות נחסמו");
  });
}

function scheduleLocalReminder(ev) {
  if (!state.ui.notificationsGranted) return;
  if (!ev.dateKey || !ev.reminderMinutes || !ev.title) return;

  const [h, m] = (ev.startTime || "09:00").split(":").map(Number);
  const d = parseDateKey(ev.dateKey);
  d.setHours(h, m, 0, 0);
  const reminderTime = new Date(d.getTime() - ev.reminderMinutes * 60000);
  const delay = reminderTime.getTime() - Date.now();
  if (delay <= 0) return;

  setTimeout(() => {
    if (Notification.permission === "granted") {
      new Notification("תזכורת BNAPP", { body: ev.title, tag: `bnapp-${ev.dateKey}-${ev.title}` });
    }
  }, Math.min(delay, 2147483647));
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

function getRangeDates(range) {
  const base = new Date(state.currentDate);
  base.setHours(12, 0, 0, 0);

  // 🔥 תמיד מסתכלים אחורה
  if (range === "day") {
    base.setDate(base.getDate() - 1);
  }

  if (range === "week" || range === "2weeks") {
    // קופצים לשבוע הקודם
    base.setDate(base.getDate() - 7);
  }

  if (range === "month") {
    // קופצים לחודש הקודם
    base.setMonth(base.getMonth() - 1);
  }

  if (range === "year") {
    // קופצים לשנה הקודמת
    base.setFullYear(base.getFullYear() - 1);
  }


  const dates = [];

  const addDays = (count) => {
    for (let i = 0; i < count; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      dates.push(d);
    }
  };

  switch (range) {
    case "day": addDays(1); break;
    case "week": addDays(7); break;
    case "2weeks": addDays(14); break;

    case "month": {
      const y = base.getFullYear();
      const m = base.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      for (let i = 1; i <= days; i++) {
        dates.push(new Date(y, m, i, 12));
      }
      break;
    }

    case "year": {
      const y = base.getFullYear();
      for (let m = 0; m < 12; m++) {
        const days = new Date(y, m + 1, 0).getDate();
        for (let d = 1; d <= days; d++) {
          dates.push(new Date(y, m, d, 12));
        }
      }
      break;
    }

    default:
      addDays(7);
  }

  return dates;
}

function isEventRelevantForUser(ev, user) {
  if (!ev || !ev.owner) return false;
  if (ev.owner === "shared") return true;
  return ev.owner === user;
}

function computeStats({ user, range }) {
  const dates = getRangeDates(range);

  const totalMinutesCapacity = dates.length * 24 * 60;

  let sleepMinutes = 0;
  let workMinutes = 0;
  let otherMap = {};

  dates.forEach(date => {
    const dk = dateKeyFromDate(date);
    const events = state.cache.events[dk] || {};
    const seen = new Set();

    Object.values(events).forEach(ev => {
      if (!isEventRelevantForUser(ev, user)) return;
      if (!ev.startTime || !ev.endTime) return;

      const ALWAYS_COUNT = ["שינה", "עבודה", "אוכל", "מקלחת"];
const title = (ev.title || "").trim();

// אם זה לא אחד מהקבועים – חייב להיות בוצע
if (!ALWAYS_COUNT.includes(title) && !ev.completed) return;

      const s = timeToMinutes(ev.startTime);
      const e = timeToMinutes(ev.endTime);
      if (e <= s) return;

      const sig = `${ev.title}|${ev.owner}|${s}-${e}|${ev.isDefault}`;
      if (seen.has(sig)) return;
      seen.add(sig);

      const dur = e - s;
     

      if (title === "שינה") sleepMinutes += dur;
      else if (title === "עבודה") workMinutes += dur;
      else otherMap[title] = (otherMap[title] || 0) + dur;
    });
  });

  const used =
    sleepMinutes +
    workMinutes +
    Object.values(otherMap).reduce((a, b) => a + b, 0);

  return {
    totalDays: dates.length,
    sleepMinutes,
    workMinutes,
    otherMap,
    freeMinutes: Math.max(0, totalMinutesCapacity - used)
  };
}

function getCompletedItemsInRange(range, from, to) {
  const tasks = [];
  const events = [];

  // טווח תאריכים ידני (אם קיים)
  const fromTs = from
    ? new Date(from).setHours(0, 0, 0, 0)
    : null;

  const toTs = to
    ? new Date(to).setHours(23, 59, 59, 999)
    : null;

  Object.values(state.cache.events || {}).forEach(dayEvents => {
    Object.values(dayEvents || {}).forEach(ev => {
      if (!ev.completed) return;

      // פילטר לפי משתמש
      if (
        ev.owner !== "shared" &&
        ev.owner !== state.currentUser
      ) return;

      const completedTs = ev.completedAt || 0;

      // פילטר לפי תאריך ביצוע
      if (fromTs && completedTs < fromTs) return;
      if (toTs && completedTs > toTs) return;

      const isEvent = ev.startTime && ev.endTime;
      const item = { ...ev };

      if (isEvent) events.push(item);
      else tasks.push(item);
    });
  });

  return { tasks, events };
}

function computeTargetStatuses(stats) {
  const results = [];

  const weeks =
    state.statsRange === "week" ? 1 :
    state.statsRange === "month" ? 4.345 :
    state.statsRange === "year" ? 52 :
    1;

  // 🔥 כאן התיקון הקריטי
  const userGoals = state.goals?.[state.currentUser] || {};

  Object.values(userGoals).forEach(g => {
    if (!g || !g.title || !g.weeklyHours) return;

    let actualHours = 0;

    if (g.title === "שינה") {
      actualHours = stats.sleepMinutes / 60;
    } else if (g.title === "עבודה") {
      actualHours = stats.workMinutes / 60;
    } else {
      actualHours = (stats.otherMap[g.title] || 0) / 60;
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
function updateStats() {
  const stats = computeStats({
    user: state.currentUser,
    range: state.statsRange || "week"
  });

  const canvas = el("workFreeChart");
  if (!canvas || !window.Chart) return;

  const sleep = stats.sleepMinutes / 60;
  const work  = stats.workMinutes / 60;

  // ---- סיכום יעדים ----
  el("statsSummary")?.remove();
  const summary = document.createElement("div");
  summary.id = "statsSummary";
  summary.style.marginTop = "10px";

summary.innerHTML = computeTargetStatuses(stats).map(t => {
  const diff = Math.abs(t.diff).toFixed(1);

  // טקסט חדש
  const text =
    t.status === "high" ? `אקסטרה ${diff} ש׳` :
    t.status === "low"  ? `חסר ${diff} ש׳` :
    `מדויק`;

  // צבעים חדשים
  const textColor =
    t.status === "high" ? "#16a34a" : // ירוק – אקסטרה
    t.status === "low"  ? "#dc2626" : // אדום – חסר
    "#3b82f6";                         // כחול – מדויק

  const dotColor = GOAL_COLORS[t.title] || "#9ca3af";

  return `
    <div style="display:flex;align-items:center;gap:8px;color:${textColor}">
      <span style="
        width:10px;
        height:10px;
        border-radius:50%;
        background:${dotColor};
        display:inline-block;
      "></span>
      <strong>${t.title}</strong> – ${text}
    </div>
  `;
}).join("");
  canvas.parentElement.appendChild(summary);

  // ---- גרף ----
  const otherLabels = Object.keys(stats.otherMap);
  const otherValues = Object.values(stats.otherMap).map(v => v / 60);
  const freeHours = stats.freeMinutes / 60;

  const labels = ["שינה", "עבודה", ...otherLabels, "זמן פנוי"];
  const data = [sleep, work, ...otherValues, freeHours];
  const total = data.reduce((a, b) => a + b, 0);

  const ctx = canvas.getContext("2d");

  if (!workFreeChart) {
    workFreeChart = new Chart(ctx, {
      type: "doughnut",
      data: {
  labels,
  datasets: [{
    data,
    backgroundColor: labels.map(l => GOAL_COLORS[l] || "#9ca3af")
  }]
},
      options: {
        cutout: "65%",
        plugins: {
          tooltip: {
  callbacks: {
    label: (ctx) => {
      const val = Number(ctx.raw) || 0;

      // 🔥 זה המקור היחיד לאמת
      const dataset = ctx.chart.data.datasets[0].data || [];
      const total = dataset.reduce((a, b) => a + b, 0);

      const pct = total > 0
        ? ((val / total) * 100).toFixed(1)
        : "0.0";

      return `${ctx.label}: ${val.toFixed(2)} ש׳ (${pct}%)`;
    }
  }
}
        }
      }
    });
  } else {
    workFreeChart.data.labels = labels;
    workFreeChart.data.datasets[0].data = data;
    workFreeChart.update();
   

  }
    // --- מאזיני סינון לפי תאריך (סטטיסטיקה) ---
  const fromInput = el("completedFromDate");
  const toInput   = el("completedToDate");

  if (fromInput && !fromInput.dataset.bound) {
    fromInput.dataset.bound = "1";
    fromInput.onchange = () => renderCompletedCards();
  }

  if (toInput && !toInput.dataset.bound) {
    toInput.dataset.bound = "1";
    toInput.onchange = () => renderCompletedCards();
  }


  
  // ברירת מחדל: מהיום עד +30 יום

  if (fromInput && !fromInput.value) {
    const today = new Date();
    fromInput.value = today.toISOString().slice(0, 10);
  }

  if (toInput && !toInput.value) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    toInput.value = d.toISOString().slice(0, 10);
  }

  
 renderCompletedCards();



}



function renderCompletedCards() {
  const container = el("statsCompleted");
  if (!container) return;

  const from = el("completedFromDate")?.value;
  const to   = el("completedToDate")?.value;

  const { tasks, events } = getCompletedItemsInRange(
    state.statsRange || "week",
    from,
    to
  );

  container.innerHTML = "";

  const makeSection = (id, title, items, icon) => {
    if (!items.length) return "";

    return `
      <div class="completed-section">
        <h3 class="completed-header" onclick="toggleCompletedSection('${id}')">
          ${icon} ${title} (${items.length})
        </h3>

        <div id="${id}" class="completed-body hidden">
          <div class="cards-grid">
            ${items.map(i => `
              <div class="stat-card">
                <div class="stat-title">${i.title}</div>
                <div class="stat-meta">👤 ${i.owner}</div>

                ${
                  i.startTime
                    ? `<div class="stat-meta">🕒 ${i.startTime}–${i.endTime}</div>`
                    : i.duration
                      ? `<div class="stat-meta">🕒 ${Math.round(i.duration / 60)} ש׳</div>`
                      : ""
                }

                <div class="stat-meta">📅 ${i.dateKey}</div>

                <button class="ghost-pill small"
                  onclick="toggleTaskDone({
                    _id: '${i._id}',
                    dateKey: '${i.dateKey}',
                    completed: true
                  })">
                  ↩ בטל בוצע
                </button>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  };

  container.innerHTML =
    makeSection("completedTasks", "משימות שבוצעו", tasks, "✔") +
    makeSection("completedEvents", "אירועים שבוצעו", events, "📅");
}
function toggleCompletedSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden");
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

  // ✏️ מצב עריכה
  if (editingGoalId) {
    state.goals[owner][editingGoalId] = {
      ...state.goals[owner][editingGoalId],
      title,
      weeklyHours: hours
    };
  } 
  // ➕ מצב הוספה
  else {
    const id = Date.now();
    state.goals[owner][id] = {
      title,
      weeklyHours: hours
    };
  }

  update(ref(db, "goals"), state.goals);

  // ניקוי מצב
  editingGoalId = null;
  el("goalTitle").value = "";
  el("goalHours").value = "";
  el("btnAddGoal").textContent = "הוסף מטרה";

  el("goalsModal").classList.add("hidden");

// ===== Completed stats default date range =====
const fromInput = el("completedFromDate");
const toInput   = el("completedToDate");

if (fromInput && toInput) {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);

  const future = new Date(today);
  future.setDate(future.getDate() + 30);
  const to = future.toISOString().slice(0, 10);

  fromInput.value = from;
  toInput.value = to;

  fromInput.onchange = () => renderCompletedCards();
  toInput.onchange = () => renderCompletedCards();
}

  
  renderGoals();
  updateStats();
};
// =========================
// Stats range selector
// =========================
const rangeButtons = document.querySelectorAll("#statsRangeSelector .segmented-btn");

rangeButtons.forEach(btn => {
  btn.onclick = () => {
    rangeButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    state.statsRange = btn.dataset.range;
    updateStats();
  };
});
  
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
  el("btnOpenWaze").onclick = openWazeFromForm;

  el("editForm").addEventListener("submit", handleEditFormSubmit);

  renderCalendar();
  renderTasks();
  renderShoppingList();
  updateStats();

  // ===== expose functions for inline HTML handlers =====
window.toggleCompletedSection = toggleCompletedSection;
window.toggleTaskDone = toggleTaskDone;

}

document.addEventListener("DOMContentLoaded", initApp);





                                
