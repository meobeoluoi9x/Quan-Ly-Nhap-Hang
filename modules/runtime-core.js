/* Quản Lý Nhập Hàng V5.2.6 - runtime core */
const V42_FILL_DRAFT = "qlnh_fill_draft_v42";
const V42_NCC_DRAFT = "qlnh_ncc_draft_v42";
const V42_MANAGEMENT = "qlnh_management_v42";
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






