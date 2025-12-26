// BNAPP V3.5.1 – לוגיקה ראשית (מתוקן)
// מניח טעינה של:
// - hebcal.js (window.Hebcal)
// - Chart.js (window.Chart)
// - firebase-config.js שמייצא db

import {
  ref,
  onValue,
  set,
  push,
  update,
  remove
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

import { db } from "./firebase-config.js";

// ---------- helpers ----------
const el = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function safeText(id, value) {
  const n = el(id);
  if (n) n.textContent = value;
}
function safeHtml(id, html) {
  const n = el(id);
  if (n) n.innerHTML = html;
}
function hasHebcal() {
  return window.Hebcal && typeof window.Hebcal.HDate === "function";
}
function showToast(text = "בוצע") {
  const t = el("toast");
  if (!t) return;
  t.textContent = text;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 900);
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
  try {
    if (!hasHebcal()) return "";
    const hd = new window.Hebcal.HDate(date);
    return hd.renderGematriya();
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
function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function isShabbat(date) { return date.getDay() === 6; }
function isFriday(date) { return date.getDay() === 5; }
function formatTimeHM(date) {
  if (!date) return "";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// ---------- state ----------
const state = {
  currentUser: "binyamin",
  currentDate: new Date(),
  settings: { city: null, cityLat: null, cityLon: null, cityTz: null },
  cache: { events: {}, shopping: {}, holidays: {}, holidaysLoadedYear: null, shabbat: {} },
  ui: { darkMode: false, notificationsGranted: false }
};

// ---------- city ----------
function getCity() { return state.settings.city || "ירושלים"; }

// --- Open-Meteo helpers ---
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
    await update(ref(db, "settings"), { cityLat: r.latitude, cityLon: r.longitude, cityTz: r.timezone });
  } catch (e) { console.warn("Failed saving city coords", e); }
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
    if (!hasHebcal() || !window.Hebcal.holidays) return null;
    const events = window.Hebcal.holidays(date, { il: true });
    if (!events || !events.length) return null;
    const e = events[0];
    return e.render ? e.render("he") : (e.desc || null);
  } catch {
    return null;
  }
}

function ensureYearHolidays(year) {
  if (state.cache.holidaysLoadedYear === year) return;
  state.cache.holidaysLoadedYear = year;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = dateKeyFromDate(d);
    const name = hebrewHolidayForDate(new Date(d));
    if (name) state.cache.holidays[key] = { name };
  }
}

