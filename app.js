const APP_VERSION = "5.2.0";
const STORAGE_KEY = "fill_assistant_v32";
const RECOVERY_BACKUP_KEY = "fill_assistant_recovery_backup";
const OLD_KEYS = ["fill_assistant_v31","fill_assistant_v30","fill_assistant_v24","fill_assistant_v23","fill_assistant_v22","fill_assistant_v21","fill_assistant_v2_production","fill_assistant_v2","fill_assistant_v1","fill_assistant_v1_edit_undo","fill_assistant_v0"];
const SYNC_CONFIG_KEY = "fill_assistant_supabase_config";
const DEVICE_ID_KEY = "fill_assistant_device_id";
const ACCESS_CACHE_KEY = "fill_assistant_access";
const DEFAULT_SUPABASE_URL = "https://ylopccoxnbhtmrghldpn.supabase.co";
// Paste the public browser key here. Never paste sb_secret/service_role keys.
// Optional light obfuscation: use "b64:" + base64 encoded publishable key.
const DEFAULT_SUPABASE_KEY = "sb_publishable_uBeJmMkH-kjYBsT09ToR4w__JDc48K2";

let deferredPrompt = null;
let lastAction = null;
let editing = null;
let orderSummaryText = "";
let activeOrderMachine = null;
let activeDashboardMachine = localStorage.getItem("fill_assistant_active_machine") || null;
let activeCabinMachine = localStorage.getItem("fill_assistant_cabin_machine") || null;
let syncClient = null;
let syncUser = null;
let syncBusy = false;
let syncStatusText = "Chưa cấu hình";
let syncAccess = loadCachedAccess();
let authListenerReady = false;
let cabinSnapshot = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function viDate(d = new Date()) {
  return d.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function unique(list) {
  return [...new Set(list)].filter(Boolean);
}

function deviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = makeId();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function syncConfig() {
  const defaults = {
    url: DEFAULT_SUPABASE_URL,
    key: decodeSupabaseKey(DEFAULT_SUPABASE_KEY),
    source: DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY ? "built-in" : "local"
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "{}");
    return {
      url: saved.url || defaults.url || "",
      key: saved.key || defaults.key || "",
      source: saved.url && saved.key ? "local" : defaults.source
    };
  } catch {
    return defaults;
  }
}

function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config || {}));
}

function decodeSupabaseKey(value) {
  if (!value) return "";
  if (value.startsWith("b64:")) {
    try {
      return atob(value.slice(4));
    } catch {
      return "";
    }
  }
  return value;
}

function readStoredState(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn(`Không đọc được dữ liệu localStorage: ${key}`, error);
    try {
      localStorage.setItem(RECOVERY_BACKUP_KEY, JSON.stringify({ sourceKey: key, savedAt: new Date().toISOString(), raw }));
      localStorage.removeItem(key);
    } catch {}
    return null;
  }
}

function loadState() {
  const saved = readStoredState(STORAGE_KEY);
  if (saved) return saved;

  for (const key of OLD_KEYS) {
    const old = readStoredState(key);
    if (old) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
      return old;
    }
  }

  const initial = normalizeState(window.FILL_STATE || {});
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

let state = loadState();

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function displayCabin() {
  const raw = currentCabin();
  const result = {};
  Object.entries(raw).forEach(([key, value]) => {
    result[key] = Math.max(0, Number(value || 0));
  });
  return result;
}

function negativeCabinItems() {
  return Object.entries(currentCabin())
    .filter(([, value]) => Number(value || 0) < 0)
    .map(([key, value]) => {
      const [machine, product] = key.split("||");
      return { machine, product, raw: Number(value), shortage: Math.abs(Number(value)) };
    });
}

function getCabinQty(machine, product) {
  return Math.max(0, Number(currentCabin()[`${machine}||${product}`] || 0));
}

function setupSelectsV4() {
  $$('input[type="date"]').forEach(input => { if (!input.value) input.value = todayISO(); });

  const machines = config().machines.map(machine => machine.name);
  const products = unique([
    ...Object.keys(config().products || {}),
    ...config().slots.map(slot => slot.product),
    ...config().initialCabin.map(item => item.product)
  ]).sort((a, b) => a.localeCompare(b, "vi"));

  $$('select[name="machine"]').forEach(select => {
    select.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("\n\n");
  });

  $$("#nccForm select[name='product'], #adjustForm select[name='product'], #stocktakeForm select[name='product']").forEach(select => {
    select.innerHTML = products.map(product => `<option>${product}</option>`).join("");
  });

  const quickMachine = $("#quickMachine");
  quickMachine.innerHTML = machines.map(machine => `<option>${machine}</option>`).join("");
  quickMachine.addEventListener("change", renderQuickFill);

  updateSlotOptions();
}

function updateSlotOptions() {
  const machine = $("#fillForm select[name='machine']").value;
  const slots = config().slots
    .filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));

  $("#fillForm select[name='slot']").innerHTML = slots
    .map(slot => `<option value="${slot.slot}">${slot.slot}</option>`)
    .join("");

  updateProductFromSlot();
}

function updateProductFromSlot() {
  const machine = $("#fillForm select[name='machine']").value;
  const slot = Number($("#fillForm select[name='slot']").value);
  const found = config().slots.find(item => item.machine === machine && Number(item.slot) === slot);
  $("#fillForm input[name='product']").value = found ? found.product : "";
}

function confirmLargeQty(qty, kind) {
  if (qty >= 100) return confirm(`Bạn vừa nhập ${qty}. Số lượng khá lớn, có chắc không?`);
  if (kind === "fill" && qty > 50) return confirm(`Bạn vừa fill ${qty}. Có chắc không?`);
  return true;
}

function saveFillFromForm(form) {
  const qty = Number(form.qty.value);
  if (!confirmLargeQty(qty, "fill")) return;

  const item = {
    id: editing?.type === "fill" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    slot: Number(form.slot.value),
    product: form.product.value,
    qty
  };

  if (editing?.type === "fill") {
    state.fillLogs[editing.index] = item;
    lastAction = { type: "editFill", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu fill";
    showToast("Đã cập nhật Fill.", true);
  } else {
    state.fillLogs.push(item);
    showToast("Đã lưu Fill.");
  }

  form.qty.value = "";
  saveState();
}

function saveAdjustFromForm(form) {
  const item = {
    id: editing?.type === "adjust" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    product: form.product.value,
    qty: Number(form.qty.value),
    reason: form.reason.value
  };

  if (editing?.type === "adjust") {
    state.adjustLogs[editing.index] = item;
    lastAction = { type: "editAdjust", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu điều chỉnh";
    showToast("Đã cập nhật điều chỉnh.", true);
  } else {
    state.adjustLogs.push(item);
    showToast("Đã lưu điều chỉnh.");
  }

  form.qty.value = "";
  saveState();
}

function showToast(message, undoable = false) {
  let toast = $("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }

  toast.innerHTML = `${message}${undoable ? ' <button id="undoBtn">Hoàn tác</button>' : ""}`;
  toast.className = "show";

  if (undoable) $("#undoBtn").onclick = undoLastAction;

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.className = "", 5000);
}

function totalPacks(rows) {
  return rows.reduce((sum, row) => sum + Number(row.pack?.packs || 0), 0);
}


function groupOrdersByMachine(rows) {
  const groups = {};
  rows.forEach(row => {
    groups[row.machine] ||= [];
    groups[row.machine].push(row);
  });
  return groups;
}

function formatMachineOrder(machine, rows) {
  const lines = [`${machine}`];
  rows.forEach(row => {
    lines.push(`- ${row.product}: ${row.pack.packs} thùng (${row.pack.qty} ${row.pack.unit})${row.storageReason ? ` - ${row.storageReason}` : ""}`);
  });
  return lines.join("\\n");
}

function copyText(text, message) {
  if (!text) {
    showToast("Chưa có đơn NCC để copy.");
    return;
  }

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast(message || "Đã copy."));
  } else {
    showToast(text);
  }
}

function machineOptionsHtml(selected = "") {
  return config().machines.map(machine => `<option value="${htmlEscape(machine.name)}" ${machine.name === selected ? "selected" : ""}>${htmlEscape(machine.name)}</option>`).join("");
}

function productOptionsHtml(selected = "") {
  return allProducts().map(product => `<option value="${htmlEscape(product)}" ${product === selected ? "selected" : ""}>${htmlEscape(product)}</option>`).join("");
}

function setupSelectsV4Runtime() {
  $$("input[type='date']").forEach(input => { if (!input.value) input.value = todayISO(); });
  const machines = machineOptionsHtml();
  if ($("#quickMachine")) $("#quickMachine").innerHTML = machines;
  if ($("#stocktakeMachine")) $("#stocktakeMachine").innerHTML = machines;
  if ($("#historyMachine")) $("#historyMachine").innerHTML = `<option value="">Tất cả</option>${machines}`;
  const from = new Date();
  from.setDate(from.getDate() - 6);
  if ($("#historyDate")) $("#historyDate").value = localISODate(from);
  if ($("#historyToDate")) $("#historyToDate").value = todayISO();
  $("#stocktakeMachine")?.addEventListener("change", renderStocktake);
  $("#cabinMachine")?.addEventListener("change", event => {
    activeCabinMachine = event.target.value;
    localStorage.setItem("fill_assistant_cabin_machine", activeCabinMachine);
    renderCabin();
  });
  $("#exportCabinCsvBtn")?.addEventListener("click", exportCabinCsv);
}

