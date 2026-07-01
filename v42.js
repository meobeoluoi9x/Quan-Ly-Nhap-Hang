/* Quản Lý Nhập Hàng V4.2.2 */
const V42_FILL_DRAFT = "qlnh_fill_draft_v42";
const V42_NCC_DRAFT = "qlnh_ncc_draft_v42";
const V42_MANAGEMENT = "qlnh_management_v42";
let v42FillStep = 0;
let v42NccStep = 0;
let v42HistoryPage = 1;
const V42_HISTORY_PAGE_SIZE = 30;
let v42HistoryContext = "";

function readV42Draft(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}

function persistQuickDraft() {
  const cards = $$(".slot-card", $("#quickFillBox"));
  if (!cards.length) return;
  const values = {};
  cards.forEach(card => { values[card.dataset.slot] = $("input", card)?.value || ""; });
  localStorage.setItem(V42_FILL_DRAFT, JSON.stringify({
    machine: cards[0].dataset.machine,
    date: $("#quickDate")?.value || todayISO(),
    values,
    step: v42FillStep
  }));
}

function setQuickStep(index, focus = false) {
  const cards = $$(".slot-card", $("#quickFillBox"));
  if (!cards.length) return;
  v42FillStep = Math.max(0, Math.min(index, cards.length - 1));
  cards.forEach((card, i) => card.classList.toggle("mobile-active", i === v42FillStep));
  if ($("#quickStepLabel")) $("#quickStepLabel").textContent = `${v42FillStep + 1}/${cards.length}`;
  if ($("#quickPrevBtn")) $("#quickPrevBtn").disabled = v42FillStep === 0;
  if ($("#quickNextBtn")) $("#quickNextBtn").textContent = v42FillStep === cards.length - 1 ? "Xong" : "Tiếp";
  if (focus) $("input", cards[v42FillStep])?.focus();
  persistQuickDraft();
}

function renderQuickFill() {
  persistQuickDraft();
  const machine = $("#quickMachine")?.value;
  const box = $("#quickFillBox");
  if (!box) return;
  const slots = config().slots.filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
  if (!slots.length) {
    box.innerHTML = `<p class="muted">Máy này chưa có slot.</p>`;
    return;
  }
  const draft = readV42Draft(V42_FILL_DRAFT);
  const values = draft?.machine === machine ? draft.values || {} : {};
  if (draft?.machine === machine && draft.date) $("#quickDate").value = draft.date;
  v42FillStep = draft?.machine === machine ? Number(draft.step || 0) : 0;
  box.innerHTML = `
    <div class="quick-fill-list">${slots.map((slot, index) => `
      <div class="slot-card" data-machine="${htmlEscape(slot.machine)}" data-slot="${Number(slot.slot)}" data-product="${htmlEscape(slot.product)}">
        <div class="quick-slot-info"><b>Slot ${slot.slot}</b><span>${htmlEscape(slot.product)}${slot.max ? ` · Max ${Number(slot.max)}` : ""}</span></div>
        <div class="slot-controls compact embedded">
          <input class="quick-fill-qty" type="number" min="0" step="1" inputmode="numeric" placeholder="Số lượng" value="${htmlEscape(values[slot.slot] || "")}" data-step="${index}" />
          <button type="button" class="clear-slot" data-clear tabindex="-1" aria-label="Xóa số lượng">×</button>
        </div>
      </div>`).join("")}</div>
    <div class="mobile-step-nav"><button type="button" id="quickPrevBtn" class="btn ghost">Trước</button><b id="quickStepLabel"></b><button type="button" id="quickNextBtn" class="btn primary">Tiếp</button></div>
    <div class="quick-fill-footer"><div><b id="quickFillPending">0 slot</b><span>chờ lưu</span></div><div class="quick-fill-footer-actions"><button type="button" id="clearQuickFillBtn" class="btn ghost">Xóa hết</button><button type="button" id="saveQuickFillBtn" class="btn primary">Lưu Fill Sản phẩm</button></div></div>`;

  box.oninput = event => {
    if (event.target.matches(".quick-fill-qty")) { updateQuickFillPending(); persistQuickDraft(); }
  };
  box.onkeydown = event => {
    if (!event.target.matches(".quick-fill-qty") || event.key !== "Tab") return;
    event.preventDefault();
    const inputs = $$(".quick-fill-qty", box);
    const index = inputs.indexOf(event.target);
    const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
    if (next) next.focus();
    else (event.shiftKey ? $("#quickMachine") : $("#saveQuickFillBtn"))?.focus();
  };
  box.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;
    const card = button.closest(".slot-card");
    if (card && button.hasAttribute("data-clear")) {
      $("input", card).value = "";
      updateQuickFillPending(); persistQuickDraft();
    } else if (button.id === "quickPrevBtn") setQuickStep(v42FillStep - 1, true);
    else if (button.id === "quickNextBtn") {
      const count = $$(".slot-card", box).length;
      if (v42FillStep < count - 1) setQuickStep(v42FillStep + 1, true);
      else $("#saveQuickFillBtn")?.focus();
    } else if (button.id === "clearQuickFillBtn") {
      $$(".quick-fill-qty", box).forEach(input => { input.value = ""; });
      updateQuickFillPending(); persistQuickDraft();
    } else if (button.id === "saveQuickFillBtn") saveQuickFillBatch();
  };
  setQuickStep(v42FillStep);
  updateQuickFillPending();
}