// --- Shabbat times cache by Friday ---
async function ensureShabbatForWeek(fridayDate) {
  const fridayKey = dateKeyFromDate(fridayDate);
  if (state.cache.shabbat[fridayKey]) return state.cache.shabbat[fridayKey];
  if (!state.settings.cityLat || !state.settings.cityLon || !state.settings.cityTz) return null;

  const y = fridayDate.getFullYear();
  const m = String(fridayDate.getMonth() + 1).padStart(2, "0");
  const d = String(fridayDate.getDate()).padStart(2, "0");

  // ✅ FIX: היה חסר + לפני "&longitude"
  const url =
    `https://www.hebcal.com/shabbat?cfg=json&latitude=${state.settings.cityLat}` +
    `&longitude=${state.settings.cityLon}` +
    `&tzid=${encodeURIComponent(state.settings.cityTz)}` +
    `&start=${y}-${m}-${d}&end=${y}-${m}-${d}`;

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    const itemCandles = (data.items || []).find((it) => it.category === "candles");
    const itemHavdalah = (data.items || []).find((it) => it.category === "havdalah");
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

// ---------- Theme ----------
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

// ---------- Calendar render ----------
function renderCalendar() {
  const grid = el("calendarGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const currentMonthDate = state.currentDate;
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();

  ensureYearHolidays(year);

  const firstDayOfMonth = new Date(year, month, 1);
  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  safeText("gregMonthLabel", firstDayOfMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" }));
  safeText("hebrewMonthLabel", getHebrewMonthYearLabel(firstDayOfMonth) || "");

  const prevMonthDays = new Date(year, month, 0).getDate();
  const today = new Date();

  const totalCells = 42;
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

    const dk = dateKeyFromDate(cellDate);
    const heb = formatHebrewDate(cellDate);
    const holiday = state.cache.holidays[dk];
    const events = state.cache.events[dk] || {};

    const header = document.createElement("div");
    header.className = "day-header";

    const dayNumEl = document.createElement("div");
    dayNumEl.className = "day-num";
    dayNumEl.textContent = dayNum;

    const hebEl = document.createElement("div");
    hebEl.className = "day-hebrew";
    hebEl.textContent = heb;

    header.appendChild(dayNumEl);
    header.appendChild(hebEl);
    cell.appendChild(header);

    if (holiday) {
      const holidayEl = document.createElement("div");
      holidayEl.className = "day-holiday";
      holidayEl.textContent = holiday.name;
      cell.appendChild(holidayEl);
    }

    // Shabbat block
    let shabbatLabel = null;
    let fridayForTimes = null;
    if (isFriday(cellDate)) { shabbatLabel = "ערב שבת"; fridayForTimes = new Date(cellDate); }
    else if (isShabbat(cellDate)) { shabbatLabel = "שבת"; fridayForTimes = new Date(cellDate); fridayForTimes.setDate(fridayForTimes.getDate() - 1); }

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
      const dot = document.createElement("div");
      dot.className = "event-dot";
      if (ev.type === "task") dot.classList.add("task");
      if (ev.owner) dot.classList.add(`owner-${ev.owner}`);
      pointsRow.appendChild(dot);
      eventCount++;
    });

    if (eventCount > 0) cell.appendChild(pointsRow);
    if (eventCount >= 2) cell.classList.add("day-border-glow");
    if (outside) cell.classList.add("outside");
    if (isSameDay(cellDate, today)) cell.classList.add("day-cell-today");

    cell.addEventListener("click", () => openDayModal(cellDate));
    grid.appendChild(cell);
  }
}

// ---------- Tasks ----------
function renderTasks(filter = "undated") {
  const list = el("tasksList");
  if (!list) return;
  list.innerHTML = "";
  const allTasks = [];

  Object.entries(state.cache.events).forEach(([dateKey, items]) => {
    Object.entries(items || {}).forEach(([id, ev]) => {
      if (ev.type !== "task") return;
      allTasks.push({ id, dateKey, ...ev });
    });
  });

  allTasks.sort((a, b) => (a.dateKey || "").localeCompare(b.dateKey || ""));

  const filtered = allTasks.filter((task) => {
    const hasDate = !!task.dateKey && task.dateKey !== "undated";
    const isRecurring = task.recurring && task.recurring !== "none";
    if (filter === "undated") return !hasDate;
    if (filter === "dated") return hasDate && !isRecurring;
    if (filter === "recurring") return task.isRecurringParent === true;
    return true;
  });

  filtered.forEach((task) => {
    const item = document.createElement("div");
    item.className = "task-item";

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.textContent = task.owner === "shared" ? "משותף" : task.owner === "binyamin" ? "בנימין" : "ננה";
    ownerBadge.classList.add(`badge-owner-${task.owner}`);

    header.appendChild(title);
    header.appendChild(ownerBadge);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const parts = [];
    if (task.dateKey && task.dateKey !== "undated") {
      const d = parseDateKey(task.dateKey);
      parts.push(d.toLocaleDateString("he-IL", { weekday: "short", day: "2-digit", month: "2-digit" }));
    } else parts.push("ללא תאריך");
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

    const doneBtn = document.createElement("button");
    doneBtn.className = "ghost-pill small";
    doneBtn.textContent = "✔ בוצע";
    doneBtn.addEventListener("click", () => markTaskDone(task));

    const postponeBtn = document.createElement("button");
    postponeBtn.className = "ghost-pill small";
    postponeBtn.textContent = "דחיה";
    postponeBtn.addEventListener("click", () => openPostponeModal(task));

    actions.appendChild(doneBtn);
    actions.appendChild(postponeBtn);

    const urgencyBadge = document.createElement("span");
    urgencyBadge.className = "badge";
    if (task.urgency) {
      urgencyBadge.classList.add(`badge-urgency-${task.urgency}`);
      const map = { today: "היום", week: "השבוע", month: "החודש", none: "לא דחוף" };
      urgencyBadge.textContent = map[task.urgency] || task.urgency;
    }

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(actions);
    if (task.urgency) item.appendChild(urgencyBadge);

    list.appendChild(item);
  });
}

