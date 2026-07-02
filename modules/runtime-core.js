/* Quản Lý Nhập Hàng V4.4.2 - runtime core */
const V42_FILL_DRAFT = "qlnh_fill_draft_v42";
const V42_NCC_DRAFT = "qlnh_ncc_draft_v42";
const V42_MANAGEMENT = "qlnh_management_v42";
let v42FillStep = 0;
let v42NccDraftTimer = 0;
let v42HistoryPage = 1;
const V42_HISTORY_PAGE_SIZE = 30;
let v42HistoryContext = "";

function readV42Draft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}