function localISODate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function addNccRow(values = {}) {
  const box = $("#bulkNccRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "bulk-ncc-row";
  row.innerHTML = `
    <select class="bulk-machine" aria-label="Máy">${machineOptionsHtml(values.machine || activeDashboardMachine || "")}</select>
    <select class="bulk-product" aria-label="Sản phẩm">${productOptionsHtml(values.product || "")}</select>
    <div class="bulk-box-control">
      <input class="bulk-boxes" type="number" min="0" step="1" inputmode="numeric" value="${Number(values.boxes || 0) || ""}" aria-label="Số thùng" />
    </div>
    <button type="button" class="remove-row-btn" data-remove-ncc-row aria-label="Xóa dòng">×</button>`;
  box.appendChild(row);
  updateNccBatchPreview();
}

function collectNccBatchRows(positiveOnly = false) {
  return $$(".bulk-ncc-row", $("#bulkNccRows")).map(row => ({
    row,
    machine: $(".bulk-machine", row).value,
    product: $(".bulk-product", row).value,
    boxes: Number($(".bulk-boxes", row).value || 0)
  })).filter(item => !positiveOnly || item.boxes > 0);
}

function mergedNccBatchRows() {
  const merged = new Map();
  collectNccBatchRows(true).forEach(item => {
    const key = `${item.machine}||${item.product}`;
    if (!merged.has(key)) merged.set(key, { machine: item.machine, product: item.product, boxes: 0 });
    merged.get(key).boxes += item.boxes;
  });
  return [...merged.values()];
}

function updateNccBatchPreview() {
  const rows = mergedNccBatchRows();
  const boxes = rows.reduce((sum, item) => sum + item.boxes, 0);
  const products = rows.reduce((sum, item) => sum + item.boxes * productInfo(item.product).pack, 0);
  if ($("#nccBatchPreview")) $("#nccBatchPreview").innerHTML = `
    <div><span>Dòng sau gộp</span><b>${rows.length}</b></div>
    <div><span>Tổng thùng</span><b>${boxes}</b></div>
    <div><span>Quy đổi</span><b>${products} sản phẩm</b></div>`;
}

function resetNccBatch() {
  if (!$("#bulkNccRows")) return;
  $("#bulkNccRows").innerHTML = "";
  addNccRow();
}

function setHistoryRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.max(0, days - 1));
  $("#historyDate").value = localISODate(start);
  $("#historyToDate").value = localISODate(end);
  renderHistory();
}

function historyDayLabel(date) {
  if (date === todayISO()) return "Hôm nay";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localISODate(yesterday)) return "Hôm qua";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("vi-VN");
}

function downloadCsvFile(rows, filename) {
  const csv = "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nccMachinesWithOrders() {
  const machines = unique(buildOrderRows().map(row => row.machine));
  return machines.length ? machines : config().machines.map(machine => machine.name);
}

function selectedNccExportMachines() {
  return $$("#nccExportMachines input:checked").map(input => input.value);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function isSyncAdminMode() {
  return new URLSearchParams(location.search).get("admin") === "1";
}

function hasBuiltInSyncConfig() {
  return Boolean(DEFAULT_SUPABASE_URL && DEFAULT_SUPABASE_KEY);
}

function ensureHeaderSyncLogin() {
  if (!hasBuiltInSyncConfig() || $("#headerSyncLogin")) return;
  const header = $(".app-header");
  if (!header) return;
  const box = document.createElement("div");
  box.id = "headerSyncLogin";
  box.className = "header-sync-login";
  box.innerHTML = `
    <form id="headerSyncLoginForm" class="header-sync-form">
      <input name="email" type="email" autocomplete="email" placeholder="Email" />
      <input name="password" type="password" autocomplete="current-password" placeholder="M&#7853;t kh&#7849;u" />
      <button type="submit" class="btn small">&#272;&#259;ng nh&#7853;p</button>
    </form>
    <div id="headerSyncAccount" class="header-sync-account hidden">
      <span id="headerSyncEmail"></span>
      <button id="headerSyncNowBtn" class="btn small">Sync</button>
      <button id="headerSyncLogoutBtn" class="btn small ghost">Tho&#225;t</button>
    </div>
  `;
  header.insertBefore(box, $("#installBtn"));
}

function loadSupabaseScript() {
  if (window.supabase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-supabase-js="1"]');
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    script.dataset.supabaseJs = "1";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function mergeRemoteRows(key, rows) {
  const localMap = new Map(state[key].map(item => [item.id, item]));
  rows.forEach(row => {
    const local = localMap.get(row.id);
    const remoteTime = String(row.updated_at || "");
    const localTime = String(local?.updated_at || "");
    if (!local || remoteTime > localTime) {
      const copy = { ...row, _sync: "synced" };
      delete copy.user_id;
      localMap.set(row.id, copy);
    } else if (remoteTime === localTime && local._sync !== "pending") {
      Object.assign(local, row, { _sync: "synced" });
      delete local.user_id;
    } else if (local._sync !== "pending") {
      local._sync = "synced";
    }
  });
  state[key] = [...localMap.values()];
}

function replaceWithPublicRows(key, rows) {
  const remoteMap = new Map(rows.map(row => [row.id, { ...row, _sync: "synced" }]));
  state[key].filter(item => item._sync === "pending" && item.workspace_id && item.created_by).forEach(item => {
    const remote = remoteMap.get(item.id);
    if (!remote || String(item.updated_at || "") > String(remote.updated_at || "")) remoteMap.set(item.id, item);
  });
  state[key] = [...remoteMap.values()];
}

let syncTimer = null;
function queueAutoSync() {
  if (!navigator.onLine || !syncConfig().url || !syncConfig().key) {
    renderSyncStatus();
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow(); }, 1200);
}

function importJSON(event) {
  if (!requirePermission("manage")) {
    event.target.value = "";
    return;
  }
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.state) {
        showToast("File không đúng định dạng.");
        return;
      }
      if (!confirm("Khôi phục file này và dùng nó để cập nhật dữ liệu Supabase?")) return;
      if (!navigator.onLine) {
        showToast("Cần kết nối mạng để khôi phục dữ liệu lên Supabase.");
        return;
      }
      if (!await syncNow()) {
        showToast("Chưa tải được dữ liệu Supabase. Hãy thử lại.");
        return;
      }
      state = authoritativeState(data.state);
      saveState();
      showToast("Đã nhập dữ liệu và chờ đồng bộ Supabase.");
    } catch {
      showToast("Không đọc được JSON.");
    }
  };
  reader.readAsText(file);
}

/* V3.5.0 - consolidated workflow */
let activeHistoryType = "fill";
let lastSyncAt = localStorage.getItem("fill_assistant_last_sync_at") || "";
let periodicSyncTimer = null;

