const APP_VERSION = "4.2.6";
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

function config() {
  return window.FILL_CONFIG || { products: {}, machines: [], slots: [], initialCabin: [] };
}

function unique(list) {
  return [...new Set(list)].filter(Boolean);
}

function normalizeState(state) {
  state ||= {};
  state.fillLogs ||= [];
  state.nccLogs ||= [];
  state.adjustLogs ||= [];
  return state;
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

function markStatePending() {
  const now = new Date().toISOString();
  const id = deviceId();
  ["fillLogs", "nccLogs", "adjustLogs"].forEach(key => {
    state[key].forEach(item => {
      item.created_at ||= now;
      item.updated_at = now;
      item.device_id ||= id;
      item._sync = "pending";
    });
  });
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

function saveState() {
  markStatePending();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  queueAutoSync();
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function productInfo(product) {
  return config().products?.[product] || { pack: isAquaProduct(product) ? 28 : 24, minPacks: 1 };
}

function isAquaProduct(product) {
  const lower = String(product || "").toLowerCase();
  return lower.includes("aqua") || lower.includes("aquafina");
}

function unitName(product) {
  return "sản phẩm";
}

function packText(qty, product) {
  const info = productInfo(product);
  const packs = Math.ceil(Number(qty || 0) / info.pack);
  return { packs, qty: packs * info.pack, unit: unitName(product), packSize: info.pack };
}

function suggestOrder(qty, product) {
  const info = productInfo(product);
  const stock = Number(qty || 0);

  // Aqua: giảm dần số thùng theo mức tồn, dừng nhập khi đã có từ 56 sản phẩm.
  if (isAquaProduct(product)) {
    if (stock >= 56) return 0;
    if (stock >= 28) return info.pack;
    if (stock > 0) return info.pack * 2;
    return info.pack * 3;
  }

  // Sản phẩm thường chỉ đặt tối đa một thùng khi tồn từ 12 trở xuống.
  if (stock > 12) return 0;
  return info.pack;
}

function currentCabin() {
  const map = {};
  const add = (machine, product, qty) => {
    if (!machine || !product) return;
    const key = `${machine}||${product}`;
    map[key] = (map[key] || 0) + Number(qty || 0);
  };

  config().initialCabin?.forEach(x => add(x.machine, x.product, x.qty));
  state.nccLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.adjustLogs.forEach(x => add(x.machine, x.product, x.qty));
  state.fillLogs.forEach(x => add(x.machine, x.product, -x.qty));
  return map;
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

function getRecentFill(product, machine, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return state.fillLogs
    .filter(log => log.product === product && log.machine === machine && new Date(log.date) >= cutoff)
    .reduce((sum, log) => sum + Number(log.qty || 0), 0);
}

function setupTabs() {
  $$(".tab").forEach(button => {
    button.addEventListener("click", () => {
      $$(".tab").forEach(tab => tab.classList.remove("active"));
      $$(".view").forEach(view => view.classList.remove("active"));
      button.classList.add("active");
      $("#" + button.dataset.view).classList.add("active");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
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

function setupForms() {
  setupSelects();

  $("#fillForm select[name='machine']").addEventListener("change", updateSlotOptions);
  $("#fillForm select[name='slot']").addEventListener("change", updateProductFromSlot);

  $("#fillForm").addEventListener("submit", event => {
    event.preventDefault();
    saveFillFromForm(event.target);
  });

  $("#nccForm").addEventListener("submit", event => {
    event.preventDefault();
    saveNccFromForm(event.target);
  });

  $("#adjustForm").addEventListener("submit", event => {
    event.preventDefault();
    saveAdjustFromForm(event.target);
  });

  $("#stocktakeForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const machine = form.machine.value;
    const product = form.product.value;
    const actual = Number(form.actual.value);
    const current = getCabinQty(machine, product);
    const diff = actual - current;

    if (diff === 0) {
      showToast("Không có chênh lệch.");
      return;
    }

    const item = { id: makeId(), date: form.date.value, machine, product, qty: diff, reason: "Kiểm kê" };
    state.adjustLogs.push(item);
    lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
    form.actual.value = "";
    saveState();
    showToast(`Đã tạo điều chỉnh ${diff > 0 ? "+" : ""}${diff}.`, true);
  });

  $("#resetBtn").addEventListener("click", () => {
    if (confirm("Reset về dữ liệu gốc? Dữ liệu nhập trên thiết bị này sẽ bị xóa.")) {
      state = normalizeState(window.FILL_STATE || {});
      saveState();
    }
  });

  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importInput").addEventListener("change", importJSON);
  $("#copyOrderBtn").addEventListener("click", copyOrderSummary);
  $("#showCabinAuditBtn")?.addEventListener("click", () => {
    $("#dashboardCabinAuditCard").classList.remove("hidden");
    renderDashboardCabinAudit();
  });
  $("#hideCabinAuditBtn")?.addEventListener("click", () => {
    $("#dashboardCabinAuditCard").classList.add("hidden");
  });
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

function saveNccFromForm(form) {
  const qty = Number(form.qty.value);
  if (!confirmLargeQty(qty, "ncc")) return;

  const item = {
    id: editing?.type === "ncc" ? editing.id : makeId(),
    date: form.date.value,
    machine: form.machine.value,
    product: form.product.value,
    qty
  };

  if (editing?.type === "ncc") {
    state.nccLogs[editing.index] = item;
    lastAction = { type: "editNcc", index: editing.index, oldItem: editing.oldItem };
    editing = null;
    form.querySelector("button[type='submit']").textContent = "Lưu NCC";
    showToast("Đã cập nhật NCC.", true);
  } else {
    state.nccLogs.push(item);
    showToast("Đã lưu NCC thực nhận.");
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

function setupQuickPads() {
  document.querySelectorAll(".quickPad").forEach(pad => {
    const target = pad.dataset.target;
    pad.innerHTML = [1,2,5,10,12,24,28]
      .map(n => `<button type="button" class="quick-btn" data-val="${n}">+${n}</button>`)
      .join("") + `<button type="button" class="quick-btn clear" data-clear="1">Xóa</button>`;

    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const input = document.querySelector(`#${target} input[name='qty']`);
      if (button.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(button.dataset.val);
      input.focus();
    });
  });

  document.querySelectorAll(".adjustPad").forEach(pad => {
    const target = pad.dataset.target;
    pad.innerHTML = `
      <div class="pad-title">Thiếu</div>
      ${[1,2,5,10,12,24,28].map(n => `<button type="button" class="quick-btn danger" data-val="-${n}">-${n}</button>`).join("")}
      <div class="pad-title">Dư</div>
      ${[1,2,5,10,12,24,28].map(n => `<button type="button" class="quick-btn" data-val="${n}">+${n}</button>`).join("")}
      <button type="button" class="quick-btn clear" data-clear="1">Xóa</button>
    `;

    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      const input = document.querySelector(`#${target} input[name='qty']`);
      if (button.dataset.clear) input.value = "";
      else input.value = Number(input.value || 0) + Number(button.dataset.val);
      input.focus();
    });
  });
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

function undoLastAction() {
  if (!lastAction) return;

  if (lastAction.type === "deleteFill") state.fillLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "deleteNcc") state.nccLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "deleteAdjust") state.adjustLogs.splice(lastAction.index, 0, lastAction.item);
  if (lastAction.type === "editFill") state.fillLogs[lastAction.index] = lastAction.oldItem;
  if (lastAction.type === "editNcc") state.nccLogs[lastAction.index] = lastAction.oldItem;
  if (lastAction.type === "editAdjust") state.adjustLogs[lastAction.index] = lastAction.oldItem;

  lastAction = null;
  saveState();
  showToast("Đã hoàn tác.");
}

function editFill(id) {
  const index = state.fillLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.fillLogs[index];
  editing = { type: "fill", id, index, oldItem: { ...item } };

  const form = $("#fillForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  updateSlotOptions();
  form.slot.value = String(item.slot);
  updateProductFromSlot();
  form.qty.value = item.qty;
  form.querySelector("button[type='submit']").textContent = "Cập nhật fill";
  $('[data-view="fill"]').click();
}

function deleteFill(id) {
  const index = state.fillLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.fillLogs[index];
  if (!confirm(`Xóa Fill ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.fillLogs.splice(index, 1);
  lastAction = { type: "deleteFill", index, item };
  saveState();
  showToast("Đã xóa Fill.", true);
}

function editNcc(id) {
  const index = state.nccLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.nccLogs[index];
  editing = { type: "ncc", id, index, oldItem: { ...item } };

  const form = $("#nccForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  form.product.value = item.product;
  form.qty.value = item.qty;
  form.querySelector("button[type='submit']").textContent = "Cập nhật NCC";
  $('[data-view="ncc"]').click();
}

function deleteNcc(id) {
  const index = state.nccLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.nccLogs[index];
  if (!confirm(`Xóa NCC ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.nccLogs.splice(index, 1);
  lastAction = { type: "deleteNcc", index, item };
  saveState();
  showToast("Đã xóa NCC.", true);
}

function editAdjust(id) {
  const index = state.adjustLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.adjustLogs[index];
  editing = { type: "adjust", id, index, oldItem: { ...item } };

  const form = $("#adjustForm");
  form.date.value = item.date;
  form.machine.value = item.machine;
  form.product.value = item.product;
  form.qty.value = item.qty;
  form.reason.value = item.reason || "Đếm lại";
  form.querySelector("button[type='submit']").textContent = "Cập nhật điều chỉnh";
  $('[data-view="adjust"]').click();
}

function deleteAdjust(id) {
  const index = state.adjustLogs.findIndex(item => item.id === id);
  if (index < 0) return;

  const item = state.adjustLogs[index];
  if (!confirm(`Xóa điều chỉnh ${item.machine} - ${item.product} - ${item.qty}?`)) return;

  state.adjustLogs.splice(index, 1);
  lastAction = { type: "deleteAdjust", index, item };
  saveState();
  showToast("Đã xóa điều chỉnh.", true);
}

function buildOrderRows() {
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const rows = [];

  Object.entries(cab).forEach(([key, qty]) => {
    const [machine, product] = key.split("||");
    if (Number(rawCabin[key] || 0) < 0) return;
    const order = suggestOrder(qty, product);
    if (order > 0) rows.push({ machine, product, qty, order, pack: packText(order, product) });
  });

  rows.sort((a, b) => a.machine.localeCompare(b.machine, "vi") || a.product.localeCompare(b.product, "vi"));
  return rows;
}

function totalPacks(rows) {
  return rows.reduce((sum, row) => sum + Number(row.pack?.packs || 0), 0);
}


function machineHealth(machine) {
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const hasNegative = negativeCabinItems().some(item => item.machine === machine);

  if (hasNegative) return { cls: "red", label: "Lỗi" };
  if (rows.some(row => row.pack.packs >= 3)) return { cls: "red", label: "Thiếu" };
  if (rows.length > 0) return { cls: "yellow", label: "Cần đặt" };
  return { cls: "green", label: "Ổn" };
}

function renderRoute() {
  $("#todayText").textContent = viDate();

  const machines = config().machines.map(machine => machine.name);
  if (!activeDashboardMachine || !machines.includes(activeDashboardMachine)) {
    activeDashboardMachine = machines[0] || null;
  }

  $("#routeBadge").textContent = activeDashboardMachine || "Theo máy";
  $("#routeMachines").innerHTML = machines.map(machine => {
    const health = machineHealth(machine);
    return `<button class="machine-dashboard-tab ${machine === activeDashboardMachine ? "active" : ""} ${health.cls}" data-machine="${htmlEscape(machine)}">
      <span>${htmlEscape(machine)}</span>
      <small>${health.label}</small>
    </button>`;
  }).join("");

  $$(".machine-dashboard-tab").forEach(button => {
    button.addEventListener("click", () => {
      activeDashboardMachine = button.dataset.machine;
      activeOrderMachine = activeDashboardMachine;
      localStorage.setItem("fill_assistant_active_machine", activeDashboardMachine);
      renderAll();
    });
  });
}

function renderSummary() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const negatives = negativeCabinItems().filter(item => item.machine === machine).length;
  const orders = buildOrderRows().filter(row => row.machine === machine);
  const packs = totalPacks(orders);

  let low = 0;
  Object.entries(cab).forEach(([key, qty]) => {
    const [m] = key.split("||");
    if (m === machine && Number(qty) <= 12) low++;
  });

  const fillCount = state.fillLogs.filter(log => log.machine === machine).length;
  const nccCount = state.nccLogs.filter(log => log.machine === machine).length;
  const adjustCount = state.adjustLogs.filter(log => log.machine === machine).length;

  $("#summaryBox").innerHTML = [
    ["Máy đang xem", machine || "-"],
    ["Tổng thùng NCC", packs],
    ["Gợi ý NCC", orders.length],
    ["Cabin cần chú ý", low],
    ["Lỗi dữ liệu", negatives],
    ["Fill đã ghi", fillCount],
    ["NCC đã ghi", nccCount],
    ["Điều chỉnh", adjustCount]
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><b>${value}</b></div>`).join("");
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
    lines.push(`- ${row.product}: ${row.pack.packs} thùng (${row.pack.qty} ${row.pack.unit})`);
  });
  return lines.join("\\n");
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const packsTotal = totalPacks(rows);

  $("#orderBox").innerHTML = rows.length ? `
    <div class="total-packs-banner">
      <span>Tổng cần đặt</span>
      <b>${packsTotal} thùng</b>
    </div>
    ${rows.map(row => {
      const level = row.pack.packs >= 3 ? "red" : row.pack.packs === 2 ? "orange" : "yellow";
      return `
        <div class="pill ${level} order-card">
          <div>
            <b>${row.product}</b>
            <small>Tồn cabin: ${row.qty} ${unitName(row.product)}</small>
          </div>
          <div class="order-qty">
            <span>${"📦".repeat(Math.min(row.pack.packs, 4))}</span>
            <strong>${row.pack.packs} thùng</strong>
            <small>${row.pack.qty} ${row.pack.unit}</small>
          </div>
        </div>
      `;
    }).join("")}
  ` : `<p class="muted">Máy ${machine || ""} chưa có sản phẩm nào cần đặt.</p>`;

  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\\n\\nTỔNG: ${packsTotal} THÙNG` : "";

  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="machine-order-card single-machine">
      <div class="machine-order-head">
        <b>${machine}</b>
        <button class="mini copy-machine" data-machine="${machine}">Copy ${machine}</button>
      </div>
      ${rows.map(row => `
        <div class="machine-order-line">
          <span>${row.product}</span>
          <b>${row.pack.packs} thùng</b>
          <small>${row.pack.qty} ${row.pack.unit}</small>
        </div>
      `).join("")}
      <div class="machine-order-total">
        <span>TỔNG</span>
        <b>${packsTotal} thùng</b>
      </div>
    </div>
  ` : `<p class="muted">Không có đơn NCC cho máy này.</p>`;

  $$(".copy-machine").forEach(button => {
    button.addEventListener("click", () => copyOrderSummary());
  });
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

function copyOrderSummary() {
  if (!orderSummaryText) {
    showToast("Máy này chưa có đơn NCC để copy.");
    return;
  }
  copyText(`Đơn NCC ${activeDashboardMachine}:\n${orderSummaryText}`, `Đã copy đơn ${activeDashboardMachine}.`);
}

function renderSlow() {
  const machine = activeDashboardMachine;
  const pairs = unique(config().slots
    .filter(slot => slot.machine === machine)
    .map(slot => `${slot.machine}||${slot.product}`));

  $("#slowBox").innerHTML = pairs.map(key => {
    const [machineName, product] = key.split("||");
    const total30 = getRecentFill(product, machineName, 30);
    const count = state.fillLogs.filter(log => log.machine === machineName && log.product === product).length;

    let cls = "blue";
    let status = `Đang học (${count}/5 lần fill)`;

    if (count >= 5 && total30 <= 5) {
      cls = "yellow";
      status = "Bán chậm 30 ngày";
    }

    if (count >= 5 && total30 > 30) {
      cls = "green";
      status = "Bán tốt";
    }

    return `<div class="pill ${cls}"><b>${product}</b><div class="small">${status} | Fill 30 ngày: ${total30}</div></div>`;
  }).join("") || `<p class="muted">Máy này chưa có dữ liệu slot.</p>`;
}

function renderCabin() {
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const machines = unique([
    ...config().machines.map(machine => machine.name),
    ...Object.keys(cab).map(key => key.split("||")[0])
  ]).sort((a, b) => a.localeCompare(b, "vi"));
  if (!machines.includes(activeCabinMachine)) activeCabinMachine = machines[0] || "";
  if ($("#cabinMachine")) {
    $("#cabinMachine").innerHTML = machines.map(machine => `<option value="${htmlEscape(machine)}">${htmlEscape(machine)}</option>`).join("");
    $("#cabinMachine").value = activeCabinMachine;
  }
  const rows = Object.entries(cab).map(([key, qty]) => {
    const [machine, product] = key.split("||");
    const raw = Number(rawCabin[key] || 0);
    const pack = productInfo(product).pack;
    const status = raw < 0 ? `Lệch ${Math.abs(raw)}` : qty < 12 ? "Sắp hết" : qty < pack ? "Tồn thấp" : "Ổn";
    const cls = raw < 0 || qty < 12 ? "red" : qty < pack ? "yellow" : "green";
    return { machine, product, qty: Number(qty || 0), pack, raw, status, cls };
  }).filter(item => item.machine === activeCabinMachine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));
  const total = rows.reduce((sum, item) => sum + item.qty, 0);
  const attention = rows.filter(item => item.cls !== "green").length;
  $("#cabinSummary").innerHTML = `<div><span>Sản phẩm</span><b>${rows.length}</b></div><div><span>Tổng tồn</span><b>${total}</b></div><div><span>Cần chú ý</span><b>${attention}</b></div>`;
  $("#cabinBox").innerHTML = rows.map(item => {
    const warn = item.raw < 0
      ? `<span class="small warn-text">Lệch ${Math.abs(item.raw)} sản phẩm</span>`
      : item.status === "Sắp hết"
        ? `<span class="cabin-status cabin-status-red">Sắp hết</span>`
        : item.status === "Tồn thấp"
          ? `<span class="cabin-status cabin-status-amber">Tồn thấp</span>`
          : `<span class="cabin-status cabin-status-blue">${htmlEscape(item.status)}</span>`;
    return `<div class="row qty-row ${item.cls}"><span><b>${htmlEscape(item.product)}</b>${warn}</span><b class="qty-num">${item.qty}</b></div>`;
  }).join("") || `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function exportCabinCsv() {
  const machine = activeCabinMachine;
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const rows = Object.entries(cab).map(([key, qty]) => {
    const [rowMachine, product] = key.split("||");
    if (rowMachine !== machine) return null;
    const raw = Number(rawCabin[key] || 0);
    const pack = productInfo(product).pack;
    const status = raw < 0 ? `Lệch ${Math.abs(raw)} sản phẩm` : qty < 12 ? "Sắp hết" : qty < pack ? "Tồn thấp" : "Ổn";
    return [machine, product, Number(qty || 0), status, pack];
  }).filter(Boolean).sort((a, b) => a[1].localeCompare(b[1], "vi"));
  if (!rows.length) return showToast("Máy này chưa có tồn cabin để xuất.");
  const csvRows = [
    ["Tồn cabin - Quản Lý Nhập Hàng"],
    [`Máy: ${machine}`],
    [`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`],
    [],
    ["Máy", "Sản phẩm", "Tồn hiện tại", "Trạng thái", "Sản phẩm/thùng"],
    ...rows,
    [],
    ["TỔNG", "", rows.reduce((sum, row) => sum + Number(row[2] || 0), 0), "", ""]
  ];
  const csv = "\ufeff" + csvRows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ton-cabin-${machine.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Đã xuất tồn cabin ${machine}.`);
}

function renderHistoryV4() {
  const recent = arr => [...arr].reverse().slice(0, 40);

  $("#fillHistory").innerHTML = recent(state.fillLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - Slot ${item.slot} - ${item.product}</span></span>
      <b>${item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editFill('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteFill('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu Fill.</p>`;

  $("#nccHistory").innerHTML = recent(state.nccLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - ${item.product}</span></span>
      <b>${item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editNcc('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteNcc('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu NCC.</p>`;

  $("#adjustHistory").innerHTML = recent(state.adjustLogs).map(item => `
    <div class="row">
      <span>${item.date}<br><span class="small">${item.machine} - ${item.product} - ${item.reason || ""}</span></span>
      <b>${item.qty > 0 ? "+" + item.qty : item.qty}</b>
      <span class="actions">
        <button class="mini" onclick="editAdjust('${item.id}')">Sửa</button>
        <button class="mini danger" onclick="deleteAdjust('${item.id}')">Xóa</button>
      </span>
    </div>
  `).join("") || `<p class="muted">Chưa có dữ liệu điều chỉnh.</p>`;
}

function renderAudit() {
  const negatives = negativeCabinItems();

  $("#auditBox").innerHTML = negatives.length ? negatives.map(item => `
    <div class="pill red">
      <b>${item.machine} - ${item.product}</b>
      <div class="small">Tồn tính toán: ${item.raw} | Hiển thị: 0 | Lệch: ${item.shortage}</div>
      <button class="mini" onclick="quickFixNegative('${item.machine}','${item.product}',${item.shortage})">Tạo điều chỉnh +${item.shortage}</button>
    </div>
  `).join("") : `<div class="pill green"><b>Dữ liệu ổn</b><div class="small">Không có cabin nào bị âm.</div></div>`;
}

function quickFixNegative(machine, product, qty) {
  if (!confirm(`Tạo điều chỉnh +${qty} cho ${machine} - ${product}?`)) return;

  const item = { id: makeId(), date: todayISO(), machine, product, qty: Number(qty), reason: "Sửa cabin âm" };
  state.adjustLogs.push(item);
  lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
  saveState();
  showToast("Đã tạo điều chỉnh.", true);
}

function renderQuickFill() {
  const machine = $("#quickMachine").value;
  const slots = config().slots
    .filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));

  if (!slots.length) {
    $("#quickFillBox").innerHTML = `<p class="muted">Máy này chưa có slot.</p>`;
    return;
  }

  $("#quickFillBox").innerHTML = `
    <div class="quick-fill-list">
      ${slots.map(slot => `
        <div class="slot-card" data-machine="${htmlEscape(slot.machine)}" data-slot="${Number(slot.slot)}" data-product="${htmlEscape(slot.product)}">
          <div class="quick-slot-info">
            <b>Slot ${slot.slot}</b>
            <span>${htmlEscape(slot.product)}${slot.max ? ` · Max ${Number(slot.max)}` : ""}</span>
          </div>
          <div class="slot-controls compact embedded">
            <div class="quick-qty-control">
              <input type="number" min="0" step="1" inputmode="numeric" placeholder="0" />
              <div class="slot-actions inline">
                ${[1,2,3,5].map(n => `<button type="button" data-val="${n}">+${n}</button>`).join("")}
              </div>
            </div>
            <button type="button" class="clear-slot" data-clear="1">Xóa</button>
          </div>
        </div>
      `).join("")}
    </div>
    <div class="quick-fill-footer">
      <div>
        <b id="quickFillPending">0 slot</b>
        <span>có số lượng chờ lưu</span>
      </div>
      <div class="quick-fill-footer-actions">
        <button type="button" id="clearQuickFillBtn" class="btn ghost">Xóa hết</button>
        <button type="button" id="saveQuickFillBtn" class="btn primary">Lưu các slot đã nhập</button>
      </div>
    </div>
  `;

  const box = $("#quickFillBox");

  box.oninput = event => {
    if (event.target.matches(".slot-card input")) updateQuickFillPending();
  };

  box.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;

    const card = button.closest(".slot-card");
    if (card && button.dataset.clear) {
      $("input", card).value = "";
      updateQuickFillPending();
      return;
    }

    if (card && button.dataset.val) {
      const input = $("input", card);
      input.value = Number(input.value || 0) + Number(button.dataset.val);
      updateQuickFillPending();
      return;
    }

    if (button.id === "clearQuickFillBtn") {
      $$(".slot-card input", box).forEach(input => { input.value = ""; });
      updateQuickFillPending();
      return;
    }

    if (button.id === "saveQuickFillBtn") {
      saveQuickFillBatch();
    }
  };

  updateQuickFillPending();
}

function getQuickFillEntries() {
  return $$(".slot-card", $("#quickFillBox"))
    .map(card => ({
      card,
      machine: card.dataset.machine,
      slot: Number(card.dataset.slot),
      product: card.dataset.product,
      qty: Number($("input", card).value || 0)
    }))
    .filter(item => item.qty > 0);
}

function updateQuickFillPending() {
  const pending = getQuickFillEntries();
  const total = pending.reduce((sum, item) => sum + item.qty, 0);
  const label = $("#quickFillPending");
  if (label) label.textContent = `${pending.length} slot · ${total} món`;
}

function saveQuickFillBatch() {
  const entries = getQuickFillEntries();

  if (!entries.length) {
    showToast("Chưa nhập số lượng fill.");
    return;
  }

  const large = entries.filter(item => item.qty >= 100 || item.qty > 50);
  if (large.length) {
    const preview = large.map(item => `Slot ${item.slot}: ${item.qty}`).join(", ");
    if (!confirm(`Có số lượng khá lớn (${preview}). Lưu tất cả slot này?`)) return;
  }

  entries.forEach(item => {
    state.fillLogs.push({
      id: makeId(),
      date: todayISO(),
      machine: item.machine,
      slot: item.slot,
      product: item.product,
      qty: item.qty
    });
  });

  entries.forEach(item => { $("input", item.card).value = ""; });
  saveState();
  showToast(`Đã lưu ${entries.length} slot fill.`, true);
}

function renderSelectedCabin() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#selectedCabinBox");
  if (!box) return;

  box.innerHTML = items.length ? items.map(item => {
    const raw = currentCabin()[`${machine}||${item.product}`] || 0;
    const cls = raw < 0 ? "red" : item.qty < 12 ? "red" : item.qty < productInfo(item.product).pack ? "yellow" : "green";
    const warn = raw < 0 ? `<br><span class="small warn-text">⚠ Lệch ${Math.abs(raw)} ${unitName(item.product)}</span>` : "";
    return `<div class="row qty-row ${cls}"><span>${item.product}${warn}</span><b class="qty-num">${item.qty}</b></div>`;
  }).join("") : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function renderDashboardCabinAudit() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#dashboardCabinAuditBox");
  if (!box) return;

  box.innerHTML = items.length ? `
    <div class="cabin-audit-list">
      ${items.map(item => `
        <div class="cabin-audit-row" data-machine="${item.machine}" data-product="${item.product}" data-current="${item.qty}">
          <div>
            <b>${item.product}</b>
            <span>Hiện tại: ${item.qty} ${unitName(item.product)}</span>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" value="${item.qty}" />
          <button class="mini save-audit">Lưu</button>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;

  $$(".save-audit", box).forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".cabin-audit-row");
      const machine = row.dataset.machine;
      const product = row.dataset.product;
      const current = Number(row.dataset.current || 0);
      const actual = Number($("input", row).value || 0);
      const diff = actual - current;

      if (diff === 0) {
        showToast(`${product}: không có chênh lệch.`);
        return;
      }

      const item = {
        id: makeId(),
        date: todayISO(),
        machine,
        product,
        qty: diff,
        reason: "Kiểm kê"
      };

      state.adjustLogs.push(item);
      lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
      saveState();
      $("#dashboardCabinAuditCard").classList.remove("hidden");
      showToast(`Đã điều chỉnh ${product}: ${diff > 0 ? "+" : ""}${diff}.`, true);
    });
  });
}

function machineHealth(machine) {
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const hasNegative = negativeCabinItems().some(item => item.machine === machine);

  if (hasNegative) return { cls: "red", label: "Lỗi" };
  if (rows.some(row => row.pack.packs >= 3)) return { cls: "red", label: "Thiếu nặng" };
  if (rows.length > 0) return { cls: "yellow", label: "Cần đặt" };
  return { cls: "green", label: "Ổn" };
}

function dashboardAttentionRows(machine) {
  const cab = displayCabin();
  return Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      const raw = currentCabin()[key] || 0;
      const order = raw < 0 ? 0 : suggestOrder(qty, product);
      return { machine: m, product, qty, raw, order, pack: packText(order, product) };
    })
    .filter(item => item.machine === machine && (item.raw < 0 || item.qty <= 12 || item.order > 0))
    .sort((a, b) => {
      if (a.raw < 0 && b.raw >= 0) return -1;
      if (b.raw < 0 && a.raw >= 0) return 1;
      if (b.order !== a.order) return b.order - a.order;
      return a.qty - b.qty || a.product.localeCompare(b.product, "vi");
    });
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
  $("#quickMachine")?.addEventListener("change", renderQuickFill);
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
      ${[1, 2, 3, 5].map(value => `<button type="button" class="quick-btn" data-add-boxes="${value}">+${value}</button>`).join("")}
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

function saveNccBatch(form) {
  if (!requirePermission("receive")) return;
  const rows = mergedNccBatchRows();
  if (!rows.length) return showToast("Chưa nhập số thùng.");
  if (rows.some(item => !Number.isInteger(item.boxes) || item.boxes <= 0)) return showToast("Số thùng phải là số nguyên lớn hơn 0.");
  const batchId = makeId();
  const recordedAt = new Date().toISOString();
  const date = form.date.value || todayISO();
  rows.forEach(item => state.nccLogs.push(touchRecord({
    id: makeId(), batch_id: batchId, date, machine: item.machine, product: item.product,
    boxes: item.boxes, qty: item.boxes * productInfo(item.product).pack, recorded_at: recordedAt
  })));
  resetNccBatch();
  saveState();
  showToast(`Đã lưu lô ${rows.length} dòng, ${rows.reduce((sum, item) => sum + item.boxes, 0)} thùng.`);
}

function setHistoryRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - Math.max(0, days - 1));
  $("#historyDate").value = localISODate(start);
  $("#historyToDate").value = localISODate(end);
  renderHistory();
}

function filteredHistoryRows() {
  const [key] = historySource();
  const fromDate = $("#historyDate")?.value || "";
  const toDate = $("#historyToDate")?.value || "";
  if (fromDate && toDate && fromDate > toDate) return [];
  const machine = $("#historyMachine")?.value || "";
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  return activeLogRows(key).filter(item => (!fromDate || item.date >= fromDate)
    && (!toDate || item.date <= toDate)
    && (!machine || canonicalMachineName(item.machine) === machine)
    && (!query || String(item.product).toLocaleLowerCase("vi").includes(query)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))
      || String(b.recorded_at || b.updated_at || "").localeCompare(String(a.recorded_at || a.updated_at || "")));
}

function historyDayLabel(date) {
  if (date === todayISO()) return "Hôm nay";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localISODate(yesterday)) return "Hôm qua";
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("vi-VN");
}

function historyTime(item) {
  const value = item.recorded_at || item.updated_at;
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("vi-VN", { hour12: false });
}

function historyRowHtml(item) {
  const amount = activeHistoryType === "ncc" ? `${nccBoxes(item)} thùng · ${item.qty} sản phẩm`
    : activeHistoryType === "adjust" ? `${item.qty > 0 ? "+" : ""}${item.qty} sản phẩm` : `${item.qty} sản phẩm`;
  const detail = activeHistoryType === "fill" ? `Slot ${item.slot} · ${item.product}`
    : activeHistoryType === "adjust" ? `${item.product} · ${item.reason || "Kiểm kê cabin"}` : item.product;
  const permission = activeHistoryType === "fill" ? "fill" : activeHistoryType === "ncc" ? "receive" : "stocktake";
  const actions = hasPermission(permission) ? `<div class="actions"><button class="mini" data-history-action="edit" data-history-type="${activeHistoryType}" data-history-id="${htmlEscape(item.id)}">Sửa</button><button class="mini danger" data-history-action="delete" data-history-type="${activeHistoryType}" data-history-id="${htmlEscape(item.id)}">Xóa</button></div>` : "";
  return `<div class="history-row"><div><b>${historyTime(item) || "Không rõ giờ"} · ${htmlEscape(item.machine)}</b><span>${htmlEscape(detail)}</span></div><strong>${htmlEscape(amount)}</strong>${actions}</div>`;
}

function renderHistoryV4Runtime() {
  const [, label] = historySource();
  const fromDate = $("#historyDate")?.value || "";
  const toDate = $("#historyToDate")?.value || "";
  if (fromDate && toDate && fromDate > toDate) {
    $("#historyCount").textContent = "0 bản ghi";
    $("#historyList").innerHTML = `<p class="muted">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>`;
    if ($("#exportHistoryCsvBtn")) $("#exportHistoryCsvBtn").disabled = true;
    return;
  }
  const rows = filteredHistoryRows();
  $("#historyCount").textContent = `${rows.length} bản ghi`;
  const exportButton = $("#exportHistoryCsvBtn");
  exportButton?.classList.toggle("hidden", !syncUser);
  if (exportButton) exportButton.disabled = !rows.length;
  const days = new Map();
  rows.forEach(item => {
    if (!days.has(item.date)) days.set(item.date, []);
    days.get(item.date).push(item);
  });
  const historyList = $("#historyList");
  historyList.innerHTML = [...days.entries()].map(([date, dayRows]) => {
    let content = "";
    if (activeHistoryType === "ncc") {
      const batches = new Map();
      dayRows.forEach(item => {
        const key = item.batch_id || item.id;
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(item);
      });
      content = [...batches.entries()].map(([batchId, batchRows]) => {
        const boxes = batchRows.reduce((sum, item) => sum + nccBoxes(item), 0);
        const deleteButton = hasPermission("receive") && batchRows[0].batch_id
          ? `<button type="button" class="mini danger" data-history-action="delete-batch" data-batch-id="${htmlEscape(batchId)}">Xóa lô</button>` : "";
        return `<section class="history-batch"><div class="history-batch-head"><span>Lô ${historyTime(batchRows[0]) || "cũ"} · ${batchRows.length} dòng · ${boxes} thùng</span>${deleteButton}</div>${batchRows.map(historyRowHtml).join("")}</section>`;
      }).join("");
    } else content = dayRows.map(historyRowHtml).join("");
    return `<h3 class="history-day">${historyDayLabel(date)} · ${date}</h3>${content}`;
  }).join("") || `<p class="muted">Chưa có lịch sử ${label} trong khoảng đã chọn.</p>`;
  historyList.onclick = event => {
    const button = event.target.closest("[data-history-action]");
    if (!button) return;
    if (button.dataset.historyAction === "delete-batch") return deleteNccBatch(button.dataset.batchId);
    const handlers = {
      "edit-fill": editFill, "delete-fill": deleteFill,
      "edit-ncc": editNcc, "delete-ncc": deleteNcc,
      "edit-adjust": editAdjust, "delete-adjust": deleteAdjust
    };
    handlers[`${button.dataset.historyAction}-${button.dataset.historyType}`]?.(button.dataset.historyId);
  };
}

function deleteNccBatch(batchId) {
  if (!requirePermission("receive")) return;
  const rows = activeLogRows("nccLogs").filter(item => item.batch_id === batchId);
  if (!rows.length || !confirm(`Xóa toàn bộ lô ${rows.length} dòng?`)) return;
  rows.forEach(item => touchRecord(item, true));
  saveState();
  showToast(`Đã xóa lô ${rows.length} dòng.`);
}

function downloadCsvFile(rows, filename) {
  const csv = "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportHistoryCsv() {
  if (!syncUser) return openAuthModal();
  const rows = filteredHistoryRows();
  if (!rows.length) return showToast("Không có lịch sử để xuất.");
  const [, label] = historySource();
  const csvRows = [
    [`Lịch sử ${label} - Quản Lý Nhập Hàng`],
    [`Từ ${$("#historyDate").value || "đầu kỳ"} đến ${$("#historyToDate").value || "hiện tại"}`],
    [],
    ["Ngày", "Giờ", "Loại", "Máy", "Slot", "Sản phẩm", "Số thùng", "Số sản phẩm/chênh lệch", "Lý do", "Mã lô", "Người ghi", "ID"]
  ];
  rows.forEach(item => csvRows.push([
    item.date, historyTime(item), label, item.machine, item.slot ?? "", item.product,
    activeHistoryType === "ncc" ? nccBoxes(item) : "", item.qty, item.reason || "", item.batch_id || "",
    item.created_by || item.user_id || "", item.id
  ]));
  downloadCsvFile(csvRows, `lich-su-${activeHistoryType}-${$("#historyDate").value || "tat-ca"}-${$("#historyToDate").value || todayISO()}.csv`);
  showToast(`Đã xuất ${rows.length} bản ghi CSV.`);
}

function renderSummary() {
  const machine = activeDashboardMachine;
  const negatives = negativeCabinItems().filter(item => item.machine === machine).length;
  const orders = buildOrderRows().filter(row => row.machine === machine);
  const packs = totalPacks(orders);
  const attention = dashboardAttentionRows(machine);
  const health = machineHealth(machine);
  const priorityText = packs > 0
    ? `${machine}: cần đặt ${packs} thùng cho ${orders.length} món`
    : `${machine}: chưa cần đặt NCC`;

  $("#priorityBox").innerHTML = `
    <div>
      <span>Ưu tiên hôm nay</span>
      <b>${priorityText}</b>
    </div>
    <strong class="${health.cls}">${health.label}</strong>
  `;

  $("#summaryBox").innerHTML = [
    ["Tổng thùng", packs],
    ["Món cần đặt", orders.length],
    ["Tồn cần chú ý", attention.length],
    ["Lỗi dữ liệu", negatives]
  ].map(([label, value]) => `<div class="summary-card action-metric"><span>${label}</span><b>${value}</b></div>`).join("");
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const attention = dashboardAttentionRows(machine);
  const packsTotal = totalPacks(rows);

  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\n\nTỔNG: ${packsTotal} THÙNG` : "";

  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="dashboard-order-head">
      <div>
        <span>Đơn NCC ${machine}</span>
        <b>${packsTotal} thùng</b>
      </div>
      <small>${rows.length} món cần đặt</small>
    </div>
    <div class="dashboard-order-list">
      ${rows.map(row => `
        <div class="dashboard-order-row">
          <span>${row.product}</span>
          <b>${row.pack.packs} thùng</b>
          <small>${row.pack.qty} ${row.pack.unit}</small>
        </div>
      `).join("")}
    </div>
  ` : `<div class="empty-state"><b>${machine || "Máy này"} đang ổn</b><span>Chưa có món nào cần đặt NCC.</span></div>`;

  $("#orderBox").innerHTML = attention.length ? `
    <div class="attention-list">
      ${attention.slice(0, 12).map(item => {
        const level = item.raw < 0 ? "red" : item.qty <= 2 ? "red" : item.qty <= 12 ? "yellow" : "blue";
        const action = item.order > 0 ? `${item.pack.packs} thùng` : "Kiểm tra";
        const warn = item.raw < 0 ? `Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : `Tồn ${item.qty} ${unitName(item.product)}`;
        return `
          <div class="attention-row ${level}">
            <div>
              <b>${item.product}</b>
              <span>${warn}</span>
            </div>
            <strong>${action}</strong>
          </div>
        `;
      }).join("")}
    </div>
  ` : `<div class="empty-state"><b>Không có tồn thấp</b><span>Máy này chưa có mục nào cần chú ý.</span></div>`;
}

function renderSlow() {
  const machine = activeDashboardMachine;
  const pairs = unique(config().slots
    .filter(slot => slot.machine === machine)
    .map(slot => `${slot.machine}||${slot.product}`));

  const rows = pairs.map(key => {
    const [machineName, product] = key.split("||");
    const total30 = getRecentFill(product, machineName, 30);
    const count = state.fillLogs.filter(log => log.machine === machineName && log.product === product).length;

    let cls = "blue";
    let status = `Đang học (${count}/5 lần fill)`;
    if (count >= 5 && total30 <= 5) {
      cls = "yellow";
      status = "Bán chậm 30 ngày";
    }
    if (count >= 5 && total30 > 30) {
      cls = "green";
      status = "Bán tốt";
    }
    return { product, total30, count, cls, status };
  });

  $("#slowBox").innerHTML = rows.slice(0, 12).map(item => `
    <div class="compact-info-row ${item.cls}">
      <b>${htmlEscape(item.product)}</b>
      <span>${htmlEscape(item.status)} · Fill 30 ngày: ${item.total30}</span>
    </div>
  `).join("") || `<p class="muted">Máy này chưa có dữ liệu slot.</p>`;
}

function renderSelectedCabin() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty, raw: currentCabin()[key] || 0 };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#selectedCabinBox");
  if (!box) return;

  box.innerHTML = items.length ? items.map(item => {
    const cls = item.raw < 0 ? "red" : item.qty < 12 ? "red" : item.qty < productInfo(item.product).pack ? "yellow" : "green";
    const warn = item.raw < 0 ? ` · Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : "";
    return `<div class="compact-info-row ${cls}"><b>${htmlEscape(item.product)}</b><span>${item.qty} ${unitName(item.product)}${htmlEscape(warn)}</span></div>`;
  }).join("") : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function renderSummary() {
  const machine = activeDashboardMachine;
  const negatives = negativeCabinItems().filter(item => item.machine === machine).length;
  const orders = buildOrderRows().filter(row => row.machine === machine);
  const packs = totalPacks(orders);
  const attention = dashboardAttentionRows(machine);
  const health = machineHealth(machine);
  const priorityText = packs > 0
    ? `${machine}: cần đặt ${packs} thùng`
    : `${machine}: chưa cần đặt NCC`;

  $("#priorityBox").innerHTML = `
    <div>
      <span>Ưu tiên hôm nay</span>
      <b>${priorityText}</b>
    </div>
    <strong class="${health.cls}">${health.label}</strong>
  `;

  $("#summaryBox").innerHTML = [
    ["Thùng NCC", packs],
    ["Sản phẩm NCC", orders.length],
    ["Cần kiểm tra", attention.length],
    ["Lệch cabin", negatives]
  ].map(([label, value]) => `<div class="summary-card action-metric"><span>${label}</span><b>${value}</b></div>`).join("");
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

function exportNccCsv() {
  const machines = selectedNccExportMachines();
  const rows = buildOrderRows().filter(row => machines.includes(row.machine));

  if (!machines.length) {
    showToast("Chưa chọn máy để xuất CSV.");
    return;
  }

  if (!rows.length) {
    showToast("Các máy đã chọn chưa có thùng NCC cần đặt.");
    return;
  }

  const grouped = groupOrdersByMachine(rows);
  const createdAt = new Date().toLocaleString("vi-VN");
  const csvRows = [];

  csvRows.push(["Đơn nhập hàng - Quản Lý Nhập Hàng"]);
  csvRows.push([`Xuất lúc: ${createdAt}`]);
  csvRows.push([]);
  csvRows.push(["Máy", "Sản phẩm", "Số thùng", "Quy đổi", "Đơn vị", "Tồn cabin"]);

  machines.forEach(machine => {
    const machineRows = grouped[machine] || [];
    if (!machineRows.length) return;

    machineRows.forEach(row => {
      csvRows.push([machine, row.product, row.pack.packs, row.pack.qty, row.pack.unit, row.qty]);
    });

    csvRows.push([`Tổng ${machine}`, "", totalPacks(machineRows), "", "", ""]);
    csvRows.push([]);
  });

  csvRows.push(["TỔNG TẤT CẢ", "", totalPacks(rows), "", "", ""]);

  const csv = "\ufeff" + csvRows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `don-ncc-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Đã xuất CSV ${machines.length} máy.`);
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const attention = dashboardAttentionRows(machine);
  const packsTotal = totalPacks(rows);
  const exportMachines = nccMachinesWithOrders();

  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\n\nTỔNG: ${packsTotal} THÙNG` : "";

  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="dashboard-order-head">
      <div>
        <span>Đơn NCC ${machine}</span>
        <b>${packsTotal} thùng</b>
      </div>
      <small>${packsTotal} thùng cần đặt</small>
    </div>
    <div class="dashboard-order-list">
      ${rows.map(row => `
        <div class="dashboard-order-row">
          <span>${row.product}</span>
          <b>${row.pack.packs} thùng</b>
          <small>${row.pack.qty} ${row.pack.unit}</small>
        </div>
      `).join("")}
    </div>
    <div class="excel-export-box">
      <div class="excel-export-head">
        <b>Xuất CSV đơn NCC</b>
        <button type="button" id="selectAllNccMachines" class="mini">Chọn tất cả</button>
      </div>
      <div id="nccExportMachines" class="machine-check-list">
        ${exportMachines.map(name => `
          <label>
            <input type="checkbox" value="${htmlEscape(name)}" ${name === machine ? "checked" : ""} />
            <span>${name}</span>
          </label>
        `).join("")}
      </div>
      <button type="button" id="exportNccCsvBtn" class="btn primary">Xuất CSV mở bằng Excel</button>
    </div>
  ` : `<div class="empty-state"><b>${machine || "Máy này"} đang ổn</b><span>Chưa có sản phẩm nào cần đặt NCC.</span></div>`;

  $("#orderBox").innerHTML = attention.length ? `
    <div class="attention-list">
      ${attention.slice(0, 12).map(item => {
        const level = item.raw < 0 ? "red" : item.qty <= 2 ? "red" : item.qty <= 12 ? "yellow" : "blue";
        const action = item.order > 0 ? `${item.pack.packs} thùng` : "Kiểm tra";
        const warn = item.raw < 0 ? `Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : `Tồn ${item.qty} ${unitName(item.product)}`;
        return `
          <div class="attention-row ${level}">
            <div>
              <b>${item.product}</b>
              <span>${warn}</span>
            </div>
            <strong>${action}</strong>
          </div>
        `;
      }).join("")}
    </div>
  ` : `<div class="empty-state"><b>Không có tồn thấp</b><span>Máy này chưa có mục nào cần chú ý.</span></div>`;

  $$(".copy-machine").forEach(button => {
    button.addEventListener("click", () => copyOrderSummary());
  });

  $("#exportNccCsvBtn")?.addEventListener("click", exportNccCsv);
  $("#selectAllNccMachines")?.addEventListener("click", () => {
    const inputs = $$("#nccExportMachines input");
    const shouldCheck = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = shouldCheck; });
  });
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

function ensureSyncView() {
  document.querySelector(".app-header p").textContent = "V3.4.3 - Supabase Sync";
  ensureHeaderSyncLogin();

  const header = $(".app-header");
  if (header && !$("#syncBadge")) {
    const badge = document.createElement("span");
    badge.id = "syncBadge";
    badge.className = "sync-badge";
    badge.textContent = "Local";
    header.insertBefore(badge, $("#installBtn"));
  }

  const adminMode = isSyncAdminMode();
  const builtInConfig = hasBuiltInSyncConfig();

  if (!adminMode && !builtInConfig) {
    $('[data-view="sync"]')?.remove();
    $("#sync")?.remove();
    return;
  }

  const tabs = $(".tabs");
  if (tabs && !$('[data-view="sync"]')) {
    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.view = "sync";
    button.textContent = "Đồng bộ";
    tabs.appendChild(button);
  }

  const main = $("main");
  if (main && !$("#sync")) {
    const section = document.createElement("section");
    section.id = "sync";
    section.className = "view";
    section.innerHTML = `
      <article class="card">
        <div class="section-head">
          <h2>Đồng bộ Supabase</h2>
          <span id="syncStatusPill" class="hint">Local</span>
        </div>
        <div id="syncOverview" class="sync-overview"></div>
      </article>
      <article class="card">
        <h2>Cấu hình Supabase</h2>
        <form id="syncConfigForm">
          <label>Project URL <input name="url" type="url" placeholder="https://xxxx.supabase.co" /></label>
          <label>Publishable / anon key <input name="key" type="text" autocomplete="off" placeholder="sb_publishable_..." /></label>
          <button type="submit" class="btn primary">Lưu cấu hình</button>
        </form>
      </article>
      <article class="card">
        <h2>Đăng nhập</h2>
        <form id="syncLoginForm">
          <label>Email <input name="email" type="email" autocomplete="email" /></label>
          <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" /></label>
          <button type="submit" class="btn primary">Đăng nhập Supabase</button>
        </form>
        <div class="button-row sync-actions">
          <button id="syncNowBtn" class="btn primary">Đồng bộ ngay</button>
          <button id="syncLogoutBtn" class="btn ghost">Đăng xuất</button>
        </div>
      </article>
    `;
    main.appendChild(section);
  }

  const saved = syncConfig();
  const form = $("#syncConfigForm");
  if (form) {
    form.closest(".card")?.classList.toggle("hidden", !adminMode);
    form.url.value = saved.url || "";
    form.key.value = saved.key || "";
  }
}

function pendingSyncCount() {
  return ["fillLogs", "nccLogs", "adjustLogs"]
    .reduce((sum, key) => sum + state[key].filter(item => item._sync === "pending").length, 0);
}

function syncTables() {
  return [
    { table: "fill_logs", key: "fillLogs", fields: ["id", "date", "machine", "slot", "product", "qty", "created_at", "updated_at", "device_id", "user_id"] },
    { table: "ncc_logs", key: "nccLogs", fields: ["id", "date", "machine", "product", "qty", "created_at", "updated_at", "device_id", "user_id"] },
    { table: "adjust_logs", key: "adjustLogs", fields: ["id", "date", "machine", "product", "qty", "reason", "created_at", "updated_at", "device_id", "user_id"] }
  ];
}

function renderSyncStatus() {
  const cfg = syncConfig();
  const configured = Boolean(cfg.url && cfg.key);
  const online = navigator.onLine;
  const pending = pendingSyncCount();
  const label = syncBusy ? "Đang đồng bộ" : syncStatusText;
  const badgeText = !configured ? "Local" : !online ? `Offline ${pending}` : pending ? `Chờ sync ${pending}` : label;

  $("#syncBadge") && ($("#syncBadge").textContent = badgeText);
  $("#syncStatusPill") && ($("#syncStatusPill").textContent = badgeText);
  $("#headerSyncLoginForm")?.classList.toggle("hidden", Boolean(syncUser));
  $("#headerSyncAccount")?.classList.toggle("hidden", !syncUser);
  $("#headerSyncEmail") && ($("#headerSyncEmail").textContent = syncUser?.email || "");
  $("#syncOverview") && ($("#syncOverview").innerHTML = `
    <div class="sync-status-grid">
      <div><span>Kết nối</span><b>${online ? "Online" : "Offline"}</b></div>
      <div><span>Cấu hình</span><b>${configured ? "Đã lưu" : "Chưa có"}</b></div>
      <div><span>Tài khoản</span><b>${syncUser?.email || "Chưa đăng nhập"}</b></div>
      <div><span>Chưa đồng bộ</span><b>${pending}</b></div>
    </div>
    <p class="muted">App luôn lưu local trước. Khi online và đã đăng nhập, bấm đồng bộ hoặc nhập dữ liệu mới để đẩy lên Supabase.</p>
  `);
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

async function initSyncClient() {
  const cfg = syncConfig();
  if (!cfg.url || !cfg.key) {
    syncClient = null;
    syncUser = null;
    syncStatusText = "Chưa cấu hình";
    renderSyncStatus();
    return false;
  }
  await loadSupabaseScript();
  syncClient = window.supabase.createClient(cfg.url, cfg.key);
  const { data } = await syncClient.auth.getUser();
  syncUser = data?.user || null;
  syncStatusText = syncUser ? "Đã kết nối" : "Chưa đăng nhập";
  renderSyncStatus();
  return true;
}

function cleanSyncRecord(item, fields, userId) {
  const now = new Date().toISOString();
  item.id ||= makeId();
  item.created_at ||= now;
  item.updated_at ||= now;
  item.device_id ||= deviceId();
  const record = { user_id: userId };
  fields.forEach(field => {
    if (field !== "user_id") record[field] = item[field] ?? null;
  });
  return record;
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

async function syncNow() {
  if (syncBusy) return;
  syncBusy = true;
  syncStatusText = "Đang đồng bộ";
  renderSyncStatus();
  try {
    if (!navigator.onLine) throw new Error("Thiết bị đang offline.");
    await initSyncClient();
    if (!syncClient) throw new Error("Chưa cấu hình Supabase.");
    const { data: userData, error: userError } = await syncClient.auth.getUser();
    if (userError) throw userError;
    syncUser = userData?.user || null;
    if (!syncUser) throw new Error("Chưa đăng nhập Supabase.");

    for (const meta of syncTables()) {
      const pending = state[meta.key].filter(item => item._sync === "pending" || !item.updated_at);
      if (pending.length) {
        const records = pending.map(item => cleanSyncRecord(item, meta.fields, syncUser.id));
        const { error } = await syncClient.from(meta.table).upsert(records, { onConflict: "id" });
        if (error) throw error;
        pending.forEach(item => { item._sync = "synced"; });
      }
      const { data, error } = await syncClient.from(meta.table).select("*").order("updated_at", { ascending: true });
      if (error) throw error;
      mergeRemoteRows(meta.key, data || []);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    syncStatusText = "Đã đồng bộ";
    renderAll();
    showToast("Đã đồng bộ Supabase.");
  } catch (error) {
    syncStatusText = "Lỗi đồng bộ";
    renderSyncStatus();
    showToast(error.message || "Không đồng bộ được Supabase.");
  } finally {
    syncBusy = false;
    renderSyncStatus();
  }
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

async function signInSupabase(email, password) {
  await initSyncClient();
  if (!syncClient) throw new Error("ChÆ°a cáº¥u hÃ¬nh Supabase.");
  const { data, error } = await syncClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  syncUser = data.user;
  syncStatusText = "ÄÃ£ Ä‘Äƒng nháº­p";
  renderSyncStatus();
  showToast("ÄÃ£ Ä‘Äƒng nháº­p Supabase.");
  queueAutoSync();
}

async function signOutSupabase() {
  if (syncClient) await syncClient.auth.signOut();
  syncUser = null;
  syncStatusText = "ÄÃ£ Ä‘Äƒng xuáº¥t";
  renderSyncStatus();
  showToast("ÄÃ£ Ä‘Äƒng xuáº¥t Supabase.");
}

function setupSyncForms() {
  $("#syncConfigForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    saveSyncConfig({ url: form.url.value.trim(), key: form.key.value.trim() });
    try {
      await initSyncClient();
      showToast("Đã lưu cấu hình Supabase.");
    } catch (error) {
      showToast(error.message || "Không kết nối được Supabase.");
    }
  });
  $("#syncLoginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    try {
      await initSyncClient();
      if (!syncClient) throw new Error("Chưa cấu hình Supabase.");
      const { data, error } = await syncClient.auth.signInWithPassword({
        email: form.email.value.trim(),
        password: form.password.value
      });
      if (error) throw error;
      syncUser = data.user;
      syncStatusText = "Đã đăng nhập";
      renderSyncStatus();
      showToast("Đã đăng nhập Supabase.");
      queueAutoSync();
    } catch (error) {
      showToast(error.message || "Không đăng nhập được.");
    }
  });
  $("#syncNowBtn")?.addEventListener("click", syncNow);
  $("#headerSyncLoginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    try {
      await signInSupabase(form.email.value.trim(), form.password.value);
      form.password.value = "";
    } catch (error) {
      showToast(error.message || "KhÃ´ng Ä‘Äƒng nháº­p Ä‘Æ°á»£c.");
    }
  });
  $("#headerSyncNowBtn")?.addEventListener("click", syncNow);
  $("#headerSyncLogoutBtn")?.addEventListener("click", signOutSupabase);
  $("#syncLogoutBtn")?.addEventListener("click", async () => {
    if (syncClient) await syncClient.auth.signOut();
    syncUser = null;
    syncStatusText = "Đã đăng xuất";
    renderSyncStatus();
    showToast("Đã đăng xuất Supabase.");
  });
  window.addEventListener("online", () => {
    syncStatusText = "Online";
    renderSyncStatus();
    queueAutoSync();
  });
  window.addEventListener("offline", () => {
    syncStatusText = "Offline";
    renderSyncStatus();
  });
}

function renderAll() {
  renderRoute();
  renderSummary();
  renderOrders();
  renderSlow();
  renderCabin();
  renderHistory();
  renderAudit();
  renderQuickFill();
  renderSelectedCabin();
  if (!$("#dashboardCabinAuditCard")?.classList.contains("hidden")) {
    renderDashboardCabinAudit();
  }
  renderSyncStatus();
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ version: APP_VERSION, config: config(), state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `quan-ly-nhap-hang-backup-${todayISO()}.json`;
  a.click();
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

function applyPermissions() {
  const authenticated = Boolean(syncUser || syncAccess);
  $$('[data-auth-required]').forEach(element => {
    element.classList.toggle("hidden", !authenticated);
  });
  $$('[data-permission]').forEach(element => {
    element.classList.toggle("hidden", !hasPermission(element.dataset.permission));
  });
  const activeRestricted = $(".tab.active[data-permission]");
  if (activeRestricted && !hasPermission(activeRestricted.dataset.permission)) activateView("dashboard");
  const activeAuthRequired = $(".tab.active[data-auth-required]");
  if (activeAuthRequired && !authenticated) activateView("dashboard");
  $("#memberAdminCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#syncConfigCard")?.classList.toggle("hidden", !(hasPermission("manage") && isSyncAdminMode()));
}

function stampRecordOwner(item) {
  if (!syncAccess) return item;
  item.workspace_id ||= syncAccess.workspace_id;
  item.created_by ||= syncAccess.user_id;
  item.user_id ||= syncAccess.user_id;
  return item;
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
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeLogRows(key) {
  return state[key].filter(item => !item.deleted_at);
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
      else {
        delete copy.deleted_at;
        touchRecord(copy);
      }
      rows.set(copy.id, copy);
    });
    state[key].forEach(item => {
      if (rows.has(item.id)) return;
      rows.set(item.id, touchRecord({ ...item }, true));
    });
    result[key] = [...rows.values()];
  });
  return result;
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

function currentCabin() {
  const map = {};
  const add = (machine, product, qty) => {
    if (!machine || !product) return;
    const key = `${machine}||${product}`;
    map[key] = (map[key] || 0) + Number(qty || 0);
  };
  config().initialCabin?.forEach(x => add(x.machine, x.product, x.qty));
  activeLogRows("nccLogs").forEach(x => add(x.machine, x.product, x.qty));
  activeLogRows("adjustLogs").forEach(x => add(x.machine, x.product, x.qty));
  activeLogRows("fillLogs").forEach(x => add(x.machine, x.product, -x.qty));
  return map;
}

function getRecentFill(product, machine, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return activeLogRows("fillLogs")
    .filter(log => log.product === product && log.machine === machine && new Date(log.date) >= cutoff)
    .reduce((sum, log) => sum + Number(log.qty || 0), 0);
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

function setupSelects() {
  $$("input[type='date']").forEach(input => { if (!input.value) input.value = todayISO(); });
  const machines = config().machines.map(machine => machine.name);
  const machineOptions = machines.map(machine => `<option>${machine}</option>`).join("");
  $("#nccForm select[name='machine']").innerHTML = machineOptions;
  $("#nccForm select[name='product']").innerHTML = allProducts().map(product => `<option>${product}</option>`).join("");
  $("#quickMachine").innerHTML = machineOptions;
  $("#stocktakeMachine").innerHTML = machineOptions;
  $("#historyMachine").innerHTML = `<option value="">Tất cả</option>${machineOptions}`;
  $("#historyDate").value = "";
  $("#quickMachine").addEventListener("change", renderQuickFill);
  $("#stocktakeMachine").addEventListener("change", renderStocktake);
  $("#cabinMachine")?.addEventListener("change", event => {
    activeCabinMachine = event.target.value;
    localStorage.setItem("fill_assistant_cabin_machine", activeCabinMachine);
    renderCabin();
  });
  $("#exportCabinCsvBtn")?.addEventListener("click", exportCabinCsv);
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

function setupForms() {
  setupSelects();
  const nccForm = $("#nccForm");
  nccForm.addEventListener("submit", event => { event.preventDefault(); saveNccFromForm(event.target); });
  nccForm.product.addEventListener("change", updateNccConversion);
  nccForm.qty.addEventListener("input", updateNccConversion);
  $("#stocktakeBox").addEventListener("click", event => {
    if (event.target.closest("#saveStocktakeBtn")) saveStocktakeBatch();
    if (event.target.closest("#resetStocktakeBtn")) renderStocktake();
  });
  ["historyDate", "historyMachine", "historyProduct"].forEach(id => {
    $("#" + id).addEventListener(id === "historyProduct" ? "input" : "change", renderHistory);
  });
  $("#resetBtn").addEventListener("click", async () => {
    if (!requirePermission("manage")) return;
    if (!confirm("Reset về dữ liệu gốc trên thiết bị và Supabase?")) return;
    if (!navigator.onLine) return showToast("Cần kết nối mạng để reset dữ liệu Supabase.");
    if (!await syncNow()) return showToast("Chưa tải được dữ liệu Supabase. Hãy thử lại.");
    state = authoritativeState(window.FILL_STATE || {});
    saveState();
    showToast("Đã tạo yêu cầu reset và chờ đồng bộ Supabase.");
  });
  $("#exportBtn").addEventListener("click", exportJSON);
  $("#importInput").addEventListener("change", importJSON);
  $("#copyOrderBtn").addEventListener("click", copyOrderSummary);
  updateNccConversion();
}

function setupQuickPads() {
  $$(".quickPad").forEach(pad => {
    pad.innerHTML = [1, 2, 3, 5].map(n => `<button type="button" class="quick-btn" data-val="${n}">+${n}</button>`).join("");
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

function updateQuickFillPending() {
  const pending = getQuickFillEntries();
  const total = pending.reduce((sum, item) => sum + item.qty, 0);
  const label = $("#quickFillPending");
  if (label) label.textContent = `${pending.length} slot · ${total} sản phẩm`;
}

function saveQuickFillBatch() {
  if (!requirePermission("fill")) return;
  const invalid = $$(".slot-card input", $("#quickFillBox")).filter(input => {
    const raw = input.value.trim();
    if (!raw || raw === "0") return false;
    const value = Number(raw);
    return !Number.isInteger(value) || value < 0;
  });
  if (invalid.length) return showToast("Số lượng Fill phải là số nguyên từ 0 trở lên.");
  const entries = getQuickFillEntries();
  if (!entries.length) return showToast("Chưa nhập số lượng fill.");
  const large = entries.filter(item => item.qty > 50);
  if (large.length && !confirm(`Có số lượng lớn ở ${large.length} slot. Lưu tất cả?`)) return;
  const date = $("#quickDate").value || todayISO();
  const recordedAt = new Date().toISOString();
  entries.forEach(item => state.fillLogs.push(touchRecord({
    id: makeId(), date, machine: item.machine, slot: item.slot, product: item.product, qty: item.qty,
    recorded_at: recordedAt
  })));
  entries.forEach(item => { $("input", item.card).value = ""; });
  saveState();
  showToast(`Đã lưu ${entries.length} slot fill.`);
}

function renderStocktake() {
  const machine = $("#stocktakeMachine").value;
  const cab = displayCabin();
  const items = Object.entries(cab).map(([key, qty]) => {
    const [m, product] = key.split("||");
    return { machine: m, product, qty };
  }).filter(item => item.machine === machine).sort((a, b) => a.product.localeCompare(b.product, "vi"));
  $("#stocktakeBox").innerHTML = items.length ? `
    <div class="stocktake-list">${items.map(item => `
      <label class="stocktake-row" data-product="${htmlEscape(item.product)}" data-current="${item.qty}">
        <span><b>${htmlEscape(item.product)}</b><small>Hiện tại: ${item.qty} sản phẩm</small></span>
        <input type="number" min="0" step="1" inputmode="numeric" value="${item.qty}" />
      </label>`).join("")}</div>
    <div class="stocktake-actions"><button id="resetStocktakeBtn" type="button" class="btn ghost">Nhập lại</button><button id="saveStocktakeBtn" type="button" class="btn primary">Lưu kiểm kê</button></div>
  ` : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function saveStocktakeBatch() {
  if (!requirePermission("stocktake")) return;
  const machine = $("#stocktakeMachine").value;
  const date = $("#stocktakeDate").value || todayISO();
  const batchId = makeId();
  const recordedAt = new Date().toISOString();
  const entries = $$(".stocktake-row", $("#stocktakeBox")).map(row => {
    const current = Number(row.dataset.current || 0);
    const raw = $("input", row).value.trim();
    const actual = Number(raw);
    return { product: row.dataset.product, current, actual, diff: actual - current };
  });
  if (entries.some(item => !Number.isInteger(item.actual) || item.actual < 0)) {
    return showToast("Tồn kiểm kê phải là số nguyên từ 0 trở lên.");
  }
  const changes = entries.filter(item => item.diff !== 0);
  if (!changes.length) return showToast("Không có chênh lệch để lưu.");
  changes.forEach(change => state.adjustLogs.push(touchRecord({
    id: makeId(), batch_id: batchId, date, machine, product: change.product,
    qty: change.diff, actual: change.actual, reason: "Kiểm kê cabin", recorded_at: recordedAt
  })));
  saveState();
  renderStocktake();
  showToast(`Đã lưu kiểm kê, ${changes.length} sản phẩm có chênh lệch.`);
}

function historySource() {
  return activeHistoryType === "fill" ? ["fillLogs", "Nhập Fill"]
    : activeHistoryType === "ncc" ? ["nccLogs", "Nhập hàng"]
    : ["adjustLogs", "Kiểm kê cabin"];
}

function historyDateTime(item) {
  if (!item.recorded_at) return item.date;
  const recorded = new Date(item.recorded_at);
  if (Number.isNaN(recorded.getTime())) return item.date;
  return `${item.date} · ${recorded.toLocaleTimeString("vi-VN", { hour12: false })}`;
}

function renderHistory() {
  const [key, label] = historySource();
  const fromDate = $("#historyDate")?.value || "";
  const machine = $("#historyMachine")?.value || "";
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  const rows = activeLogRows(key).filter(item => (!fromDate || item.date >= fromDate)
    && (!machine || item.machine === machine)
    && (!query || String(item.product).toLocaleLowerCase("vi").includes(query)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  $("#historyCount").textContent = `${rows.length} bản ghi`;
  $("#historyList").innerHTML = rows.map(item => {
    const amount = activeHistoryType === "ncc"
      ? `${nccBoxes(item)} thùng · ${item.qty} sản phẩm`
      : activeHistoryType === "adjust"
        ? `${item.qty > 0 ? "+" : ""}${item.qty} sản phẩm`
        : `${item.qty} sản phẩm`;
    const detail = activeHistoryType === "fill" ? `Slot ${item.slot} · ${item.product}`
      : activeHistoryType === "adjust" ? `${item.product} · ${item.reason || "Kiểm kê cabin"}` : item.product;
    const type = activeHistoryType === "ncc" ? "Ncc" : activeHistoryType === "adjust" ? "Adjust" : "Fill";
    const permission = activeHistoryType === "fill" ? "fill" : activeHistoryType === "ncc" ? "receive" : "stocktake";
    const actions = hasPermission(permission) ? `<div class="actions"><button class="mini" onclick="edit${type}('${item.id}')">Sửa</button><button class="mini danger" onclick="delete${type}('${item.id}')">Xóa</button></div>` : "";
    return `<div class="history-row"><div><b>${historyDateTime(item)} · ${item.machine}</b><span>${detail}</span></div><strong>${amount}</strong>${actions}</div>`;
  }).join("") || `<p class="muted">Chưa có lịch sử ${label}.</p>`;
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

function exportNccCsv() {
  const machines = selectedNccExportMachines();
  const rows = buildOrderRows().filter(row => machines.includes(row.machine));
  if (!machines.length) return showToast("Chưa chọn máy để xuất CSV.");
  if (!rows.length) return showToast("Các máy đã chọn chưa có sản phẩm cần nhập.");
  const grouped = groupOrdersByMachine(rows);
  const csvRows = [["Đơn nhập hàng - Quản Lý Nhập Hàng"], [`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`], [], ["Máy", "Sản phẩm", "Số thùng", "Quy đổi sản phẩm", "Tồn cabin"]];
  machines.forEach(machine => {
    (grouped[machine] || []).forEach(row => csvRows.push([machine, row.product, row.pack.packs, row.pack.qty, row.qty]));
    if ((grouped[machine] || []).length) csvRows.push([`Tổng ${machine}`, "", totalPacks(grouped[machine]), "", ""], []);
  });
  csvRows.push(["TỔNG TẤT CẢ", "", totalPacks(rows), "", ""]);
  const csv = "\ufeff" + csvRows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `don-nhap-hang-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  showToast(`Đã xuất CSV ${machines.length} máy.`);
}

function renderOrders() {
  const machine = activeDashboardMachine;
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const attention = dashboardAttentionRows(machine);
  const packsTotal = totalPacks(rows);
  const exportMachines = nccMachinesWithOrders();
  orderSummaryText = rows.length ? `${formatMachineOrder(machine, rows)}\n\nTỔNG: ${packsTotal} THÙNG` : "";
  $("#orderSummaryBox").innerHTML = rows.length ? `
    <div class="dashboard-order-head"><div><span>Đơn nhập hàng ${machine}</span><b>${packsTotal} thùng</b></div><small>${packsTotal} thùng cần đặt</small></div>
    <div class="dashboard-order-list">${rows.map(row => `<div class="dashboard-order-row"><span>${row.product}</span><b>${row.pack.packs} thùng</b><small>${row.pack.qty} sản phẩm</small></div>`).join("")}</div>
    <div class="excel-export-box"><div class="excel-export-head"><b>Xuất đơn nhập hàng</b><button type="button" id="selectAllNccMachines" class="mini">Chọn tất cả</button></div>
      <div id="nccExportMachines" class="machine-check-list">${exportMachines.map(name => `<label><input type="checkbox" value="${htmlEscape(name)}" ${name === machine ? "checked" : ""} /><span>${name}</span></label>`).join("")}</div>
      <button type="button" id="exportNccCsvBtn" class="btn primary">Xuất CSV mở bằng Excel</button></div>
  ` : `<div class="empty-state"><b>${machine || "Máy này"} đang ổn</b><span>Chưa có sản phẩm nào cần nhập hàng.</span></div>`;
  $("#orderBox").innerHTML = attention.length ? `<div class="attention-list">${attention.slice(0, 12).map(item => {
    const level = item.raw < 0 ? "red" : item.qty <= 2 ? "red" : item.qty <= 12 ? "yellow" : "blue";
    return `<div class="attention-row ${level}"><div><b>${item.product}</b><span>${item.raw < 0 ? `Lệch ${Math.abs(item.raw)}` : `Tồn ${item.qty}`} sản phẩm</span></div><strong>${item.order > 0 ? `${item.pack.packs} thùng` : "Kiểm tra"}</strong></div>`;
  }).join("")}</div>` : `<div class="empty-state"><b>Không có tồn thấp</b><span>Máy này chưa có mục nào cần chú ý.</span></div>`;
  $("#exportNccCsvBtn")?.addEventListener("click", exportNccCsv);
  $("#selectAllNccMachines")?.addEventListener("click", () => {
    const inputs = $$("#nccExportMachines input"); const check = inputs.some(input => !input.checked); inputs.forEach(input => { input.checked = check; });
  });
}

function copyOrderSummary() {
  if (!orderSummaryText) return showToast("Chưa có đơn nhập hàng để copy.");
  copyText(`Đơn nhập hàng ${activeDashboardMachine}:\n${orderSummaryText}`, `Đã copy đơn ${activeDashboardMachine}.`);
}

function syncTables() {
  return [
    { table: "fill_logs", key: "fillLogs", permission: "fill", publicFields: ["id", "date", "machine", "slot", "product", "qty", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "date", "machine", "slot", "product", "qty", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] },
    { table: "ncc_logs", key: "nccLogs", permission: "receive", publicFields: ["id", "date", "machine", "product", "qty", "boxes", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "date", "machine", "product", "qty", "boxes", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] },
    { table: "adjust_logs", key: "adjustLogs", permission: "stocktake", publicFields: ["id", "batch_id", "date", "machine", "product", "qty", "actual", "reason", "recorded_at", "updated_at", "deleted_at"], fields: ["id", "workspace_id", "created_by", "batch_id", "date", "machine", "product", "qty", "actual", "reason", "recorded_at", "created_at", "updated_at", "deleted_at", "device_id", "user_id"] }
  ];
}

function ensureSyncView() {
  $(".app-header p").textContent = "V4.1.0 - Ổn định dữ liệu và đồng bộ";
  const cfg = syncConfig();
  $("#syncConfigCard")?.classList.toggle("hidden", !(hasPermission("manage") && isSyncAdminMode()));
  if ($("#syncConfigForm")) { $("#syncConfigForm").url.value = cfg.url || ""; $("#syncConfigForm").key.value = cfg.key || ""; }
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

function renderAuthUI() {
  const signedIn = Boolean(syncUser);
  $("#authLoginForm")?.classList.toggle("hidden", signedIn);
  $("#authAccountPanel")?.classList.toggle("hidden", !signedIn);
  $("#authAccountInfo") && ($("#authAccountInfo").innerHTML = accountDetailsHtml());
  $("#accountOverview") && ($("#accountOverview").innerHTML = accountDetailsHtml());
  if ($("#accountBtn")) {
    $("#accountBtn").textContent = signedIn ? (syncUser.email?.split("@")[0] || "Tài khoản") : "Đăng nhập";
    $("#accountBtn").title = signedIn ? syncUser.email : "Đăng nhập";
  }
  applyPermissions();
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

async function syncNow() {
  if (syncBusy) return false;
  if (!navigator.onLine) {
    syncStatusText = "Chờ mạng";
    renderSyncStatus();
    return false;
  }
  let succeeded = false;
  syncBusy = true; syncStatusText = "Đang đồng bộ"; renderSyncStatus();
  try {
    await initSyncClient();
    if (!syncClient) throw new Error("Chưa cấu hình Supabase.");
    const publicOnly = !syncUser || !syncAccess;
    if (publicOnly) {
      for (const meta of syncTables()) replaceWithPublicRows(meta.key, await fetchAllSyncRows(meta, true));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      lastSyncAt = new Date().toISOString();
      localStorage.setItem("fill_assistant_last_sync_at", lastSyncAt);
      syncStatusText = syncUser ? "Chưa được cấp quyền" : "Chỉ xem";
      renderAll();
      succeeded = true;
      return succeeded;
    }
    for (const meta of syncTables()) {
      const pending = hasPermission(meta.permission)
        ? state[meta.key].filter(item => item._sync === "pending" || !item.updated_at)
        : [];
      if (pending.length) {
        await upsertPendingRows(meta, pending);
        pending.forEach(item => { item._sync = "synced"; });
      }
      mergeRemoteRows(meta.key, await fetchAllSyncRows(meta));
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSyncAt = new Date().toISOString();
    localStorage.setItem("fill_assistant_last_sync_at", lastSyncAt);
    syncStatusText = "Đã đồng bộ"; renderAll();
    succeeded = true;
  } catch (error) {
    syncStatusText = "Lỗi đồng bộ"; renderSyncStatus(); showToast(error.message || "Không đồng bộ được Supabase.");
  } finally { syncBusy = false; renderSyncStatus(); }
  return succeeded;
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

function renderAll() {
  cabinSnapshot = null;
  renderRoute(); renderSummary(); renderOrders(); renderSlow(); renderCabin(); renderHistory(); renderAudit(); renderSelectedCabin(); renderSyncStatus();
  if (!$("#quickfill").classList.contains("active") || !$("#quickFillBox .slot-card")) renderQuickFill();
  if (!$("#audit").classList.contains("active") || !$("#stocktakeBox .stocktake-row")) renderStocktake();
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

ensureSyncView();
setupTabs();
setupForms();
setupSyncForms();
setupQuickPads();
renderAll();
initSyncClient().then(() => queueAutoSync()).catch(() => renderSyncStatus());

/* V4.1.0 - Quản Lý Nhập Hàng */
var selectedMachineEditorId = null;
var machineSchemaAvailable = true;
var machineEditorDirty = false;

function normalizeState(value) {
  const normalized = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  ["fillLogs", "nccLogs", "adjustLogs", "machineConfigs", "machineSlots"].forEach(key => {
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

function machineProductLayout(machine, product) {
  const slots = config().slots.filter(slot => slot.machine === machine && slot.product === product);
  return {
    slotCount: slots.length,
    capacity: slots.reduce((sum, slot) => sum + Number(slot.max || 0), 0),
    slots: slots.map(slot => Number(slot.slot)).sort((a, b) => a - b)
  };
}

function expectedDemandBeforeNextVisit(machine, product) {
  return 0;
}

function suggestedOrderForLayout(stock, product, layout, projected) {
  const pack = productInfo(product).pack;
  if (isAquaProduct(product)) return suggestOrder(projected, product);
  if (layout.slotCount > 1 && layout.capacity > pack) {
    return projected <= layout.capacity - pack ? pack : 0;
  }
  return projected <= 12 ? pack : 0;
}

function buildOrderRows() {
  const rawCabin = currentCabin();
  const keys = new Set(Object.keys(rawCabin));
  config().slots.forEach(slot => keys.add(`${slot.machine}||${slot.product}`));
  const rows = [];
  keys.forEach(key => {
    const [machine, product] = key.split("||");
    const raw = Number(rawCabin[key] || 0);
    if (raw < 0) return;
    const qty = Math.max(0, raw);
    const layout = machineProductLayout(machine, product);
    const expectedDemand = expectedDemandBeforeNextVisit(machine, product);
    const projected = Math.max(0, qty - expectedDemand);
    const order = suggestedOrderForLayout(qty, product, layout, projected);
    if (order > 0) rows.push({
      machine, product, qty, raw, order, projected, expectedDemand,
      capacity: layout.capacity, slotCount: layout.slotCount, slots: layout.slots,
      pack: packText(order, product)
    });
  });
  return rows.sort((a, b) => a.machine.localeCompare(b.machine, "vi") || a.product.localeCompare(b.product, "vi"));
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
  const nccForm = $("#nccForm");
  nccForm?.addEventListener("submit", event => { event.preventDefault(); saveNccBatch(event.target); });
  $("#addNccRowBtn")?.addEventListener("click", () => addNccRow());
  $("#resetNccBatchBtn")?.addEventListener("click", resetNccBatch);
  $("#bulkNccRows")?.addEventListener("click", event => {
    const add = event.target.closest("[data-add-boxes]");
    if (add) {
      const input = $(".bulk-boxes", add.closest(".bulk-ncc-row"));
      input.value = Number(input.value || 0) + Number(add.dataset.addBoxes || 0);
      updateNccBatchPreview();
    }
    const remove = event.target.closest("[data-remove-ncc-row]");
    if (remove) {
      remove.closest(".bulk-ncc-row").remove();
      if (!$(".bulk-ncc-row", $("#bulkNccRows"))) addNccRow();
      updateNccBatchPreview();
    }
  });
  $("#bulkNccRows")?.addEventListener("input", updateNccBatchPreview);
  $("#bulkNccRows")?.addEventListener("change", updateNccBatchPreview);
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
    seedMachineConfig();
    saveState();
  });
  $("#exportBtn")?.addEventListener("click", exportJSON);
  $("#importInput")?.addEventListener("change", importJSON);
  $("#copyOrderBtn")?.addEventListener("click", copyOrderSummary);
  setupMachineManagerEvents();
  resetNccBatch();
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
    ["machineConfigs", "machineSlots"].forEach(key => state[key].forEach(item => {
      if (!item.workspace_id) item.workspace_id = syncAccess.workspace_id;
      if (item._sync === "seeded" || !item.updated_at) item._sync = "pending";
      changed = true;
    }));
  }
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pendingSyncCount() {
  return ["fillLogs", "nccLogs", "adjustLogs", "machineConfigs", "machineSlots"]
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
    { table: "machine_slots", key: "machineSlots", publicFields: "id,machine_id,slot_number,product,capacity,initial_machine,archived,created_at,updated_at,deleted_at", fields: ["id", "workspace_id", "machine_id", "slot_number", "product", "capacity", "initial_machine", "archived", "created_at", "updated_at", "deleted_at", "device_id"] }
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
    if (error?.code === "42P01" || error?.code === "PGRST205" || message.includes("machine_slots") || message.includes("machines")) {
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
}

function ensureSyncView() {
  if ($(".app-header p")) $(".app-header p").textContent = "V4.1.0 - Ổn định dữ liệu và đồng bộ";
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
      return `<div class="dashboard-order-row"><span>${htmlEscape(row.product)}<small class="order-context">${layout} · tồn ${row.projected}</small></span><b>${row.pack.packs} thùng</b><small>${row.pack.qty} sản phẩm</small></div>`;
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
  const csvRows = [["Đơn nhập hàng - Quản Lý Nhập Hàng"], [`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`], [], ["Máy", "Sản phẩm", "Số slot", "Sức chứa", "Tồn cabin", "Tồn dùng tính đơn", "Số thùng", "Quy đổi sản phẩm"]];
  machines.forEach(machine => {
    (grouped[machine] || []).forEach(row => csvRows.push([machine, row.product, row.slotCount, row.capacity, row.qty, row.projected, row.pack.packs, row.pack.qty]));
    if ((grouped[machine] || []).length) csvRows.push([`Tổng ${machine}`, "", "", "", "", "", totalPacks(grouped[machine]), ""], []);
  });
  csvRows.push(["TỔNG TẤT CẢ", "", "", "", "", "", totalPacks(rows), ""]);
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
  ["machineConfigs", "machineSlots"].forEach(key => {
    const source = incoming[key]?.length ? incoming[key] : state[key];
    result[key] = source.map(item => touchConfigRecord({ ...item }, Boolean(item.deleted_at)));
  });
  return result;
}

window.FILL_BASE_CONFIG ||= window.FILL_CONFIG;
seedMachineConfig();
refreshOperationalSelects();
resetNccBatch();
renderMachineManager();
renderAll();