function saveQuickFillBatch() {
  if (!requirePermission("fill")) return;
  const inputs = $$(".quick-fill-qty", $("#quickFillBox"));
  if (inputs.some(input => input.value.trim() && (!Number.isInteger(Number(input.value)) || Number(input.value) < 0))) {
    return showToast("Số lượng phải là số nguyên từ 0 trở lên.");
  }
  const entries = getQuickFillEntries();
  if (!entries.length) return showToast("Chưa nhập số lượng Fill Sản phẩm.");
  if (entries.some(item => item.qty > 50) && !confirm("Có slot trên 50 sản phẩm. Vẫn lưu?")) return;
  const date = $("#quickDate").value || todayISO();
  const recordedAt = new Date().toISOString();
  entries.forEach(item => state.fillLogs.push(touchRecord({
    id: makeId(), date, machine: item.machine, slot: item.slot,
    product: item.product, qty: item.qty, recorded_at: recordedAt
  })));
  localStorage.removeItem(V42_FILL_DRAFT);
  saveState();
  renderQuickFill();
  showToast(`Đã lưu ${entries.length} slot Fill Sản phẩm.`);
}

function addNccRow(values = {}) {
  const box = $("#bulkNccRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "bulk-ncc-row";
  row.innerHTML = `
    <select class="bulk-machine" aria-label="Máy">${machineOptionsHtml(values.machine)}</select>
    <select class="bulk-product" aria-label="Sản phẩm">${allProducts().map(product => `<option ${product === values.product ? "selected" : ""}>${htmlEscape(product)}</option>`).join("")}</select>
    <div class="bulk-box-control"><input class="bulk-boxes" type="number" min="0" step="1" inputmode="numeric" placeholder="Thùng" value="${values.boxes || ""}" /><small class="bulk-conversion"></small></div>
    <button type="button" class="remove-row-btn" data-remove-ncc-row tabindex="-1" aria-label="Xóa dòng">×</button>`;
  box.appendChild(row);
  updateNccBatchPreview();
  setNccStep($$(".bulk-ncc-row", box).length - 1);
}

function updateNccBatchPreview() {
  const rows = mergedNccBatchRows();
  const boxes = rows.reduce((sum, item) => sum + item.boxes, 0);
  const products = rows.reduce((sum, item) => sum + item.boxes * productInfo(item.product).pack, 0);
  $$(".bulk-ncc-row", $("#bulkNccRows")).forEach(row => {
    const qty = Number($(".bulk-boxes", row).value || 0);
    const product = $(".bulk-product", row).value;
    if ($(".bulk-conversion", row)) $(".bulk-conversion", row).textContent = `${qty * productInfo(product).pack} sản phẩm`;
  });
  if ($("#nccBatchPreview")) $("#nccBatchPreview").innerHTML = `
    <div><span>Dòng sau gộp</span><b>${rows.length}</b></div>
    <div><span>Tổng thùng</span><b>${boxes}</b></div>
    <div><span>Quy đổi</span><b>${products} sản phẩm</b></div>`;
}

function nccDraftRows() {
  return $$(".bulk-ncc-row", $("#bulkNccRows")).map(row => ({
    machine: $(".bulk-machine", row).value,
    product: $(".bulk-product", row).value,
    boxes: $(".bulk-boxes", row).value
  }));
}

function persistNccDraft() {
  const form = $("#nccForm");
  if (form) localStorage.setItem(V42_NCC_DRAFT, JSON.stringify({ date: form.date.value, rows: nccDraftRows(), step: v42NccStep }));
}

function ensureNccStepNav() {
  if ($("#nccStepNav")) return;
  const nav = document.createElement("div");
  nav.id = "nccStepNav";
  nav.className = "mobile-step-nav";
  nav.innerHTML = `<button type="button" id="nccPrevBtn" class="btn ghost">Trước</button><b id="nccStepLabel"></b><button type="button" id="nccNextBtn" class="btn primary">Tiếp</button>`;
  $("#bulkNccRows")?.after(nav);
}

function setNccStep(index, focus = false) {
  const rows = $$(".bulk-ncc-row", $("#bulkNccRows"));
  if (!rows.length) return;
  v42NccStep = Math.max(0, Math.min(index, rows.length - 1));
  rows.forEach((row, i) => row.classList.toggle("mobile-active", i === v42NccStep));
  if ($("#nccStepLabel")) $("#nccStepLabel").textContent = `${v42NccStep + 1}/${rows.length}`;
  if ($("#nccPrevBtn")) $("#nccPrevBtn").disabled = v42NccStep === 0;
  if ($("#nccNextBtn")) $("#nccNextBtn").textContent = v42NccStep === rows.length - 1 ? "Xong" : "Tiếp";
  if (focus) $(".bulk-boxes", rows[v42NccStep])?.focus();
  persistNccDraft();
}

function resetNccBatch(clearDraft = false) {
  const form = $("#nccForm");
  const box = $("#bulkNccRows");
  if (!form || !box) return;
  if (clearDraft) localStorage.removeItem(V42_NCC_DRAFT);
  const draft = clearDraft ? null : readV42Draft(V42_NCC_DRAFT);
  form.date.value = draft?.date || todayISO();
  box.innerHTML = "";
  (draft?.rows?.length ? draft.rows : [{}]).forEach(addNccRow);
  ensureNccStepNav();
  v42NccStep = Number(draft?.step || 0);
  setNccStep(v42NccStep);
  updateNccBatchPreview();
}

function saveNccBatch(form) {
  if (!requirePermission("receive")) return;
  const rows = nccDraftRows().map(item => ({ ...item, boxes: Number(item.boxes || 0) })).filter(item => item.boxes > 0);
  if (!rows.length) return showToast("Chưa nhập số thùng NCC.");
  if (rows.some(item => !Number.isInteger(item.boxes))) return showToast("Số thùng phải là số nguyên.");
  const batchId = makeId();
  const recordedAt = new Date().toISOString();
  const date = form.date.value || todayISO();
  rows.forEach(item => state.nccLogs.push(touchRecord({
    id: makeId(), batch_id: batchId, date, machine: item.machine, product: item.product,
    boxes: item.boxes, qty: item.boxes * productInfo(item.product).pack, recorded_at: recordedAt
  })));
  localStorage.removeItem(V42_NCC_DRAFT);
  saveState();
  resetNccBatch(true);
  showToast(`Đã lưu ${rows.length} dòng Nhập Hàng NCC.`);
}

function stocktakeItems(machine) {
  const cabin = displayCabin();
  const products = new Set(config().slots.filter(slot => slot.machine === machine).map(slot => slot.product));
  Object.keys(cabin).forEach(key => {
    const [rowMachine, product] = key.split("||");
    if (rowMachine === machine) products.add(product);
  });
  return [...products].map(product => ({ product, qty: Number(cabin[`${machine}||${product}`] || 0) }))
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));
}