function loadCachedAccess() {
  try {
    return JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

function cacheAccess(access) {
  syncAccess = access || null;
  if (syncAccess) localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(syncAccess));
  else localStorage.removeItem(ACCESS_CACHE_KEY);
}

function hasPermission(permission) {
  if (!syncUser || !syncAccess) return false;
  if (syncAccess.is_admin) return true;
  if (permission === "fill") return Boolean(syncAccess.can_fill);
  if (permission === "receive") return Boolean(syncAccess.can_receive);
  if (permission === "stocktake") return Boolean(syncAccess.can_stocktake);
  if (permission === "manage") return Boolean(syncAccess.is_admin);
  return true;
}

function permissionLabel(permission) {
  return permission === "fill" ? "Fill nhanh"
    : permission === "receive" ? "Nhập hàng"
      : permission === "stocktake" ? "Kiểm kê cabin"
        : "Quản trị";
}

function requirePermission(permission) {
  if (hasPermission(permission)) return true;
  showToast(syncAccess ? `Tài khoản chưa có quyền ${permissionLabel(permission)}.` : "Cần đăng nhập để thực hiện thao tác này.");
  if (!syncAccess) openAuthModal();
  return false;
}

function permissionSummary(access = syncAccess) {
  if (!access) return "Chưa có quyền";
  if (access.is_admin) return "Quản trị viên";
  const labels = [];
  if (access.can_fill) labels.push("Fill nhanh");
  if (access.can_receive) labels.push("Nhập hàng");
  if (access.can_stocktake) labels.push("Kiểm kê cabin");
  return labels.join(", ") || "Chỉ xem";
}

function stampRecordOwner(item) {
  if (!syncAccess) return item;
  item.workspace_id ||= syncAccess.workspace_id;
  item.created_by ||= syncAccess.user_id;
  item.user_id ||= syncAccess.user_id;
  return item;
}

function activeLogRows(key) {
  return state[key].filter(item => !item.deleted_at);
}

function touchRecord(item, deleted = false) {
  const now = new Date().toISOString();
  item.id ||= makeId();
  item.created_at ||= now;
  item.updated_at = now;
  item.device_id ||= deviceId();
  stampRecordOwner(item);
  item._sync = "pending";
  if (deleted) item.deleted_at = now;
  return item;
}

function markStatePending() {
  ["fillLogs", "nccLogs", "adjustLogs"].forEach(key => {
    state[key].forEach(item => {
      if (!item.created_at || !item.updated_at) touchRecord(item, Boolean(item.deleted_at));
      item.device_id ||= deviceId();
    });
  });
  (state.productStorageRules || []).forEach(item => {
    if (!item.created_at || !item.updated_at) touchConfigRecord(item, Boolean(item.deleted_at));
    item.device_id ||= deviceId();
  });
}

function saveState() {
  markStatePending();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  queueAutoSync();
}

function unitName() {
  return "sản phẩm";
}

function openDrawer() {
  $("#sideNav").classList.add("open");
  $("#navOverlay").hidden = false;
  $("#menuToggle").setAttribute("aria-expanded", "true");
  $("#sideNav").setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
}

function closeDrawer() {
  $("#sideNav").classList.remove("open");
  $("#navOverlay").hidden = true;
  $("#menuToggle").setAttribute("aria-expanded", "false");
  $("#sideNav").setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
}

function activateDashboardTab(name) {
  $$(".dashboard-content-tab").forEach(tab => {
    const active = tab.dataset.dashboardTab === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $$(".dashboard-tab-panel").forEach(panel => {
    const active = panel.dataset.dashboardPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function activateView(name) {
  const requestedTab = $(`.tab[data-view="${name}"]`);
  if (requestedTab?.dataset.authRequired && !(syncUser || syncAccess)) {
    openAuthModal();
    return;
  }
  if (requestedTab?.dataset.permission && !requirePermission(requestedTab.dataset.permission)) return;
  $$(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.view === name));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === name));
  if (name === "audit") renderStocktake();
  if (name === "cabin") renderCabin();
  if (name === "history") renderHistory();
  if (name === "system" && hasPermission("manage")) renderMembers();
  closeDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupTabs() {
  $$(".tab").forEach(button => button.addEventListener("click", () => activateView(button.dataset.view)));
  $("#menuToggle")?.addEventListener("click", openDrawer);
  $("#menuClose")?.addEventListener("click", closeDrawer);
  $("#navOverlay")?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });
  $$(".history-tab").forEach(button => button.addEventListener("click", () => {
    activeHistoryType = button.dataset.history;
    $$(".history-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    renderHistory();
  }));
  $$(".dashboard-content-tab").forEach(button => button.addEventListener("click", () => {
    activateDashboardTab(button.dataset.dashboardTab);
  }));
}

function allProducts() {
  return unique([
    ...Object.keys(config().products || {}),
    ...config().slots.map(slot => slot.product),
    ...config().initialCabin.map(item => item.product)
  ]).sort((a, b) => a.localeCompare(b, "vi"));
}

function nccBoxes(item) {
  const pack = productInfo(item.product).pack;
  return Number(item.boxes ?? Math.round(Number(item.qty || 0) / pack));
}

function updateNccConversion() {
  const form = $("#nccForm");
  const boxes = Number(form.qty.value || 0);
  const total = boxes * productInfo(form.product.value).pack;
  $("#nccConversion").textContent = `${boxes} thùng = ${total} sản phẩm`;
}

function setupQuickPads() {
  $$(".quickPad").forEach(pad => {
    pad.innerHTML = "";
    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const input = $("#" + pad.dataset.target + " input[name='qty']");
      input.value = Number(input.value || 0) + Number(button.dataset.val || 0);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

function saveNccFromForm(form) {
  if (!requirePermission("receive")) return;
  const boxes = Number(form.qty.value);
  if (!Number.isInteger(boxes) || boxes <= 0) {
    showToast("Số thùng phải là số nguyên lớn hơn 0.");
    return;
  }
  const item = touchRecord({
    id: makeId(), date: form.date.value, machine: form.machine.value,
    product: form.product.value, boxes, qty: boxes * productInfo(form.product.value).pack,
    recorded_at: new Date().toISOString()
  });
  state.nccLogs.push(item);
  form.qty.value = "";
  updateNccConversion();
  saveState();
  showToast(`Đã lưu ${boxes} thùng = ${item.qty} sản phẩm.`);
}

function historyDateTime(item) {
  if (!item.recorded_at) return item.date;
  const recorded = new Date(item.recorded_at);
  if (Number.isNaN(recorded.getTime())) return item.date;
  return `${item.date} · ${recorded.toLocaleTimeString("vi-VN", { hour12: false })}`;
}

function editFill(id) {
  if (!requirePermission("fill")) return;
  const item = state.fillLogs.find(row => row.id === id && !row.deleted_at);
  if (!item) return;
  const value = prompt("Số sản phẩm đã fill:", item.qty);
  if (value === null) return;
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty < 0) return showToast("Số lượng không hợp lệ.");
  item.qty = qty; touchRecord(item); saveState(); showToast("Đã cập nhật Nhập Fill.");
}

function editNcc(id) {
  if (!requirePermission("receive")) return;
  const item = state.nccLogs.find(row => row.id === id && !row.deleted_at);
  if (!item) return;
  const value = prompt("Số thùng nhập hàng:", nccBoxes(item));
  if (value === null) return;
  const boxes = Number(value);
  if (!Number.isInteger(boxes) || boxes < 0) return showToast("Số thùng không hợp lệ.");
  item.boxes = boxes; item.qty = boxes * productInfo(item.product).pack;
  touchRecord(item); saveState(); showToast("Đã cập nhật Nhập hàng.");
}

function editAdjust(id) {
  if (!requirePermission("stocktake")) return;
  const item = state.adjustLogs.find(row => row.id === id && !row.deleted_at);
  if (!item) return;
  const value = prompt("Chênh lệch kiểm kê theo sản phẩm:", item.qty);
  if (value === null) return;
  const qty = Number(value);
  if (!Number.isFinite(qty)) return showToast("Số lượng không hợp lệ.");
  item.qty = qty; touchRecord(item); saveState(); showToast("Đã cập nhật kiểm kê cabin.");
}

function deleteHistoryRecord(key, id, label) {
  const permission = key === "fillLogs" ? "fill" : key === "nccLogs" ? "receive" : "stocktake";
  if (!requirePermission(permission)) return;
  const item = state[key].find(row => row.id === id && !row.deleted_at);
  if (!item || !confirm(`Xóa bản ghi ${label} này?`)) return;
  touchRecord(item, true);
  lastAction = { type: "restoreDeleted", item };
  saveState(); showToast(`Đã xóa ${label}.`, true);
}

function deleteFill(id) { deleteHistoryRecord("fillLogs", id, "Nhập Fill"); }
function deleteNcc(id) { deleteHistoryRecord("nccLogs", id, "Nhập hàng"); }
function deleteAdjust(id) { deleteHistoryRecord("adjustLogs", id, "kiểm kê cabin"); }

function undoLastAction() {
  if (!lastAction) return;
  const item = lastAction.item;
  const permission = state.fillLogs.includes(item) ? "fill" : state.nccLogs.includes(item) ? "receive" : "stocktake";
  if (!requirePermission(permission)) return;
  if (lastAction.type === "restoreDeleted") {
    delete lastAction.item.deleted_at;
    touchRecord(lastAction.item);
  }
  lastAction = null; saveState(); showToast("Đã hoàn tác.");
}

function openStocktake(machine) {
  if (!requirePermission("stocktake")) return;
  activateView("audit");
  $("#stocktakeMachine").value = machine;
  renderStocktake();
}

function renderAudit() {
  const negatives = negativeCabinItems();
  $("#auditBox").innerHTML = negatives.length ? negatives.map(item => `
    <div class="pill red"><b>${htmlEscape(item.machine)} - ${htmlEscape(item.product)}</b><div class="small">Tồn tính toán: ${item.raw} sản phẩm · Lệch ${item.shortage} sản phẩm</div><button class="mini open-stocktake" data-machine="${htmlEscape(item.machine)}">Mở kiểm kê cabin</button></div>
  `).join("") : `<div class="pill green"><b>Dữ liệu ổn</b><div class="small">Không có cabin nào bị âm.</div></div>`;
  $$(".open-stocktake", $("#auditBox")).forEach(button => button.addEventListener("click", () => openStocktake(button.dataset.machine)));
}

function renderSummary() {
  const machine = activeDashboardMachine;
  const negatives = negativeCabinItems().filter(item => item.machine === machine).length;
  const orders = buildOrderRows().filter(row => row.machine === machine);
  const packs = totalPacks(orders);
  const attention = dashboardAttentionRows(machine);
  const health = machineHealth(machine);
  const priorityText = packs > 0 ? `${machine}: cần đặt ${packs} thùng` : `${machine}: chưa cần nhập hàng`;
  $("#priorityBox").innerHTML = `<div><span>Ưu tiên hôm nay</span><b>${htmlEscape(priorityText)}</b></div><strong class="${health.cls}">${health.label}</strong>`;
  $("#summaryBox").innerHTML = [
    ["Thùng cần nhập", packs], ["Sản phẩm cần nhập", orders.length], ["Cần kiểm tra", attention.length], ["Lệch cabin", negatives]
  ].map(([label, value]) => `<div class="summary-card action-metric"><span>${label}</span><b>${value}</b></div>`).join("");
}

function copyOrderSummary() {
  if (!orderSummaryText) return showToast("Chưa có đơn nhập hàng để copy.");
  copyText(`Đơn nhập hàng ${activeDashboardMachine}:\n${orderSummaryText}`, `Đã copy đơn ${activeDashboardMachine}.`);
}

function openAuthModal() {
  $("#authModal")?.classList.remove("hidden");
  renderAuthUI();
  if (!syncUser) setTimeout(() => $("#authLoginForm input[name='email']")?.focus(), 0);
}

function closeAuthModal() {
  $("#authModal")?.classList.add("hidden");
}

function accountDetailsHtml() {
  const email = syncUser?.email || syncAccess?.email || "Chưa đăng nhập";
  return `<div class="account-line"><span>Tài khoản</span><b>${htmlEscape(email)}</b></div>
    <div class="account-line"><span>Quyền</span><b>${htmlEscape(permissionSummary())}</b></div>`;
}

function normalizeAccess(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    workspace_id: row.workspace_id,
    user_id: row.user_id || syncUser?.id,
    email: syncUser?.email || row.email || "",
    display_name: row.display_name || "",
    role: row.role || (row.is_admin ? "admin" : "user"),
    can_fill: Boolean(row.can_fill),
    can_receive: Boolean(row.can_receive),
    can_stocktake: Boolean(row.can_stocktake),
    is_admin: Boolean(row.is_admin)
  };
}

async function loadMyAccess(options = {}) {
  if (!syncClient || !syncUser) return false;
  try {
    const { data, error } = await syncClient.rpc("bootstrap_fill_assistant_owner");
    if (error) throw error;
    cacheAccess(normalizeAccess(data));
    prepareLocalRowsForWorkspace();
    syncStatusText = "Đã kết nối";
    renderAuthUI();
    if (syncAccess?.is_admin) renderMembers();
    return Boolean(syncAccess);
  } catch (error) {
    const cachedForUser = syncAccess?.user_id === syncUser.id;
    if (!cachedForUser || navigator.onLine) cacheAccess(null);
    syncStatusText = navigator.onLine ? "Chưa được cấp quyền" : "Đang dùng quyền offline";
    renderAuthUI();
    if (!options.quiet) showToast(error.message || "Tài khoản chưa được cấp quyền.");
    return Boolean(syncAccess);
  }
}

async function applyAuthSession(session, options = {}) {
  syncUser = session?.user || null;
  if (!syncUser) {
    cacheAccess(null);
    syncStatusText = "Chỉ xem";
    renderAuthUI();
    renderSyncStatus();
    return false;
  }
  const ready = await loadMyAccess(options);
  renderSyncStatus();
  return ready;
}

async function signInSupabase(email, password) {
  await initSyncClient();
  const { data, error } = await syncClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  syncUser = data.user;
  if (!await loadMyAccess()) throw new Error("Tài khoản chưa được cấp quyền.");
  syncStatusText = "Đã đăng nhập";
  renderSyncStatus();
  closeAuthModal();
  showToast("Đã đăng nhập và bắt đầu đồng bộ.");
  queueAutoSync();
}

async function signOutSupabase() {
  if (syncClient) await syncClient.auth.signOut();
  syncUser = null;
  cacheAccess(null);
  syncStatusText = "Đã đăng xuất";
  renderAuthUI();
  renderSyncStatus();
  showToast("Đã đăng xuất. Dữ liệu local vẫn được giữ trên thiết bị.");
}

async function renderMembers() {
  if (!syncClient || !syncAccess?.is_admin || !navigator.onLine) return;
  const { data, error } = await syncClient.from("workspace_members")
    .select("user_id,email,display_name,role,can_fill,can_receive,can_stocktake,is_admin")
    .eq("workspace_id", syncAccess.workspace_id)
    .order("created_at", { ascending: true });
  if (error) return;
  $("#memberList").innerHTML = (data || []).map(member => {
    const permissions = member.is_admin ? "Quản trị" : [member.can_fill && "Fill", member.can_receive && "Nhập hàng", member.can_stocktake && "Kiểm kê"].filter(Boolean).join(" · ") || "Chỉ xem";
    const role = member.is_admin || member.role === "admin" ? "Admin" : "User";
    return `<div class="member-row"><div><b>${htmlEscape(member.display_name || member.email || "Tài khoản")}</b><span>${htmlEscape(member.email || "")}</span></div><div class="member-permissions"><b>${role}</b><span>${permissions}</span></div><button type="button" class="mini edit-member" data-email="${htmlEscape(member.email || "")}" data-role="${role.toLowerCase()}" data-fill="${member.can_fill ? 1 : 0}" data-receive="${member.can_receive ? 1 : 0}" data-stocktake="${member.can_stocktake ? 1 : 0}">Sửa</button></div>`;
  }).join("") || `<p class="muted">Chưa có tài khoản nào.</p>`;
}

function editMemberFromButton(button) {
  const form = $("#memberForm");
  if (!form) return;
  form.elements.email.value = button.dataset.email || "";
  form.elements.role.value = button.dataset.role || "user";
  form.elements.can_fill.checked = button.dataset.fill === "1";
  form.elements.can_receive.checked = button.dataset.receive === "1";
  form.elements.can_stocktake.checked = button.dataset.stocktake === "1";
  form.elements.email.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateMemberRoleForm() {
  const form = $("#memberForm");
  if (!form || form.elements.role.value !== "admin") return;
  form.elements.can_fill.checked = true;
  form.elements.can_receive.checked = true;
  form.elements.can_stocktake.checked = true;
}

async function saveMemberPermissions(form) {
  if (!requirePermission("manage") || !navigator.onLine) return showToast("Cần có mạng để cập nhật quyền.");
  const values = new FormData(form);
  const isAdmin = values.get("role") === "admin";
  const { error } = await syncClient.rpc("upsert_fill_assistant_member", {
    p_email: String(values.get("email") || "").trim(),
    p_can_fill: isAdmin || values.has("can_fill"),
    p_can_receive: isAdmin || values.has("can_receive"),
    p_can_stocktake: isAdmin || values.has("can_stocktake"),
    p_is_admin: isAdmin
  });
  if (error) throw error;
  form.reset();
  await renderMembers();
  showToast("Đã lưu quyền tài khoản.");
}

function renderSyncStatus() {
  const configured = Boolean(syncConfig().url && syncConfig().key);
  const pending = pendingSyncCount();
  const label = !configured ? "Local" : !syncUser ? (syncBusy ? "Đang cập nhật" : syncStatusText || "Chỉ xem") : !syncAccess ? syncStatusText : !navigator.onLine ? `Chờ mạng ${pending}` : syncBusy ? "Đang đồng bộ" : pending ? `Chờ sync ${pending}` : syncStatusText;
  $("#syncBadge") && ($("#syncBadge").textContent = label);
  $("#syncStatusPill") && ($("#syncStatusPill").textContent = label);
  const lastSyncText = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString("vi-VN", { hour12: false })
    : "Chưa có";
  $("#syncOverview") && ($("#syncOverview").innerHTML = `<div class="sync-status-grid"><div><span>Kết nối</span><b>${navigator.onLine ? "Online" : "Offline"}</b></div><div><span>Phiên</span><b>${syncUser ? "Đã đăng nhập" : "Chưa đăng nhập"}</b></div><div><span>Chưa đồng bộ</span><b>${pending}</b></div><div><span>Lần cuối</span><b>${lastSyncText}</b></div></div><p class="muted">Dữ liệu được lưu trên thiết bị trước và tự đồng bộ theo quyền của tài khoản.</p>`);
  renderAuthUI();
}

async function initSyncClient() {
  const cfg = syncConfig();
  if (!cfg.url || !cfg.key) { syncClient = null; syncStatusText = "Chưa cấu hình"; renderSyncStatus(); return false; }
  if (syncClient) return true;
  await loadSupabaseScript();
  syncClient = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  if (!authListenerReady) {
    authListenerReady = true;
    syncClient.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => applyAuthSession(session, { quiet: true }).then(() => queueAutoSync()), 0);
    });
  }
  const { data, error } = await syncClient.auth.getSession();
  if (error) throw error;
  await applyAuthSession(data.session, { quiet: true });
  return true;
}

function cleanSyncRecord(item, fields) {
  touchRecord(item, Boolean(item.deleted_at));
  stampRecordOwner(item);
  const record = {};
  fields.forEach(field => { record[field] = item[field] ?? null; });
  return record;
}

async function upsertPendingRows(meta, pending) {
  const batchSize = 250;
  for (let index = 0; index < pending.length; index += batchSize) {
    const batch = pending.slice(index, index + batchSize);
    const records = batch.map(item => cleanSyncRecord(item, meta.fields));
    const { data, error } = await syncClient
      .from(meta.table)
      .upsert(records, { onConflict: "id" })
      .select("id,updated_at");
    if (error) throw error;
    const serverTimes = new Map((data || []).map(row => [row.id, row.updated_at]));
    batch.forEach(item => {
      if (serverTimes.has(item.id)) item.updated_at = serverTimes.get(item.id);
    });
  }
}

async function fetchAllSyncRows(meta, publicOnly = false) {
  const pageSize = 500;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await syncClient
      .from(meta.table)
      .select(publicOnly ? meta.publicFields.join(",") : "*")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function setupSyncForms() {
  $("#syncConfigForm")?.addEventListener("submit", async event => {
    event.preventDefault(); saveSyncConfig({ url: event.target.url.value.trim(), key: event.target.key.value.trim() });
    await initSyncClient(); queueAutoSync(); showToast("Đã lưu cấu hình Supabase.");
  });
  $("#syncNowBtn")?.addEventListener("click", syncNow);
  $("#syncBadge")?.addEventListener("click", () => syncUser || syncAccess ? activateView("system") : openAuthModal());
  $("#accountBtn")?.addEventListener("click", openAuthModal);
  $("#syncAccountBtn")?.addEventListener("click", openAuthModal);
  $("#authCloseBtn")?.addEventListener("click", closeAuthModal);
  $("[data-close-auth]")?.addEventListener("click", closeAuthModal);
  $("#authLoginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await signInSupabase(event.target.email.value.trim(), event.target.password.value);
      event.target.password.value = "";
    } catch (error) {
      showToast(error.message || "Không đăng nhập được.");
    }
  });
  $("#authLogoutBtn")?.addEventListener("click", signOutSupabase);
  $("#authSyncBtn")?.addEventListener("click", syncNow);
  $("#memberForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    try { await saveMemberPermissions(event.target); }
    catch (error) { showToast(error.message || "Không lưu được quyền."); }
  });
  $("#memberForm select[name='role']")?.addEventListener("change", updateMemberRoleForm);
  $("#memberList")?.addEventListener("click", event => {
    const button = event.target.closest(".edit-member");
    if (button) editMemberFromButton(button);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeAuthModal(); });
  window.addEventListener("online", () => { syncStatusText = "Online"; renderSyncStatus(); queueAutoSync(); });
  window.addEventListener("offline", () => { syncStatusText = "Chờ mạng"; renderSyncStatus(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) queueAutoSync(); });
  clearInterval(periodicSyncTimer);
  periodicSyncTimer = setInterval(() => {
    if (navigator.onLine && !document.hidden) queueAutoSync();
  }, 30000);
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  $("#installBtn").classList.remove("hidden");
});

