// =========================================================================
// singersProfiles.js – 10 פרופילים של זמרי מזרחית קלאסיים עבור Web Speech API (he-IL)
// מבוסס אך ורק על window.speechSynthesis המובנה בדפדפן (ללא קבצי שמע חיצוניים וללא APIs בתשלום)
// =========================================================================

const SINGERS_PROFILES = [
  {
    id: "zohar_argov",
    name: "זוהר ארגוב",
    pitch: 0.80,
    rate: 0.90,
    introPhrase: "יא חביבי, הפרח בגני פורח והגיע הזמן למשימה שלך:"
  },
  {
    id: "margalit_tzanani",
    name: "מרגלית צנעני",
    pitch: 1.15,
    rate: 1.12,
    introPhrase: "מלעונה, תעזבי הכל ותני בראש! הגיע הזמן ל:"
  },
  {
    id: "haim_moshe",
    name: "חיים משה",
    pitch: 0.92,
    rate: 0.95,
    introPhrase: "כל נדריי וכל מילותיי, נשמה, הגיעה השעה ל:"
  },
  {
    id: "jacky_mekaiten",
    name: "ג'קי מקייטן",
    pitch: 0.85,
    rate: 1.08,
    introPhrase: "היידה כולם למחוא כפיים! המענטזת מזכירה שהגיע הזמן ל:"
  },
  {
    id: "ahuva_ozeri",
    name: "אהובה עוזרי",
    pitch: 1.28,
    rate: 0.88,
    introPhrase: "צלצולי פעמונים בתוך הלב, נשמה טהורה, הגיע הזמן ל:"
  },
  {
    id: "ishay_levi",
    name: "ישי לוי",
    pitch: 0.78,
    rate: 0.92,
    introPhrase: "ריקדי אחותי, האחת שלי, הגיע בדיוק הזמן ל:"
  },
  {
    id: "eyal_golan",
    name: "אייל גולן",
    pitch: 1.05,
    rate: 1.04,
    introPhrase: "צליל מיתר שמתנגן, חברים, הגיע הזמן למשימה:"
  },
  {
    id: "shlomi_shabat",
    name: "שלומי שבת",
    pitch: 0.72,
    rate: 0.86,
    introPhrase: "בגלל הרוח ובאהבה גדולה נשמה שלי, הגיע הזמן ל:"
  },
  {
    id: "zion_golan",
    name: "ציון גולן",
    pitch: 0.96,
    rate: 1.10,
    introPhrase: "אהלן וסהלן יא חביבי, אבא שמעון אומר שהגיע הזמן ל:"
  },
  {
    id: "sarit_hadad",
    name: "שרית חדד",
    pitch: 1.24,
    rate: 1.15,
    introPhrase: "יאללה לך הביתה מוטי, חגיגה ביומן! הגיע הזמן ל:"
  }
];

function getSingerProfileById(singerId) {
  if (!singerId) return SINGERS_PROFILES[0];
  const legacyMap = {
    zohar: "zohar_argov",
    margalit: "margalit_tzanani",
    ahuva: "ahuva_ozeri",
    daklon: "haim_moshe",
    teimani: "zion_golan",
    classic: "eyal_golan",
    grandpa: "shlomi_shabat",
    chipmunk: "sarit_hadad"
  };
  const resolvedId = legacyMap[singerId] || singerId;
  return SINGERS_PROFILES.find((s) => s.id === resolvedId) || SINGERS_PROFILES[0];
}

function buildSingerAlarmText(singerOrId, taskTitle) {
  const singer = typeof singerOrId === "object" && singerOrId ? singerOrId : getSingerProfileById(singerOrId);
  const cleanTitle = String(taskTitle || "משימה ביומן").trim();
  return `${singer.introPhrase} ${cleanTitle}`;
}

if (typeof window !== "undefined") {
  window.SINGERS_PROFILES = SINGERS_PROFILES;
  window.getSingerProfileById = getSingerProfileById;
  window.buildSingerAlarmText = buildSingerAlarmText;
}