function renderStocktake() {
  const box = $("#stocktakeBox");
  const machine = $("#stocktakeMachine")?.value;
  if (!box) return;
  const items = stocktakeItems(machine);
  box.innerHTML = items.length ? `
    <div class="stocktake-list">${items.map(item => `
      <label class="stocktake-row" data-product="${htmlEscape(item.product)}" data-current="${item.qty}">
        <span><b>${htmlEscape(item.product)}</b><small>Tồn hệ thống: ${item.qty} sản phẩm</small></span>
        <input type="number" min="0" step="1" inputmode="numeric" placeholder="Giữ ${item.qty}" />
      </label>`).join("")}</div>
    <div id="stocktakePreview" class="stocktake-preview">Ô để trống sẽ giữ nguyên tồn hiện tại.</div>
    <div class="stocktake-actions"><button id="resetStocktakeBtn" type="button" class="btn ghost">Nhập lại</button><button id="saveStocktakeBtn" type="button" class="btn primary">Lưu kiểm kê</button></div>`
    : `<p class="muted">Máy này chưa có sản phẩm trong layout.</p>`;
}

function updateStocktakePreview() {
  const preview = $("#stocktakePreview");
  if (!preview) return;
  const changes = $$(".stocktake-row", $("#stocktakeBox")).map(row => {
    const raw = $("input", row).value.trim();
    if (raw === "") return null;
    const oldQty = Number(row.dataset.current);
    const actual = Number(raw);
    return { product: row.dataset.product, oldQty, actual, diff: actual - oldQty };
  }).filter(Boolean);
  preview.innerHTML = changes.length ? changes.map(item => `
    <span><b>${htmlEscape(item.product)}</b> ${item.oldQty} → ${item.actual} <strong class="${item.diff < 0 ? "negative" : "positive"}">${item.diff > 0 ? "+" : ""}${item.diff}</strong></span>`).join("")
    : `Ô để trống sẽ giữ nguyên tồn hiện tại.`;
}

