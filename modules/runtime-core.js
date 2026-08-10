/* Quản Lý Nhập Hàng V5.4.12 - runtime core */
const V42_FILL_DRAFT = "qlnh_fill_draft_v42";
const V42_NCC_DRAFT = "qlnh_ncc_draft_v42";
const V42_MANAGEMENT = "qlnh_management_v42";
const V53_DISPLAY = "qlnh_display_v53";
let v42FillStep = 0;
let v42NccDraftTimer = 0;
let v42HistoryPage = 1;
const V42_HISTORY_PAGE_SIZE = 30;
let v42HistoryContext = "";
let v42ActiveCalendarDay = todayISO();

function readV42Draft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}

function isV42DraftFresh(draft) {
  if (!draft) return false;
  const today = todayISO();
  return draft.savedOn === today || (!draft.savedOn && draft.date === today);
}

function readFreshV42Draft(key) {
  const draft = readV42Draft(key);
  if (!draft || isV42DraftFresh(draft)) return draft;
  localStorage.removeItem(key);
  return null;
}

function refreshOperationDatesForNewDay() {
  const today = todayISO();
  if (today === v42ActiveCalendarDay) return;
  v42ActiveCalendarDay = today;
  localStorage.removeItem(V42_FILL_DRAFT);
  localStorage.removeItem(V42_NCC_DRAFT);
  [$("#quickDate"), $("#nccForm")?.date, $("#transferDate"), $("#stocktakeDate")]
    .filter(Boolean)
    .forEach(input => { input.value = today; });
  persistQuickDraft();
  persistNccDraft();
}

function displaySettings() {
  const fallback = {
    title: "Quản Lý Nhập Hàng",
    version: `V${APP_VERSION}`,
    note: "Tự cập nhật ngày hiện tại"
  };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(V53_DISPLAY) || "null") || {}) };
  } catch {
    return fallback;
  }
}

function saveDisplaySettings(settings) {
  localStorage.setItem(V53_DISPLAY, JSON.stringify(settings));
  applyDisplaySettings();
}

function displaySubtitle(settings = displaySettings()) {
  return [settings.version, settings.note].filter(Boolean).join(" - ");
}

function applyDisplaySettings() {
  const settings = displaySettings();
  if ($(".app-brand h1")) $(".app-brand h1").textContent = settings.title || "Quản Lý Nhập Hàng";
  if ($(".app-header p")) $(".app-header p").textContent = displaySubtitle(settings);
  document.title = `${settings.title || "Quản Lý Nhập Hàng"} ${settings.version || ""}`.trim();
  const form = $("#displaySettingsForm");
  if (form) {
    form.title.value = settings.title || "";
    form.version.value = settings.version || "";
    form.note.value = settings.note || "";
  }
}