$("#installBtn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $("#installBtn").classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

/* V4.1.0 - Quản Lý Nhập Hàng */
var selectedMachineEditorId = null;
var machineSchemaAvailable = true;
var machineEditorDirty = false;

function normalizeState(value) {
  const normalized = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  ["fillLogs", "nccLogs", "adjustLogs", "machineConfigs", "machineSlots", "productStorageRules"].forEach(key => {
    if (!Array.isArray(normalized[key])) normalized[key] = [];
  });
  return normalized;
}

function stableConfigId(prefix, value, suffix = "") {
  const clean = String(value || "item").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}-${clean || "item"}${suffix ? `-${suffix}` : ""}`;
}

function seedMachineConfig() {
  if (state.machineConfigs.length || state.machineSlots.length) return;
  const base = window.FILL_BASE_CONFIG || window.FILL_CONFIG || { machines: [], slots: [] };
  const now = new Date().toISOString();
  state.machineConfigs = (base.machines || []).map(machine => ({
    id: stableConfigId("machine", machine.name),
    name: machine.name,
    original_name: machine.name,
    aliases: [],
    group_name: machine.group || "",
    cycle_days: Number(machine.cycleDays || 1),
    archived: false,
    created_at: now,
    updated_at: now,
    _sync: "seeded"
  }));
  const machineIds = new Map(state.machineConfigs.map(machine => [machine.original_name, machine.id]));
  state.machineSlots = (base.slots || []).map(slot => ({
    id: stableConfigId("slot", slot.machine, slot.slot),
    machine_id: machineIds.get(slot.machine),
    slot_number: Number(slot.slot),
    product: slot.product,
    capacity: Number(slot.max || 0),
    initial_machine: Number(slot.initialMachine || 0),
    archived: false,
    created_at: now,
    updated_at: now,
    _sync: "seeded"
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function seedProductStorageRules() {
  const now = new Date().toISOString();
  state.productStorageRules ||= [];
  let changed = false;
  defaultStorageRules().forEach(defaultRule => {
    const existingRule = state.productStorageRules.find(rule => !rule.deleted_at && String(rule.product || "").toLocaleLowerCase("vi") === defaultRule.product.toLocaleLowerCase("vi"));
    if (existingRule) {
      if (isAquaProduct(existingRule.product) && Number(existingRule.max_packs) < 3) {
        existingRule.max_packs = 3;
        existingRule.updated_at = now;
        changed = true;
      }
      return;
    }
    state.productStorageRules.push({ ...defaultRule, created_at: now, updated_at: now });
    changed = true;
  });
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeMachineConfigs() {
  return (state.machineConfigs || []).filter(machine => !machine.deleted_at && !machine.archived);
}

function canonicalMachineName(name) {
  const found = activeMachineConfigs().find(machine => machine.name === name
    || machine.original_name === name || (machine.aliases || []).includes(name));
  return found?.name || name;
}

function config() {
  const base = window.FILL_BASE_CONFIG || window.FILL_CONFIG || { products: {}, machines: [], slots: [], initialCabin: [] };
  const machines = activeMachineConfigs();
  if (!machines.length) return base;
  const machineById = new Map(machines.map(machine => [machine.id, machine]));
  const slots = (state.machineSlots || []).filter(slot => !slot.deleted_at && !slot.archived && machineById.has(slot.machine_id))
    .map(slot => ({
      machine: machineById.get(slot.machine_id).name,
      slot: Number(slot.slot_number),
      product: slot.product,
      max: Number(slot.capacity || 0),
      initialMachine: Number(slot.initial_machine || 0)
    }));
  const products = { ...(base.products || {}) };
  slots.forEach(slot => { products[slot.product] ||= { pack: isAquaProduct(slot.product) ? 28 : 24, minPacks: 1 }; });
  return {
    products,
    machines: machines.map(machine => ({
      id: machine.id,
      name: machine.name,
      group: machine.group_name || "",
      cycleDays: Number(machine.cycle_days || 1)
    })),
    slots,
    initialCabin: (base.initialCabin || []).map(item => ({ ...item, machine: canonicalMachineName(item.machine) }))
  };
}

function currentCabin() {
  if (cabinSnapshot) return cabinSnapshot;
  const map = {};
  const add = (machine, product, qty) => {
    if (!machine || !product) return;
    const key = `${canonicalMachineName(machine)}||${product}`;
    map[key] = (map[key] || 0) + Number(qty || 0);
  };
  config().initialCabin?.forEach(item => add(item.machine, item.product, item.qty));
  activeLogRows("nccLogs").forEach(item => add(item.machine, item.product, item.qty));
  activeLogRows("adjustLogs").forEach(item => add(item.machine, item.product, item.qty));
  activeLogRows("fillLogs").forEach(item => add(item.machine, item.product, -item.qty));
  cabinSnapshot = map;
  return cabinSnapshot;
}

function getRecentFill(product, machine, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return activeLogRows("fillLogs")
    .filter(log => log.product === product && canonicalMachineName(log.machine) === machine && new Date(log.date) >= cutoff)
    .reduce((sum, log) => sum + Number(log.qty || 0), 0);
}

function expectedDemandBeforeNextVisit(machine, product) {
  return 0;
}

function dashboardAttentionRows(machine) {
  const rawCabin = currentCabin();
  const orderMap = new Map(buildOrderRows().map(row => [`${row.machine}||${row.product}`, row]));
  const keys = new Set(Object.keys(rawCabin));
  config().slots.filter(slot => slot.machine === machine).forEach(slot => keys.add(`${machine}||${slot.product}`));
  return [...keys].map(key => {
    const [rowMachine, product] = key.split("||");
    const raw = Number(rawCabin[key] || 0);
    const qty = Math.max(0, raw);
    const orderRow = orderMap.get(key);
    return { machine: rowMachine, product, qty, raw, order: orderRow?.order || 0, pack: orderRow?.pack || packText(0, product) };
  }).filter(item => item.machine === machine && (item.raw < 0 || item.qty <= 12 || item.order > 0))
    .sort((a, b) => (a.raw < 0 ? -1 : 0) - (b.raw < 0 ? -1 : 0) || b.order - a.order || a.qty - b.qty);
}

function setupSelects() {
  setupSelectsV4Runtime();
}

function renderHistory() {
  renderHistoryV4Runtime();
}

function setupForms() {
  setupSelects();
  $("#stocktakeBox")?.addEventListener("click", event => {
    if (event.target.closest("#saveStocktakeBtn")) saveStocktakeBatch();
    if (event.target.closest("#resetStocktakeBtn")) renderStocktake();
  });
  ["historyDate", "historyToDate", "historyMachine", "historyProduct"].forEach(id => {
    $("#" + id)?.addEventListener(id === "historyProduct" ? "input" : "change", renderHistory);
  });
  $$("[data-history-days]").forEach(button => button.addEventListener("click", () => setHistoryRange(Number(button.dataset.historyDays))));
  $("#exportHistoryCsvBtn")?.addEventListener("click", exportHistoryCsv);
  $("#resetBtn")?.addEventListener("click", async () => {
    if (!requirePermission("manage")) return;
    if (!confirm("Reset về dữ liệu gốc trên thiết bị và Supabase?")) return;
    if (!navigator.onLine) return showToast("Cần kết nối mạng để reset dữ liệu Supabase.");
    if (!await syncNow()) return showToast("Chưa tải được dữ liệu Supabase. Hãy thử lại.");
    state = authoritativeState(window.FILL_STATE || {});
    state.machineConfigs = [];
    state.machineSlots = [];
    state.productStorageRules = [];
    seedMachineConfig();
    seedProductStorageRules();
    saveState();
  });
  $("#exportBtn")?.addEventListener("click", exportJSON);
  $("#importInput")?.addEventListener("change", importJSON);
  $("#copyOrderBtn")?.addEventListener("click", copyOrderSummary);
  setupMachineManagerEvents();
}

function touchConfigRecord(item, deleted = false) {
  const now = new Date().toISOString();
  item.id ||= makeId();
  item.created_at ||= now;
  item.updated_at = now;
  item.device_id ||= deviceId();
  if (syncAccess) item.workspace_id ||= syncAccess.workspace_id;
  item._sync = "pending";
  if (deleted) item.deleted_at = now;
  return item;
}

function addLayoutEditorRow(values = {}) {
  const box = $("#layoutEditorRows");
  if (!box) return;
  const product = String(values.product || "");
  const row = document.createElement("div");
  row.className = "layout-editor-row";
  row.dataset.id = values.id || "";
  row.innerHTML = `
    <input class="layout-slot" type="number" min="1" step="1" value="${Number(values.slot_number || values.slot || 1)}" aria-label="Số slot" />
    <div class="layout-product-combo">
      <input class="layout-product" type="text" list="layoutProductList" value="${htmlEscape(product)}" placeholder="Chọn hoặc gõ sản phẩm" aria-label="Chọn hoặc gõ tên sản phẩm" autocomplete="off" />
      <button type="button" class="product-list-btn" data-open-product-list title="Mở danh sách sản phẩm" aria-label="Mở danh sách sản phẩm">⌄</button>
    </div>
    <input class="layout-capacity" type="number" min="1" step="1" value="${Number(values.capacity || values.max || 24)}" aria-label="Sức chứa" />
    <button type="button" class="remove-row-btn" data-remove-layout-row aria-label="Xóa slot">×</button>`;
  box.appendChild(row);
  updateMachineSlotCount();
}

function updateMachineSlotCount() {
  const count = $$(".layout-editor-row", $("#layoutEditorRows")).length;
  if ($("#machineSlotCount")) $("#machineSlotCount").textContent = String(count);
}

function addStorageRuleRow(values = {}) {
  const box = $("#storageRuleRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "storage-rule-row";
  row.dataset.id = values.id || "";
  row.innerHTML = `
    <input class="storage-product" type="text" list="layoutProductList" value="${htmlEscape(values.product || "")}" placeholder="Chọn hoặc gõ sản phẩm" aria-label="Sản phẩm" autocomplete="off" />
    <input class="storage-pack" type="number" min="1" step="1" value="${Number(values.pack || 24)}" aria-label="Sản phẩm mỗi thùng" />
    <input class="storage-shelf" type="number" min="0" step="0.25" value="${Number(values.shelf_per_pack ?? 0.5)}" aria-label="Ngăn mỗi thùng" />
    <input class="storage-max" type="number" min="0" step="1" value="${Number(values.max_packs || 2)}" aria-label="Giới hạn thùng cabin" />
    <button type="button" class="remove-storage-rule" data-remove-storage-rule aria-label="Xóa cấu hình">×</button>`;
  box.appendChild(row);
}

function renderStorageRuleManager() {
  const card = $("#storageRuleCard");
  const box = $("#storageRuleRows");
  if (!card || !box) return;
  const canManage = hasPermission("manage");
  card.classList.toggle("hidden", !canManage);
  if (!canManage) return;
  box.innerHTML = "";
  activeStorageRules().sort((a, b) => String(a.product).localeCompare(String(b.product), "vi")).forEach(addStorageRuleRow);
  if (!box.children.length) defaultStorageRules().forEach(addStorageRuleRow);
}

function saveStorageRules() {
  if (!requirePermission("manage")) return;
  const cleanLabel = value => String(value || "").replace(/\s+/g, " ").trim();
  const knownProducts = allProducts();
  const rows = $$(".storage-rule-row", $("#storageRuleRows")).map(row => {
    const enteredProduct = cleanLabel($(".storage-product", row).value);
    const existingProduct = knownProducts.find(product => product.toLocaleLowerCase("vi") === enteredProduct.toLocaleLowerCase("vi"));
    return {
      id: row.dataset.id || stableConfigId("storage-rule", existingProduct || enteredProduct),
      product: existingProduct || enteredProduct,
      no_wrap: true,
      pack: Number($(".storage-pack", row).value),
      shelf_per_pack: Number($(".storage-shelf", row).value),
      max_packs: Number($(".storage-max", row).value)
    };
  }).filter(row => row.product);
  if (rows.some(row => row.product.includes("||") || row.product.length > 120 || !Number.isInteger(row.pack) || row.pack < 1 || !Number.isFinite(row.shelf_per_pack) || row.shelf_per_pack < 0 || !Number.isInteger(row.max_packs) || row.max_packs < 0)) {
    return showToast("Kiểm tra lại sản phẩm, quy cách thùng và giới hạn cabin.");
  }
  const uniqueNames = new Set(rows.map(row => row.product.toLocaleLowerCase("vi")));
  if (uniqueNames.size !== rows.length) return showToast("Sản phẩm tốn chỗ không được trùng nhau.");
  state.productStorageRules ||= [];
  const keep = new Set(rows.map(row => row.id));
  state.productStorageRules.filter(rule => !rule.deleted_at && !keep.has(rule.id)).forEach(rule => touchConfigRecord(rule, true));
  rows.forEach(values => {
    let rule = state.productStorageRules.find(item => item.id === values.id);
    if (!rule) { rule = { id: values.id }; state.productStorageRules.push(rule); }
    Object.assign(rule, values);
    delete rule.deleted_at;
    touchConfigRecord(rule);
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  cabinSnapshot = null;
  renderStorageRuleManager();
  renderAll();
  queueAutoSync();
  showToast("Đã lưu cấu hình hàng tốn chỗ.");
}

function confirmDiscardMachineDraft() {
  return !machineEditorDirty || confirm("Máy và layout đang có thay đổi chưa lưu. Bỏ các thay đổi này?");
}

function selectedMachineConfig() {
  return state.machineConfigs.find(machine => machine.id === selectedMachineEditorId && !machine.deleted_at);
}

function renderMachineManager(force = false) {
  const card = $("#machineAdminCard");
  if (!card) return;
  const canManage = hasPermission("manage");
  card.classList.toggle("hidden", !canManage);
  if (!canManage) return;
  if (machineEditorDirty && !force) return;
  const machines = activeMachineConfigs();
  if (!selectedMachineEditorId || !machines.some(machine => machine.id === selectedMachineEditorId)) selectedMachineEditorId = machines[0]?.id || null;
  const select = $("#machineEditorSelect");
  select.innerHTML = machines.map(machine => `<option value="${machine.id}">${htmlEscape(machine.name)}</option>`).join("");
  if (selectedMachineEditorId) select.value = selectedMachineEditorId;
  const source = $("#duplicateMachineSource");
  source.innerHTML = machines.filter(machine => machine.id !== selectedMachineEditorId)
    .map(machine => `<option value="${machine.id}">${htmlEscape(machine.name)}</option>`).join("");
  const machine = selectedMachineConfig();
  const form = $("#machineEditorForm");
  form.elements.name.value = machine?.name || "";
  $("#layoutEditorRows").innerHTML = "";
  const slots = machine ? state.machineSlots.filter(slot => slot.machine_id === machine.id && !slot.deleted_at && !slot.archived)
    .sort((a, b) => Number(a.slot_number) - Number(b.slot_number)) : [];
  slots.forEach(addLayoutEditorRow);
  if (!slots.length) addLayoutEditorRow({ slot_number: 1, capacity: 24 });
  let list = $("#layoutProductList");
  if (!list) {
    list = document.createElement("datalist");
    list.id = "layoutProductList";
    form.appendChild(list);
  }
  list.innerHTML = allProducts().map(product => `<option value="${htmlEscape(product)}"></option>`).join("");
  $("#archiveMachineBtn").disabled = !machine;
  machineEditorDirty = false;
  updateMachineSlotCount();
}

function refreshOperationalSelects() {
  const preserve = {
    quick: $("#quickMachine")?.value,
    stocktake: $("#stocktakeMachine")?.value,
    history: $("#historyMachine")?.value
  };
  const options = machineOptionsHtml();
  if ($("#quickMachine")) { $("#quickMachine").innerHTML = options; if (preserve.quick) $("#quickMachine").value = canonicalMachineName(preserve.quick); }
  if ($("#stocktakeMachine")) { $("#stocktakeMachine").innerHTML = options; if (preserve.stocktake) $("#stocktakeMachine").value = canonicalMachineName(preserve.stocktake); }
  if ($("#historyMachine")) { $("#historyMachine").innerHTML = `<option value="">Tất cả</option>${options}`; $("#historyMachine").value = preserve.history || ""; }
  $$(".bulk-machine").forEach(select => { const value = select.value; select.innerHTML = machineOptionsHtml(value); });
}

function saveMachineAndLayout(form) {
  if (!requirePermission("manage")) return;
  const cleanLabel = value => String(value || "").replace(/\s+/g, " ").trim();
  const name = cleanLabel(form.elements.name.value);
  if (!name) return showToast("Tên máy không được để trống.");
  if (name.length > 80 || name.includes("||")) return showToast("Tên máy không hợp lệ hoặc quá dài.");
  const duplicate = activeMachineConfigs().find(machine => machine.name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi") && machine.id !== selectedMachineEditorId);
  if (duplicate) return showToast("Tên máy đã tồn tại.");
  const knownProducts = allProducts();
  const rows = $$(".layout-editor-row", $("#layoutEditorRows")).map(row => {
    const enteredProduct = cleanLabel($(".layout-product", row).value);
    const existingProduct = knownProducts.find(product => product.toLocaleLowerCase("vi") === enteredProduct.toLocaleLowerCase("vi"));
    return {
      id: row.dataset.id || makeId(),
      slot_number: Number($(".layout-slot", row).value),
      product: existingProduct || enteredProduct,
      capacity: Number($(".layout-capacity", row).value)
    };
  });
  if (!rows.length || rows.some(row => !Number.isInteger(row.slot_number) || row.slot_number < 1 || !row.product || row.product.length > 120 || row.product.includes("||") || !Number.isInteger(row.capacity) || row.capacity < 1)) {
    return showToast("Kiểm tra lại số slot, sản phẩm và sức chứa.");
  }
  if (new Set(rows.map(row => row.slot_number)).size !== rows.length) return showToast("Số slot không được trùng nhau.");
  let machine = selectedMachineConfig();
  if (!machine) {
    machine = touchConfigRecord({ id: makeId(), name, original_name: name, aliases: [], group_name: "", cycle_days: 1, archived: false });
    state.machineConfigs.push(machine);
    selectedMachineEditorId = machine.id;
  } else {
    if (machine.name !== name) machine.aliases = unique([...(machine.aliases || []), machine.name]);
    machine.name = name;
    touchConfigRecord(machine);
  }
  machine.archived = false;
  touchConfigRecord(machine);
  const keep = new Set(rows.map(row => row.id));
  state.machineSlots.filter(slot => slot.machine_id === machine.id && !slot.deleted_at && !keep.has(slot.id)).forEach(slot => touchConfigRecord(slot, true));
  rows.forEach(values => {
    let slot = state.machineSlots.find(item => item.id === values.id);
    if (!slot) { slot = { id: values.id, machine_id: machine.id, archived: false }; state.machineSlots.push(slot); }
    Object.assign(slot, values, { machine_id: machine.id, archived: false });
    delete slot.deleted_at;
    touchConfigRecord(slot);
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  cabinSnapshot = null;
  machineEditorDirty = false;
  refreshOperationalSelects();
  renderMachineManager(true);
  renderAll();
  queueAutoSync();
  showToast("Đã lưu máy và toàn bộ layout.");
}

function setupMachineManagerEvents() {
  $("#machineEditorForm")?.addEventListener("input", () => { machineEditorDirty = true; });
  $("#machineEditorForm")?.addEventListener("change", () => { machineEditorDirty = true; });
  $("#machineEditorSelect")?.addEventListener("change", event => {
    if (!confirmDiscardMachineDraft()) { event.target.value = selectedMachineEditorId || ""; return; }
    machineEditorDirty = false;
    selectedMachineEditorId = event.target.value;
    renderMachineManager(true);
  });
  $("#newMachineBtn")?.addEventListener("click", () => {
    if (!confirmDiscardMachineDraft()) return;
    machineEditorDirty = false;
    selectedMachineEditorId = null;
    renderMachineManager(true);
    $("#machineEditorForm input[name='name']")?.focus();
  });
  $("#addLayoutSlotBtn")?.addEventListener("click", () => {
    const slots = $$(".layout-slot", $("#layoutEditorRows")).map(input => Number(input.value || 0));
    addLayoutEditorRow({ slot_number: Math.max(0, ...slots) + 1, capacity: 24 });
    machineEditorDirty = true;
  });
  $("#layoutEditorRows")?.addEventListener("click", event => {
    const listButton = event.target.closest("[data-open-product-list]");
    if (listButton) {
      const input = $(".layout-product", listButton.closest(".layout-product-combo"));
      input.focus();
      if (typeof input.showPicker === "function") input.showPicker();
      return;
    }
    const remove = event.target.closest("[data-remove-layout-row]");
    if (!remove) return;
    remove.closest(".layout-editor-row").remove();
    machineEditorDirty = true;
    updateMachineSlotCount();
  });
  $("#machineEditorForm")?.addEventListener("submit", event => { event.preventDefault(); saveMachineAndLayout(event.target); });
  $("#archiveMachineBtn")?.addEventListener("click", () => {
    const machine = selectedMachineConfig();
    if (!machine || !confirm(`Lưu trữ ${machine.name}? Lịch sử cũ vẫn được giữ.`)) return;
    machine.archived = true;
    touchConfigRecord(machine);
    machineEditorDirty = false;
    selectedMachineEditorId = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshOperationalSelects(); renderMachineManager(true); renderAll(); queueAutoSync();
  });
  $("#duplicateLayoutBtn")?.addEventListener("click", () => {
    const sourceId = $("#duplicateMachineSource").value;
    const slots = state.machineSlots.filter(slot => slot.machine_id === sourceId && !slot.deleted_at && !slot.archived)
      .sort((a, b) => Number(a.slot_number) - Number(b.slot_number));
    if (!slots.length) return showToast("Máy nguồn chưa có layout.");
    $("#layoutEditorRows").innerHTML = "";
    slots.forEach(slot => addLayoutEditorRow({ slot_number: slot.slot_number, product: slot.product, capacity: slot.capacity }));
    machineEditorDirty = true;
    updateMachineSlotCount();
    showToast("Đã sao chép layout. Bấm Lưu để xác nhận.");
  });
  $("#addStorageRuleBtn")?.addEventListener("click", () => addStorageRuleRow({ pack: 24, shelf_per_pack: 0.5, max_packs: 2 }));
  $("#storageRuleRows")?.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-storage-rule]");
    if (!remove) return;
    remove.closest(".storage-rule-row").remove();
  });
  $("#storageRuleForm")?.addEventListener("submit", event => {
    event.preventDefault();
    saveStorageRules();
  });
}

function prepareLocalRowsForWorkspace() {
  if (!syncAccess) return;
  let changed = false;
  ["fillLogs", "nccLogs", "adjustLogs"].forEach(key => {
    state[key].forEach(item => {
      if (item.workspace_id) return;
      stampRecordOwner(item);
      item._sync = "pending";
      changed = true;
    });
  });
  if (syncAccess.is_admin) {
    ["machineConfigs", "machineSlots", "productStorageRules"].forEach(key => state[key].forEach(item => {
      if (!item.workspace_id) item.workspace_id = syncAccess.workspace_id;
      if (item._sync === "seeded" || !item.updated_at) item._sync = "pending";
      changed = true;
    }));
  }
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pendingSyncCount() {
  return ["fillLogs", "nccLogs", "adjustLogs", "machineConfigs", "machineSlots", "productStorageRules"]
    .reduce((sum, key) => sum + (state[key] || []).filter(item => item._sync === "pending").length, 0);
}

function syncTables() {
  return [
    { table: "fill_logs", key: "fillLogs", permission: "fill", publicFields: ["id", "date", "machine", "slot", "product", "qty", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "date", "machine", "slot", "product", "qty", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] },
    { table: "ncc_logs", key: "nccLogs", permission: "receive", publicFields: ["id", "batch_id", "date", "machine", "product", "qty", "boxes", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "batch_id", "date", "machine", "product", "qty", "boxes", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] },
    { table: "adjust_logs", key: "adjustLogs", permission: "stocktake", publicFields: ["id", "batch_id", "date", "machine", "product", "qty", "actual", "reason", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "batch_id", "date", "machine", "product", "qty", "actual", "reason", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] }
  ];
}

function mergeConfigRows(key, remoteRows) {
  if (!remoteRows?.length) return;
  const map = new Map((state[key] || []).map(item => [item.id, item]));
  remoteRows.forEach(row => {
    const local = map.get(row.id);
    if (!local || String(row.updated_at || "") >= String(local.updated_at || "") || local._sync !== "pending") {
      map.set(row.id, { ...row, _sync: "synced" });
    }
  });
  state[key] = [...map.values()];
}

async function syncMachineConfig(publicOnly) {
  const definitions = [
    { table: "machines", key: "machineConfigs", publicFields: "id,name,original_name,aliases,group_name,cycle_days,archived,created_at,updated_at,deleted_at", fields: ["id", "workspace_id", "name", "original_name", "aliases", "group_name", "cycle_days", "archived", "created_at", "updated_at", "deleted_at", "device_id"] },
    { table: "machine_slots", key: "machineSlots", publicFields: "id,machine_id,slot_number,product,capacity,initial_machine,archived,created_at,updated_at,deleted_at", fields: ["id", "workspace_id", "machine_id", "slot_number", "product", "capacity", "initial_machine", "archived", "created_at", "updated_at", "deleted_at", "device_id"] },
    { table: "product_storage_rules", key: "productStorageRules", publicFields: "id,product,no_wrap,pack,shelf_per_pack,max_packs,created_at,updated_at,deleted_at", fields: ["id", "workspace_id", "product", "no_wrap", "pack", "shelf_per_pack", "max_packs", "created_at", "updated_at", "deleted_at", "device_id"] }
  ];
  try {
    for (const meta of definitions) {
      if (!publicOnly && hasPermission("manage")) {
        const pending = state[meta.key].filter(item => item._sync === "pending" || !item.updated_at);
        if (pending.length) {
          const records = pending.map(item => {
            touchConfigRecord(item, Boolean(item.deleted_at));
            const record = {};
            meta.fields.forEach(field => { record[field] = item[field] ?? null; });
            record.workspace_id ||= syncAccess.workspace_id;
            return record;
          });
          const { error } = await syncClient.from(meta.table).upsert(records, { onConflict: "id" });
          if (error) throw error;
          pending.forEach(item => { item._sync = "synced"; });
        }
      }
      let query = syncClient.from(meta.table).select(publicOnly ? meta.publicFields : "*").order("updated_at", { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      mergeConfigRows(meta.key, data || []);
    }
    machineSchemaAvailable = true;
    return true;
  } catch (error) {
    const message = String(error?.message || "");
    if (error?.code === "42P01" || error?.code === "PGRST205" || message.includes("machine_slots") || message.includes("machines") || message.includes("product_storage_rules")) {
      machineSchemaAvailable = false;
      return false;
    }
    throw error;
  }
}

async function syncNow() {
  if (syncBusy) return false;
  if (!navigator.onLine) {
    syncStatusText = "Chờ mạng";
    renderSyncStatus();
    return false;
  }
  let succeeded = false;
  syncBusy = true;
  syncStatusText = "Đang đồng bộ";
  renderSyncStatus();
  try {
    await initSyncClient();
    if (!syncClient) throw new Error("Chưa cấu hình Supabase.");
    const publicOnly = !syncUser || !syncAccess;
    if (publicOnly) {
      for (const meta of syncTables()) replaceWithPublicRows(meta.key, await fetchAllSyncRows(meta, true));
      await syncMachineConfig(true);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      lastSyncAt = new Date().toISOString();
      localStorage.setItem("fill_assistant_last_sync_at", lastSyncAt);
      syncStatusText = syncUser ? "Chưa được cấp quyền" : "Chỉ xem";
      refreshOperationalSelects();
      renderAll();
      succeeded = true;
      return succeeded;
    }
    for (const meta of syncTables()) {
      const pending = hasPermission(meta.permission) ? state[meta.key].filter(item => item._sync === "pending" || !item.updated_at) : [];
      if (pending.length) {
        await upsertPendingRows(meta, pending);
        pending.forEach(item => { item._sync = "synced"; });
      }
      mergeRemoteRows(meta.key, await fetchAllSyncRows(meta));
    }
    await syncMachineConfig(false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSyncAt = new Date().toISOString();
    localStorage.setItem("fill_assistant_last_sync_at", lastSyncAt);
    syncStatusText = "Đã đồng bộ";
    refreshOperationalSelects();
    renderAll();
    succeeded = true;
  } catch (error) {
    syncStatusText = "Lỗi đồng bộ";
    showToast(error.message || "Không đồng bộ được Supabase.");
  } finally {
    syncBusy = false;
    renderSyncStatus();
  }
  return succeeded;
}

function renderAuthUI() {
  const signedIn = Boolean(syncUser);
  $("#authLoginForm")?.classList.toggle("hidden", signedIn);
  $("#authAccountPanel")?.classList.toggle("hidden", !signedIn);
  if ($("#authAccountInfo")) $("#authAccountInfo").innerHTML = accountDetailsHtml();
  if ($("#accountOverview")) $("#accountOverview").innerHTML = accountDetailsHtml();
  if ($("#accountBtn")) {
    $("#accountBtn").textContent = signedIn ? (syncUser.email?.split("@")[0] || "Tài khoản") : "Đăng nhập";
    $("#accountBtn").title = signedIn ? syncUser.email : "Đăng nhập";
  }
  applyPermissions();
  $("#exportHistoryCsvBtn")?.classList.toggle("hidden", !signedIn);
  renderMachineManager();
  renderStorageRuleManager();
}

function ensureSyncView() {
  if ($(".app-header p")) $(".app-header p").textContent = `V${APP_VERSION} - Tách dashboard`;
  const cfg = syncConfig();
  $("#syncConfigCard")?.classList.toggle("hidden", !(hasPermission("manage") && isSyncAdminMode()));
  if ($("#syncConfigForm")) { $("#syncConfigForm").url.value = cfg.url || ""; $("#syncConfigForm").key.value = cfg.key || ""; }
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const attention = dashboardAttentionRows(machine);
  const packsTotal = totalPacks(rows);
  const exportMachines = nccMachinesWithOrders();
  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\n\nTỔNG: ${packsTotal} THÙNG` : "";
  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="dashboard-order-head"><div><span>Đơn nhập hàng ${htmlEscape(machine)}</span><b>${packsTotal} thùng</b></div><small>${rows.length} sản phẩm</small></div>
    <div class="dashboard-order-list">${rows.map(row => {
      const layout = row.slotCount > 1 ? `${row.slotCount} slot · sức chứa ${row.capacity}` : `Sức chứa ${row.capacity || "chưa đặt"}`;
      const storage = row.storageReason ? ` · ${htmlEscape(row.storageReason)}` : "";
      return `<div class="dashboard-order-row"><span>${htmlEscape(row.product)}<small class="order-context">${layout} · tồn ${row.projected}${storage}</small></span><b>${row.pack.packs} thùng</b><small>${row.pack.qty} sản phẩm</small></div>`;
    }).join("")}</div>
    <div class="excel-export-box"><div class="excel-export-head"><b>Xuất đơn nhập hàng</b><button type="button" id="selectAllNccMachines" class="mini">Chọn tất cả</button></div>
      <div id="nccExportMachines" class="machine-check-list">${exportMachines.map(name => `<label><input type="checkbox" value="${htmlEscape(name)}" ${name === machine ? "checked" : ""} /><span>${htmlEscape(name)}</span></label>`).join("")}</div>
      <button type="button" id="exportNccCsvBtn" class="btn primary">Xuất CSV mở bằng Excel</button></div>`
    : `<div class="empty-state"><b>${htmlEscape(machine || "Máy này")} đang ổn</b><span>Chưa có sản phẩm nào cần nhập hàng.</span></div>`;
  $("#orderBox").innerHTML = attention.length ? `<div class="attention-list">${attention.slice(0, 12).map(item => {
    const level = item.raw < 0 ? "red" : item.qty <= 2 ? "red" : item.qty <= 12 ? "yellow" : "blue";
    return `<div class="attention-row ${level}"><div><b>${htmlEscape(item.product)}</b><span>${item.raw < 0 ? `Lệch ${Math.abs(item.raw)}` : `Tồn ${item.qty}`} sản phẩm</span></div><strong>${item.order > 0 ? `${item.pack.packs} thùng` : "Kiểm tra"}</strong></div>`;
  }).join("")}</div>` : `<div class="empty-state"><b>Không có tồn thấp</b><span>Máy này chưa có mục nào cần chú ý.</span></div>`;
  $("#exportNccCsvBtn")?.addEventListener("click", exportNccCsv);
  $("#selectAllNccMachines")?.addEventListener("click", () => {
    const inputs = $$("#nccExportMachines input");
    const check = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = check; });
  });
}

function exportNccCsv() {
  const machines = selectedNccExportMachines();
  const rows = buildOrderRows().filter(row => machines.includes(row.machine));
  if (!machines.length) return showToast("Chưa chọn máy để xuất CSV.");
  if (!rows.length) return showToast("Các máy đã chọn chưa có sản phẩm cần nhập.");
  const grouped = groupOrdersByMachine(rows);
  const csvRows = [["Đơn nhập hàng - Quản Lý Nhập Hàng"], [`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`], [], ["Máy", "Sản phẩm", "Số slot", "Sức chứa", "Tồn cabin", "Tồn dùng tính đơn", "Số thùng", "Quy đổi sản phẩm", "Ghi chú"]];
  machines.forEach(machine => {
    (grouped[machine] || []).forEach(row => csvRows.push([machine, row.product, row.slotCount, row.capacity, row.qty, row.projected, row.pack.packs, row.pack.qty, row.storageReason || ""]));
    if ((grouped[machine] || []).length) csvRows.push([`Tổng ${machine}`, "", "", "", "", "", totalPacks(grouped[machine]), "", ""], []);
  });
  csvRows.push(["TỔNG TẤT CẢ", "", "", "", "", "", totalPacks(rows), "", ""]);
  downloadCsvFile(csvRows, `don-nhap-hang-${todayISO()}.csv`);
  showToast(`Đã xuất CSV ${machines.length} máy.`);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ version: APP_VERSION, product: "Quản Lý Nhập Hàng", config: config(), state }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `quan-ly-nhap-hang-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function applyPermissions() {
  const authenticated = Boolean(syncUser && syncAccess);
  $$('[data-auth-required]').forEach(element => element.classList.toggle("hidden", !authenticated));
  $$('[data-permission]').forEach(element => element.classList.toggle("hidden", !hasPermission(element.dataset.permission)));
  const restricted = $(".tab.active[data-permission]");
  if (restricted && !hasPermission(restricted.dataset.permission)) activateView("dashboard");
  const authRequired = $(".tab.active[data-auth-required]");
  if (authRequired && !authenticated) activateView("dashboard");
  $("#memberAdminCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#machineAdminCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#storageRuleCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#syncConfigCard")?.classList.toggle("hidden", !(hasPermission("manage") && isSyncAdminMode()));
}

function authoritativeState(incomingState) {
  const incoming = normalizeState(JSON.parse(JSON.stringify(incomingState || {})));
  const result = normalizeState({});
  ["fillLogs", "nccLogs", "adjustLogs"].forEach(key => {
    const rows = new Map();
    incoming[key].forEach(item => {
      const copy = { ...item };
      delete copy._sync;
      if (copy.deleted_at) touchRecord(copy, true);
      else { delete copy.deleted_at; touchRecord(copy); }
      rows.set(copy.id, copy);
    });
    state[key].forEach(item => {
      if (!rows.has(item.id)) rows.set(item.id, touchRecord({ ...item }, true));
    });
    result[key] = [...rows.values()];
  });
  ["machineConfigs", "machineSlots", "productStorageRules"].forEach(key => {
    const source = incoming[key]?.length ? incoming[key] : state[key];
    result[key] = source.map(item => touchConfigRecord({ ...item }, Boolean(item.deleted_at)));
  });
  return result;
}