function saveStocktakeBatch() {
  if (!requirePermission("stocktake")) return;
  const rows = $$(".stocktake-row", $("#stocktakeBox")).map(row => {
    const raw = $("input", row).value.trim();
    const oldQty = Number(row.dataset.current);
    const actual = raw === "" ? null : Number(raw);
    return { product: row.dataset.product, oldQty, actual, diff: actual === null ? 0 : actual - oldQty };
  }).filter(item => item.actual !== null);
  if (!rows.length) return showToast("Chưa nhập tồn thực tế nào.");
  if (rows.some(item => !Number.isInteger(item.actual) || item.actual < 0)) return showToast("Tồn thực tế phải là số nguyên từ 0 trở lên.");
  const changes = rows.filter(item => item.diff !== 0);
  if (!changes.length) return showToast("Không có chênh lệch để lưu.");
  if (changes.some(item => Math.abs(item.diff) > 24) && !confirm("Có chênh lệch lớn hơn 24 sản phẩm. Vẫn lưu?")) return;
  const batchId = makeId();
  const date = $("#stocktakeDate").value || todayISO();
  const machine = $("#stocktakeMachine").value;
  const recordedAt = new Date().toISOString();
  changes.forEach(item => state.adjustLogs.push(touchRecord({
    id: makeId(), batch_id: batchId, date, machine, product: item.product,
    qty: item.diff, actual: item.actual, reason: "Kiểm kê cabin", recorded_at: recordedAt
  })));
  saveState();
  renderStocktake();
  showToast(`Đã cập nhật tồn thực tế của ${changes.length} sản phẩm.`);
}

function transferProducts(machine) {
  const products = new Set(config().slots.filter(slot => slot.machine === machine).map(slot => slot.product));
  Object.keys(currentCabin()).forEach(key => {
    const [rowMachine, product] = key.split("||");
    if (rowMachine === machine) products.add(product);
  });
  return [...products].sort((a, b) => a.localeCompare(b, "vi"));
}

function addTransferRow(values = {}) {
  const row = document.createElement("div");
  row.className = "transfer-row";
  row.innerHTML = `
    <select class="transfer-product" aria-label="Sản phẩm">${transferProducts($("#transferFromMachine")?.value).map(product => `<option ${product === values.product ? "selected" : ""}>${htmlEscape(product)}</option>`).join("")}</select>
    <input class="transfer-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="Số lượng" value="${values.qty || ""}" />
    <button type="button" class="remove-row-btn" data-remove-transfer-row aria-label="Xóa dòng">×</button>`;
  $("#transferRows")?.appendChild(row);
  updateTransferPreview();
}

function populateTransferMachines() {
  const names = config().machines.map(machine => machine.name);
  const from = $("#transferFromMachine");
  const to = $("#transferToMachine");
  if (!from || !to) return;
  const oldFrom = from.value;
  const oldTo = to.value;
  const options = names.map(name => `<option>${htmlEscape(name)}</option>`).join("");
  from.innerHTML = options;
  to.innerHTML = options;
  from.value = names.includes(oldFrom) ? oldFrom : names[0] || "";
  to.value = names.includes(oldTo) && oldTo !== from.value ? oldTo : names.find(name => name !== from.value) || from.value;
}

function resetTransfer() {
  populateTransferMachines();
  $("#transferDate").value ||= todayISO();
  $("#transferNote").value = "";
  $("#transferRows").innerHTML = "";
  addTransferRow();
}

function refreshTransferProducts() {
  const values = $$(".transfer-row", $("#transferRows")).map(row => ({
    product: $(".transfer-product", row).value,
    qty: $(".transfer-qty", row).value
  }));
  $("#transferRows").innerHTML = "";
  (values.length ? values : [{}]).forEach(addTransferRow);
}

function transferEntries() {
  const merged = new Map();
  $$(".transfer-row", $("#transferRows")).forEach(row => {
    const product = $(".transfer-product", row).value;
    const qty = Number($(".transfer-qty", row).value || 0);
    if (product && qty > 0) merged.set(product, (merged.get(product) || 0) + qty);
  });
  return [...merged].map(([product, qty]) => ({ product, qty }));
}

function updateTransferPreview() {
  const preview = $("#transferPreview");
  if (!preview) return;
  const from = $("#transferFromMachine")?.value;
  const rows = transferEntries();
  preview.innerHTML = rows.length ? rows.map(item => {
    const stock = Math.max(0, Number(currentCabin()[`${from}||${item.product}`] || 0));
    return `<span><b>${htmlEscape(item.product)}</b>: chuyển ${item.qty}, máy nguồn còn ${stock - item.qty}</span>`;
  }).join("") : `Thêm sản phẩm và số lượng cần chuyển.`;
}