function markTaskDone(task) {
  const id = task._id || task.id;
  if (!id) return;
  set(ref(db, `tasksDone/${id}`), { ...task, doneAt: Date.now() });
  remove(ref(db, `events/${task.dateKey}/${id}`));
  showToast("סומן כבוצע");
}

// ---------- Day modal ----------
function hasEventsOnDate(dateKey) {
  const events = state.cache.events[dateKey] || {};
  return Object.keys(events).length > 0;
}

function openDayModal(date) {
  const modal = el("dayModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  safeText("dayModalGreg", String(date.getDate()));
  try {
    if (hasHebcal()) {
      const hd = new window.Hebcal.HDate(date);
      safeText("dayModalHeb", hd.renderGematriya());
    } else safeText("dayModalHeb", "");
  } catch { safeText("dayModalHeb", ""); }

  const dk = dateKeyFromDate(date);
  renderDayEvents(dk);
  renderAutoBlocks(date);

  const weatherCard = el("dayWeatherContainer");
  if (weatherCard) {
    if (!hasEventsOnDate(dk)) fetchWeatherForDate(date, true);
    else weatherCard.classList.add("hidden");
  }

  const addBtn = el("btnAddFromDay");
  if (addBtn) addBtn.onclick = () => openEditModal({ dateKey: dk });

  const wBtn = el("btnToggleDayWeather");
  if (wBtn) wBtn.onclick = () => fetchWeatherForDate(date, false);

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
}

function renderDayEvents(dateKey) {
  const container = el("dayEventsContainer");
  if (!container) return;
  container.innerHTML = "";
  const events = state.cache.events[dateKey] || {};
  const list = Object.entries(events)
    .map(([id, ev]) => ({ id, ...ev }))
    .sort((a, b) => {
      if (!a.startTime && b.startTime) return 1;
      if (a.startTime && !b.startTime) return -1;
      if (!a.startTime && !b.startTime) return 0;
      return a.startTime.localeCompare(b.startTime);
    });

  list.forEach((ev) => {
    const card = document.createElement("div");
    card.className = "card";
    if (ev.owner) card.classList.add(`owner-${ev.owner}`);

    const header = document.createElement("div");
    header.className = "task-item-header";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = ev.title;

    const ownerBadge = document.createElement("span");
    ownerBadge.className = "badge";
    ownerBadge.classList.add(`badge-owner-${ev.owner}`);
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
    editBtn.onclick = () => openEditModal({ dateKey, id: ev._id || ev.id || ev.id });

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

function renderAutoBlocks(date) {
  const container = el("dayAutoBlocks");
  if (!container) return;
  container.innerHTML = "";

  const blocks = [];
  const day = date.getDay();
  const dateKey = dateKeyFromDate(date);

  blocks.push({ label: "שינה", range: "00:00–08:00", type: "sleep" });
  if (day >= 0 && day <= 4) {
    blocks.push({ label: "עבודה", range: "08:00–17:00", type: "work" });
    blocks.push({ label: "אוכל + מקלחת", range: "17:00–18:30", type: "meal" });
  }

  onValue(ref(db, `days/${dateKey}/holiday`), (snap) => {
    const isHolidayMarked = !!snap.val();
    container.innerHTML = "";
    const finalBlocks = isHolidayMarked
      ? [{ label: "יום חופש", range: "ללא עבודה, אוכל/מקלחת אוטומטיים", type: "holiday" }]
      : blocks;

    finalBlocks.forEach((b) => {
      const row = document.createElement("div");
      row.className = "auto-block";
      if (b.type === "holiday") row.classList.add("auto-holiday");

      const label = document.createElement("div");
      label.className = "auto-block-label";
      label.textContent = b.label;

      const range = document.createElement("div");
      range.className = "auto-block-range";
      range.textContent = b.range;

      row.appendChild(label);
      row.appendChild(range);
      container.appendChild(row);
    });
  }, { onlyOnce: true });
}

// ---------- Edit modal ----------
function openEditModal({ dateKey, id } = {}) {
  const modal = el("editModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  const form = el("editForm");
  if (!form) return;
  form.reset();

  const dateInput = form.elements["date"];
  dateInput.value = dateKey ? dateKey : dateKeyFromDate(state.currentDate);

  form.dataset.editDateKey = dateKey || "";
  form.dataset.editId = id || "";

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
}

async function handleEditFormSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;

  const data = Object.fromEntries(new FormData(form).entries());
  const eventObj = {
    type: data.type,
    owner: data.owner,
    title: data.title,
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

  const dk = eventObj.dateKey || "undated";
  const existingId = form.dataset.editId || null;

  if (existingId) {
    await update(ref(db, `events/${dk}/${existingId}`), eventObj);
    showToast("עודכן");
  } else {
    const newRef = push(ref(db, `events/${dk}`));
    await set(newRef, { ...eventObj, _id: newRef.key });

    if (eventObj.recurring && eventObj.recurring !== "none") {
      const parentTask = { ...eventObj, _id: newRef.key, parentId: null, isRecurringParent: true };
      await update(newRef, parentTask);
      await materializeRecurringTask(parentTask);
    }
    showToast("נשמר");
  }

  scheduleLocalReminder(eventObj);
  el("editModal")?.classList.add("hidden");
}

function openWazeFromForm() {
  const form = el("editForm");
  if (!form) return;
  const address = form.elements["address"].value;
  if (!address) return;
  window.open(`https://waze.com/ul?q=${encodeURIComponent(address)}`, "_blank");
}

// ---------- Weather ----------
async function fetchWeatherForDate(date, autoShowIfEmpty) {
  const card = el("dayWeatherContainer");
  const city = getCity();
  if (!city) { card?.classList.add("hidden"); return; }

  try { await ensureCityCoords(); }
  catch (e) {
    console.error("City geocode failed", e);
    safeText("dayWeatherTemp", "שגיאה בזיהוי עיר");
    safeText("dayWeatherDesc", "");
    safeText("dayWeatherExtra", "");
    card?.classList.remove("hidden");
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
    if (!data.hourly?.temperature_2m?.length) {
      if (autoShowIfEmpty) card?.classList.add("hidden");
      return;
    }
    const idx = data.hourly.time.findIndex((t) => t.endsWith("12:00"));
    const i = idx >= 0 ? idx : 0;

    const temp = Math.round(data.hourly.temperature_2m[i]);
    const code = data.hourly.weather_code[i];
    const rain = data.hourly.precipitation_probability[i];
    const mapped = mapOpenMeteoWeather(code);

    safeText("dayWeatherTemp", `${temp}°C`);
    safeText("dayWeatherDesc", `${mapped.emoji} ${mapped.label}`);
    safeText("dayWeatherExtra", rain != null ? `סיכוי למשקעים: ${rain}%` : "");
    const emojiEl = el("dayWeatherEmoji");
    if (emojiEl) emojiEl.textContent = mapped.emoji;

    card?.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    if (!autoShowIfEmpty) {
      safeText("dayWeatherTemp", "שגיאה בטעינת מזג האוויר");
      safeText("dayWeatherDesc", "");
      safeText("dayWeatherExtra", "");
      card?.classList.remove("hidden");
    }
  }
}

// ---------- Notifications ----------
function requestNotifications() {
  if (!("Notification" in window)) return;
  Notification.requestPermission().then((perm) => {
    state.ui.notificationsGranted = perm === "granted";
    showToast(state.ui.notificationsGranted ? "התראות הופעלו" : "התראות לא הופעלו");
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

// ---------- Shopping ----------
function getCurrentShoppingListKey() {
  const active = qs("#shoppingSection .segmented-btn.active");
  return active ? active.dataset.list || "default" : "default";
}
function addShoppingItem() {
  const input = el("shoppingInput");
  if (!input) return;
  const text = input.value.trim();
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

// ---------- Stats (Chart.js) ----------
let workFreeChart, tasksChart;

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
  for (const seg of busySegments) {
    if (!merged.length) merged.push(seg);
    else {
      const last = merged[merged.length - 1];
      if (seg[0] <= last[1]) last[1] = Math.max(last[1], seg[1]);
      else merged.push(seg);
    }
  }

  let totalBusy = 0;
  merged.forEach((seg) => (totalBusy += seg[1] - seg[0]));

  const freeSlots = [];
  const dayStart = 8 * 60, dayEnd = 22 * 60;
  let cursor = dayStart;

  merged.forEach((seg) => {
    if (seg[0] - cursor >= 30) freeSlots.push([cursor, seg[0]]);
    cursor = Math.max(cursor, seg[1]);
  });
  if (dayEnd - cursor >= 30) freeSlots.push([cursor, dayEnd]);

  return { dailyLoadMinutes: totalBusy, freeSlots };
}

function updateStats() {
  const c1 = el("workFreeChart");
  const c2 = el("tasksChart");
  if (!c1 || !c2 || !window.Chart) return;

  const today = new Date();
  const { dailyLoadMinutes } = computeLoadAndFreeSlots(today);
  const workHours = dailyLoadMinutes / 60;
  const freeHours = Math.max(0, 14 - workHours);

  const ctx1 = c1.getContext("2d");
  if (!workFreeChart) {
    workFreeChart = new Chart(ctx1, {
      type: "doughnut",
      data: { labels: ["עבודה/משימות", "זמן פנוי"], datasets: [{ data: [workHours, freeHours] }] },
      options: { responsive: true, plugins: { legend: { display: true, position: "bottom" } } }
    });
  } else {
    workFreeChart.data.datasets[0].data = [workHours, freeHours];
    workFreeChart.update();
  }

  const last30Days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const { dailyLoadMinutes: dlm } = computeLoadAndFreeSlots(d);
    last30Days.push({ label: d.getDate(), loadHours: dlm / 60 });
  }

  const ctx2 = c2.getContext("2d");
  if (!tasksChart) {
    tasksChart = new Chart(ctx2, {
      type: "bar",
      data: { labels: last30Days.map((x) => x.label), datasets: [{ label: "עומס יומי (שעות)", data: last30Days.map((x) => x.loadHours) }] },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  } else {
    tasksChart.data.labels = last30Days.map((x) => x.label);
    tasksChart.data.datasets[0].data = last30Days.map((x) => x.loadHours);
    tasksChart.update();
  }
}

// ---------- Recurring + delete + postpone ----------
async function moveTaskToDate(task, newDateKey) {
  const id = task._id || task.id;
  if (!id) return;
  await set(ref(db, `events/${newDateKey}/${id}`), { ...task, dateKey: newDateKey });
  await remove(ref(db, `events/${task.dateKey}/${id}`));
  showToast("הועבר");
}

let _postponeTask = null;
function openPostponeModal(task) {
  _postponeTask = task;
  el("postponeModal")?.classList.remove("hidden");

  qsa("[data-close-postpone]").forEach((b) => (b.onclick = () => el("postponeModal")?.classList.add("hidden")));
  const ok = el("postponeOk");
  if (ok) {
    ok.onclick = () => {
      const v = el("postponeDateInput")?.value;
      if (!v) return;
      moveTaskToDate(_postponeTask, v);
      el("postponeModal")?.classList.add("hidden");
    };
  }
}

async function deleteTaskSmart(task) {
  const id = task._id || task.id;
  if (!id) return;

  if (task.isRecurringParent) {
    await remove(ref(db, `events/${task.dateKey}/${id}`));
    for (const [dk, items] of Object.entries(state.cache.events)) {
      for (const [cid, ev] of Object.entries(items || {})) {
        if (ev.parentId === id) await remove(ref(db, `events/${dk}/${cid}`));
      }
    }
    showToast("נמחק הכל");
  } else {
    await remove(ref(db, `events/${task.dateKey}/${id}`));
    showToast("נמחק");
  }
}

async function materializeRecurringTask(task) {
  // יוצר מופעים שנתיים קדימה (לפי השנה של התאריך של האבא)
  const start = parseDateKey(task.dateKey);
  const year = start.getFullYear();

  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const dk = dateKeyFromDate(d);

    if (task.recurring === "weekly" && d.getDay() !== start.getDay()) continue;
    if (task.recurring === "monthly_greg" && d.getDate() !== start.getDate()) continue;
    if (task.recurring === "yearly_greg" && (d.getDate() !== start.getDate() || d.getMonth() !== start.getMonth())) continue;

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

// ---------- Gihari (קל, לא שובר) ----------
let gihariVoice = null;
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  gihariVoice =
    voices.find((v) => v.lang === "he-IL" && (v.name.includes("Google") || v.name.toLowerCase().includes("enhanced"))) ||
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
  const chill = ["סגור אחי, עליי. 😎", "קיבלתי, מתקדם. 😉", "יאללה, עובד. 🧠"];
  const line = chill[Math.floor(Math.random() * chill.length)];
  return `${line}<br>${html}`;
}
function appendGihariLog(html) {
  const enhanced = wrapGihariHumor(html);
  const log = el("gihariLog");
  if (!log) return;
  const msg = document.createElement("div");
  msg.className = "gihari-msg";
  msg.innerHTML = enhanced;
  log.appendChild(msg);
  let plain = enhanced.replace(/<[^>]+>/g, "").replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  gihariSpeak(plain);
}

function openGihariModal() {
  const modal = el("gihariModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  const { dailyLoadMinutes, freeSlots } = computeLoadAndFreeSlots(new Date());
  const loadLabel = dailyLoadMinutes < 180 ? "יום קל" : dailyLoadMinutes < 360 ? "יום בינוני" : "יום עמוס";
  safeHtml("gihariSummary",
    `<p>עומס יומי: <strong>${Math.round(dailyLoadMinutes / 60)} שעות</strong></p>` +
    `<p>רמת עומס: <strong>${loadLabel}</strong></p>` +
    `<p>חלונות פנויים: <strong>${freeSlots.length}</strong></p>`
  );
  safeHtml("gihariLog", "");

  qsa("[data-close-modal]", modal).forEach((btn) => (btn.onclick = () => modal.classList.add("hidden")));
}

function gihariSuggestNow() {
  appendGihariLog("כרגע: הפיצ'ר פתוח לשדרוג לפי הטקסט שלך (מוכן).");
}
function gihariPlaceUndatedTasks() {
  appendGihariLog("שיבוץ אוטומטי: עובד לפי העומס – נשאר כמו אצלך. (אפשר לחזק לפי בקשות)");
}

// ---------- Firebase listeners ----------
function initFirebaseListeners() {
  onValue(ref(db, "events"), (snap) => {
    state.cache.events = snap.val() || {};
    renderCalendar();
    renderTasks();
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

    safeText("cityLabel", state.settings.city || "לא נבחרה");
    const input = el("settingsCityInput");
    if (input) input.value = state.settings.city || "";
  });
}

async function saveCitySettings() {
  const input = el("settingsCityInput");
  const city = (input?.value || "").trim();
  state.settings.city = city || null;
  safeText("cityLabel", city || "לא נבחרה");
  const settingsRef = ref(db, "settings");
  try {
    if (state.settings.city) await geocodeCity(state.settings.city);
    await update(settingsRef, {
      city: state.settings.city,
      cityLat: state.settings.cityLat || null,
      cityLon: state.settings.cityLon || null,
      cityTz: state.settings.cityTz || null
    });
    showToast("עיר נשמרה");
  } catch (e) {
    console.error("Failed to save city settings", e);
    await update(settingsRef, { city: state.settings.city });
    showToast("נשמר (ללא קואורדינטות)");
  }
}

function toggleHolidayForToday() {
  const key = dateKeyFromDate(new Date());
  const holidayRef = ref(db, `days/${key}/holiday`);
  onValue(holidayRef, (snap) => {
    const current = snap.val();
    if (current) remove(holidayRef);
    else set(holidayRef, true);
    showToast("עודכן");
  }, { onlyOnce: true });
}

// ---------- Nav ----------
function initBottomNav() {
  const btns = qsa(".bottom-nav .nav-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.dataset.target;
      qsa(".screen").forEach((s) => s.classList.remove("active"));
      el(targetId)?.classList.add("active");
      if (targetId === "statsSection") updateStats();
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
  const addBtn = el("btnAddShopping");
  if (addBtn) addBtn.onclick = addShoppingItem;
}

// ---------- App init ----------
function initApp() {
  initTheme();
  initBottomNav();
  initTasksFilters();
  initShopping();
  initFirebaseListeners();

  // user select binds currentUser
  const userSelect = el("userSelect");
  if (userSelect) {
    state.currentUser = userSelect.value || "binyamin";
    userSelect.addEventListener("change", () => {
      state.currentUser = userSelect.value;
      renderTasks(qs("#tasksSection .segmented-btn.active")?.dataset.filter || "undated");
      updateStats();
      showToast("משתמש עודכן");
    });
  }

  el("btnPrevMonth")?.addEventListener("click", () => { state.currentDate.setMonth(state.currentDate.getMonth() - 1); renderCalendar(); });
  el("btnNextMonth")?.addEventListener("click", () => { state.currentDate.setMonth(state.currentDate.getMonth() + 1); renderCalendar(); });
  el("btnToday")?.addEventListener("click", () => { state.currentDate = new Date(); renderCalendar(); });

  el("btnFabAdd")?.addEventListener("click", () => openEditModal({}));
  el("btnAddTask")?.addEventListener("click", () => openEditModal({}));
  el("btnCity")?.addEventListener("click", () => qs('[data-target="settingsSection"]')?.click());
  el("btnSaveCity")?.addEventListener("click", saveCitySettings);
  el("btnToggleHoliday")?.addEventListener("click", toggleHolidayForToday);
  el("btnThemeToggle")?.addEventListener("click", toggleTheme);
  el("btnRequestNotifications")?.addEventListener("click", requestNotifications);
  el("btnOpenWaze")?.addEventListener("click", openWazeFromForm);

  el("btnGihari")?.addEventListener("click", openGihariModal);
  el("gihariSuggestNow")?.addEventListener("click", gihariSuggestNow);
  el("gihariPlaceTasks")?.addEventListener("click", gihariPlaceUndatedTasks);

  el("editForm")?.addEventListener("submit", handleEditFormSubmit);

  renderCalendar();
  renderTasks();
  renderShoppingList();
  updateStats();
}

document.addEventListener("DOMContentLoaded", initApp);