function saveTransfer() {
  if (!requirePermission("stocktake")) return;
  const from = $("#transferFromMachine").value;
  const to = $("#transferToMachine").value;
  const rows = transferEntries();
  if (!from || !to || from === to) return showToast("Máy nguồn và máy nhận phải khác nhau.");
  if (!rows.length || rows.some(item => !Number.isInteger(item.qty))) return showToast("Số lượng chuyển chưa hợp lệ.");
  const unavailable = rows.find(item => item.qty > Math.max(0, Number(currentCabin()[`${from}||${item.product}`] || 0)));
  if (unavailable) return showToast(`${unavailable.product} không đủ tồn ở máy nguồn.`);
  const warnings = rows.filter(item => {
    const layout = machineProductLayout(to, item.product);
    const destination = Math.max(0, Number(currentCabin()[`${to}||${item.product}`] || 0));
    return !layout.slotCount || (layout.capacity > 0 && destination + item.qty > layout.capacity);
  });
  if (warnings.length && !confirm(`${warnings.length} sản phẩm chưa có slot hoặc vượt sức chứa máy nhận. Vẫn chuyển?`)) return;
  const batchId = makeId();
  const date = $("#transferDate").value || todayISO();
  const recordedAt = new Date().toISOString();
  const note = $("#transferNote").value.trim();
  const reason = `Chuyển tồn: ${from} → ${to}${note ? ` · ${note}` : ""}`;
  rows.forEach(item => {
    state.adjustLogs.push(touchRecord({ id: makeId(), batch_id: batchId, date, machine: from, product: item.product, qty: -item.qty, reason, recorded_at: recordedAt }));
    state.adjustLogs.push(touchRecord({ id: makeId(), batch_id: batchId, date, machine: to, product: item.product, qty: item.qty, reason, recorded_at: recordedAt }));
  });
  saveState();
  resetTransfer();
  showToast(`Đã chuyển ${rows.length} sản phẩm từ ${from} sang ${to}.`);
}

function isTransferRecord(item) {
  return String(item.reason || "").startsWith("Chuyển tồn:");
}

function historyRowsV42() {
  const key = activeHistoryType === "fill" ? "fillLogs" : activeHistoryType === "ncc" ? "nccLogs" : "adjustLogs";
  const from = $("#historyDate")?.value || "";
  const to = $("#historyToDate")?.value || "";
  const machine = $("#historyMachine")?.value || "";
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  let rows = activeLogRows(key)
    .filter(item => activeHistoryType === "transfer" ? isTransferRecord(item) : activeHistoryType === "adjust" ? !isTransferRecord(item) : true)
    .filter(item => (!from || item.date >= from) && (!to || item.date <= to)
      && (!query || String(item.product).toLocaleLowerCase("vi").includes(query)))
  if (machine && activeHistoryType === "transfer") {
    const batches = new Set(rows.filter(item => canonicalMachineName(item.machine) === machine).map(item => item.batch_id || item.id));
    rows = rows.filter(item => batches.has(item.batch_id || item.id));
  } else if (machine) {
    rows = rows.filter(item => canonicalMachineName(item.machine) === machine);
  }
  return rows.sort((a, b) => String(b.recorded_at || b.date).localeCompare(String(a.recorded_at || a.date)));
}

function transferHistoryBatches() {
  const groups = new Map();
  historyRowsV42().forEach(item => {
    const key = item.batch_id || item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups].map(([id, items]) => ({ id, items, sample: items[0] }));
}

function refreshHistoryLimitContext() {
  const context = [
    activeHistoryType,
    $("#historyDate")?.value || "",
    $("#historyToDate")?.value || "",
    $("#historyMachine")?.value || "",
    $("#historyProduct")?.value || ""
  ].join("|");
  if (context !== v42HistoryContext) {
    v42HistoryContext = context;
    v42HistoryPage = 1;
  }
}

function historyPaginationHtml(total) {
  const pages = Math.max(1, Math.ceil(total / V42_HISTORY_PAGE_SIZE));
  v42HistoryPage = Math.min(v42HistoryPage, pages);
  if (pages <= 1) return "";
  return `<nav class="history-pagination" aria-label="Phân trang lịch sử">
    <button type="button" class="btn ghost" data-history-page="prev" ${v42HistoryPage === 1 ? "disabled" : ""}>Trang trước</button>
    <b>Trang ${v42HistoryPage}/${pages}</b>
    <button type="button" class="btn ghost" data-history-page="next" ${v42HistoryPage === pages ? "disabled" : ""}>Trang sau</button>
  </nav>`;
}

function renderHistoryV4Runtime() {
  const list = $("#historyList");
  if (!list) return;
  refreshHistoryLimitContext();
  if (activeHistoryType === "transfer") {
    const batches = transferHistoryBatches();
    v42HistoryPage = Math.min(v42HistoryPage, Math.max(1, Math.ceil(batches.length / V42_HISTORY_PAGE_SIZE)));
    const start = (v42HistoryPage - 1) * V42_HISTORY_PAGE_SIZE;
    const visibleBatches = batches.slice(start, start + V42_HISTORY_PAGE_SIZE);
    $("#historyCount").textContent = `${batches.length} phiếu chuyển`;
    list.innerHTML = visibleBatches.map(batch => {
      const outgoing = batch.items.filter(item => Number(item.qty) < 0);
      const incoming = batch.items.filter(item => Number(item.qty) > 0);
      const from = outgoing[0]?.machine || "?";
      const to = incoming[0]?.machine || "?";
      const products = outgoing.map(item => `${htmlEscape(item.product)}: ${Math.abs(Number(item.qty))}`).join(" · ");
      const actions = hasPermission("stocktake") ? `<div class="actions"><button class="mini danger" onclick="deleteTransferBatch('${batch.id}')">Xóa phiếu</button></div>` : "";
      return `<div class="history-row"><div><b>${historyDateTime(batch.sample)} · ${htmlEscape(from)} → ${htmlEscape(to)}</b><span>${products}</span></div><strong>${outgoing.reduce((sum, item) => sum + Math.abs(Number(item.qty)), 0)} sản phẩm</strong>${actions}</div>`;
    }).join("") + historyPaginationHtml(batches.length) || `<p class="muted">Chưa có lịch sử chuyển tồn.</p>`;
    return;
  }
  const rows = historyRowsV42();
  v42HistoryPage = Math.min(v42HistoryPage, Math.max(1, Math.ceil(rows.length / V42_HISTORY_PAGE_SIZE)));
  const start = (v42HistoryPage - 1) * V42_HISTORY_PAGE_SIZE;
  const visibleRows = rows.slice(start, start + V42_HISTORY_PAGE_SIZE);
  $("#historyCount").textContent = `${rows.length} bản ghi`;
  const groups = new Map();
  visibleRows.forEach(item => {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  });
  list.innerHTML = [...groups].map(([date, dayRows]) => `<section class="history-day-group"><h3 class="history-day-title">${historyDayLabel(date)} <span>${date}</span></h3>${dayRows.map(item => {
    const permission = activeHistoryType === "fill" ? "fill" : activeHistoryType === "ncc" ? "receive" : "stocktake";
    const type = activeHistoryType === "fill" ? "Fill" : activeHistoryType === "ncc" ? "Ncc" : "Adjust";
    const amount = activeHistoryType === "ncc" ? `${nccBoxes(item)} thùng · ${item.qty} sản phẩm`
      : activeHistoryType === "adjust" ? `${Number(item.actual) - Number(item.qty)} → ${item.actual} (${item.qty > 0 ? "+" : ""}${item.qty})`
      : `${item.qty} sản phẩm`;
    const detail = activeHistoryType === "fill" ? `Slot ${item.slot} · ${htmlEscape(item.product)}` : htmlEscape(item.product);
    const actions = hasPermission(permission) ? `<div class="actions">${activeHistoryType === "adjust" ? "" : `<button class="mini" onclick="edit${type}('${item.id}')">Sửa</button>`}<button class="mini danger" onclick="delete${type}('${item.id}')">Xóa</button></div>` : "";
    return `<div class="history-row"><div><b>${historyDateTime(item)} · ${htmlEscape(item.machine)}</b><span>${detail}</span></div><strong>${amount}</strong>${actions}</div>`;
  }).join("")}</section>`).join("") + historyPaginationHtml(rows.length) || `<p class="muted">Chưa có lịch sử phù hợp.</p>`;
}

function deleteTransferBatch(batchId) {
  if (!requirePermission("stocktake") || !confirm("Xóa phiếu và hoàn lại tồn hai máy?")) return;
  const rows = state.adjustLogs.filter(item => item.batch_id === batchId && isTransferRecord(item) && !item.deleted_at);
  if (!rows.length) return;
  rows.forEach(item => touchRecord(item, true));
  saveState();
  showToast("Đã xóa phiếu chuyển và hoàn lại tồn.");
}

function exportHistoryCsv() {
  if (!syncUser) return showToast("Cần đăng nhập để xuất CSV.");
  if (activeHistoryType === "transfer") {
    const rows = [["Ngày giờ", "Máy nguồn", "Máy nhận", "Sản phẩm", "Số lượng"]];
    transferHistoryBatches().forEach(batch => {
      const outgoing = batch.items.filter(item => Number(item.qty) < 0);
      const incoming = batch.items.filter(item => Number(item.qty) > 0);
      outgoing.forEach(item => rows.push([
        historyDateTime(batch.sample), item.machine,
        incoming.find(row => row.product === item.product)?.machine || "",
        item.product, Math.abs(Number(item.qty))
      ]));
    });
    downloadCsvFile(rows, `lich-su-chuyen-ton-${todayISO()}.csv`);
    return;
  }
  const rows = historyRowsV42();
  const header = activeHistoryType === "fill" ? ["Ngày giờ", "Máy", "Slot", "Sản phẩm", "Số lượng"]
    : activeHistoryType === "ncc" ? ["Ngày giờ", "Máy", "Sản phẩm", "Thùng", "Quy đổi sản phẩm"]
    : ["Ngày giờ", "Máy", "Sản phẩm", "Tồn cũ", "Tồn thực tế", "Chênh lệch"];
  const body = rows.map(item => activeHistoryType === "fill" ? [historyDateTime(item), item.machine, item.slot, item.product, item.qty]
    : activeHistoryType === "ncc" ? [historyDateTime(item), item.machine, item.product, nccBoxes(item), item.qty]
    : [historyDateTime(item), item.machine, item.product, Number(item.actual) - Number(item.qty), item.actual, item.qty]);
  downloadCsvFile([header, ...body], `lich-su-${activeHistoryType}-${todayISO()}.csv`);
}

function activateCabinSubview(name) {
  if (name === "transfer" && !hasPermission("stocktake")) return;
  $$("[data-cabin-view]").forEach(button => button.classList.toggle("active", button.dataset.cabinView === name));
  $$("[data-cabin-panel]").forEach(panel => {
    const active = panel.dataset.cabinPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  if (name === "transfer") resetTransfer();
}

function applyManagementView() {
  const select = $("#managementSelect");
  if (!select) return;
  const canManage = hasPermission("manage");
  const layoutOption = select.querySelector('option[value="layout"]');
  if (layoutOption) layoutOption.disabled = !canManage;
  let value = select.value || localStorage.getItem(V42_MANAGEMENT) || "account";
  if (value === "layout" && !canManage) value = "account";
  select.value = value;
  localStorage.setItem(V42_MANAGEMENT, value);
  $$(".management-panel").forEach(panel => {
    const adminPanel = panel.id === "memberAdminCard" || panel.id === "machineAdminCard";
    panel.classList.toggle("management-hidden", panel.dataset.managementPanel !== value || (adminPanel && !canManage));
  });
}

function activateView(name) {
  const operationViews = ["quickfill", "ncc", "cabin"];
  if (name === "operations") {
    const saved = localStorage.getItem("qlnh_operation_view_v42") || "quickfill";
    name = saved === "quickfill" && hasPermission("fill") ? saved
      : saved === "ncc" && hasPermission("receive") ? saved
      : "cabin";
  }
  const requestedTab = $(`.tab[data-view="${name}"]`) || $(`[data-operation-view="${name}"]`);
  if (requestedTab?.dataset.authRequired && !(syncUser || syncAccess)) {
    openAuthModal();
    return;
  }
  if (requestedTab?.dataset.permission && !requirePermission(requestedTab.dataset.permission)) return;
  $$(".tab").forEach(tab => {
    const active = operationViews.includes(name) ? tab.classList.contains("operation-menu-tab") : tab.dataset.view === name;
    tab.classList.toggle("active", active);
  });
  $$(".view").forEach(view => view.classList.toggle("active", view.id === name));
  $$(".operation-tab").forEach(tab => {
    const active = tab.dataset.operationView === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (operationViews.includes(name)) localStorage.setItem("qlnh_operation_view_v42", name);
  if (name === "audit") renderStocktake();
  if (name === "cabin") renderCabin();
  if (name === "history") renderHistory();
  if (name === "system" && hasPermission("manage")) renderMembers();
  closeDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addLayoutEditorRow(values = {}) {
  const box = $("#layoutEditorRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "layout-editor-row";
  row.dataset.id = values.id || "";
  row.innerHTML = `
    <input class="layout-slot" type="number" min="1" step="1" value="${Number(values.slot_number || values.slot || 1)}" aria-label="Số slot" />
    <div class="layout-product-combo"><input class="layout-product" type="text" value="${htmlEscape(values.product || "")}" placeholder="Chọn hoặc gõ sản phẩm" autocomplete="off" aria-label="Sản phẩm" /><button type="button" class="product-list-btn" data-product-menu aria-label="Mở danh sách">⌄</button><div class="product-picker-menu" hidden></div></div>
    <input class="layout-capacity" type="number" min="1" step="1" value="${Number(values.capacity || values.max || 24)}" aria-label="Sức chứa" />
    <button type="button" class="remove-row-btn" data-remove-layout-row aria-label="Xóa slot">×</button>`;
  box.appendChild(row);
  updateMachineSlotCount();
}

function showProductMenu(combo) {
  const input = $(".layout-product", combo);
  const menu = $(".product-picker-menu", combo);
  const query = input.value.trim().toLocaleLowerCase("vi");
  const products = allProducts().filter(product => !query || product.toLocaleLowerCase("vi").includes(query)).slice(0, 30);
  menu.innerHTML = products.map(product => `<button type="button" data-product-choice="${htmlEscape(product)}">${htmlEscape(product)}</button>`).join("")
    || `<span>Nhấn Enter để dùng tên mới</span>`;
  menu.hidden = false;
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
  if ($("#quickfill")?.classList.contains("active") && !hasPermission("fill")) activateView("cabin");
  if ($("#ncc")?.classList.contains("active") && !hasPermission("receive")) activateView("cabin");
  applyManagementView();
}

function renderAll() {
  cabinSnapshot = null;
  renderRoute(); renderSummary(); renderOrders(); renderSlow(); renderCabin(); renderHistory(); renderAudit(); renderSelectedCabin(); renderSyncStatus();
  if (!$("#quickfill").classList.contains("active") || !$("#quickFillBox .slot-card")) renderQuickFill();
  if (!$("#audit").classList.contains("active") || !$("#stocktakeBox .stocktake-row")) renderStocktake();
  updateTransferPreview();
  applyManagementView();
}

function setupV42() {
  if ($(".app-header p")) $(".app-header p").textContent = "V4.2.2 - Lịch sử phân trang";
  $("#quickDate")?.addEventListener("change", persistQuickDraft);
  $$(".operation-tab").forEach(button => button.addEventListener("click", () => activateView(button.dataset.operationView)));

  $("#bulkNccRows")?.addEventListener("input", persistNccDraft);
  $("#bulkNccRows")?.addEventListener("change", persistNccDraft);
  $("#bulkNccRows")?.addEventListener("keydown", event => {
    if (!event.target.matches(".bulk-boxes") || event.key !== "Tab") return;
    event.preventDefault();
    const inputs = $$(".bulk-boxes", $("#bulkNccRows"));
    const index = inputs.indexOf(event.target);
    const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
    if (next) next.focus();
    else (event.shiftKey ? $("#addNccRowBtn") : $("#saveNccBatchBtn"))?.focus();
  });
  $("#resetNccBatchBtn")?.addEventListener("click", () => resetNccBatch(true));
  $("#bulkNccRows")?.addEventListener("click", event => {
    if (!event.target.closest("[data-remove-ncc-row]")) return;
    setNccStep(Math.min(v42NccStep, $$(".bulk-ncc-row", $("#bulkNccRows")).length - 1));
  });

  $("#stocktakeBox")?.addEventListener("input", updateStocktakePreview);
  $("#historyList")?.addEventListener("click", event => {
    const button = event.target.closest("[data-history-page]");
    if (!button || button.disabled) return;
    v42HistoryPage += button.dataset.historyPage === "next" ? 1 : -1;
    renderHistoryV4Runtime();
    $("#historyList")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $$("[data-cabin-view]").forEach(button => button.addEventListener("click", () => activateCabinSubview(button.dataset.cabinView)));
  $("#addTransferRowBtn")?.addEventListener("click", () => addTransferRow());
  $("#resetTransferBtn")?.addEventListener("click", resetTransfer);
  $("#saveTransferBtn")?.addEventListener("click", saveTransfer);
  $("#transferFromMachine")?.addEventListener("change", () => { refreshTransferProducts(); updateTransferPreview(); });
  $("#transferToMachine")?.addEventListener("change", updateTransferPreview);
  $("#transferRows")?.addEventListener("input", updateTransferPreview);
  $("#transferRows")?.addEventListener("change", updateTransferPreview);
  $("#transferRows")?.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-transfer-row]");
    if (!remove) return;
    remove.closest(".transfer-row").remove();
    if (!$(".transfer-row", $("#transferRows"))) addTransferRow();
    updateTransferPreview();
  });

  $("#managementSelect")?.addEventListener("change", applyManagementView);
  $("#nccStepNav")?.addEventListener("click", event => {
    if (event.target.closest("#nccPrevBtn")) setNccStep(v42NccStep - 1, true);
    if (event.target.closest("#nccNextBtn")) {
      const count = $$(".bulk-ncc-row", $("#bulkNccRows")).length;
      if (v42NccStep < count - 1) setNccStep(v42NccStep + 1, true);
      else $("#saveNccBatchBtn")?.focus();
    }
  });

  $("#layoutEditorRows")?.addEventListener("focusin", event => {
    if (event.target.matches(".layout-product")) showProductMenu(event.target.closest(".layout-product-combo"));
  });
  $("#layoutEditorRows")?.addEventListener("input", event => {
    if (event.target.matches(".layout-product")) showProductMenu(event.target.closest(".layout-product-combo"));
  });
  $("#layoutEditorRows")?.addEventListener("keydown", event => {
    if (!event.target.matches(".layout-product")) return;
    const combo = event.target.closest(".layout-product-combo");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      showProductMenu(combo);
      const choices = $$("[data-product-choice]", combo);
      if (choices.length) choices[0].focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      $(".product-picker-menu", combo).hidden = true;
      machineEditorDirty = true;
    } else if (event.key === "Escape") {
      $(".product-picker-menu", combo).hidden = true;
    }
  });
  $("#layoutEditorRows")?.addEventListener("click", event => {
    const toggle = event.target.closest("[data-product-menu]");
    if (toggle) {
      const combo = toggle.closest(".layout-product-combo");
      showProductMenu(combo);
      $(".layout-product", combo).focus();
      return;
    }
    const choice = event.target.closest("[data-product-choice]");
    if (choice) {
      const combo = choice.closest(".layout-product-combo");
      $(".layout-product", combo).value = choice.dataset.productChoice;
      $(".product-picker-menu", combo).hidden = true;
      machineEditorDirty = true;
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".layout-product-combo")) $$(".product-picker-menu").forEach(menu => { menu.hidden = true; });
  });

  resetNccBatch();
  resetTransfer();
  renderQuickFill();
  renderStocktake();
  renderHistoryV4Runtime();
  renderMachineManager(true);
  applyManagementView();
}

setupV42();
