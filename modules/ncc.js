/* Quản Lý Nhập Hàng V5.4.12 - ncc.js */
function nccProductsForMachine(machine) {
  return unique(config().slots.filter(slot => slot.machine === machine).map(slot => slot.product))
    .sort((a, b) => a.localeCompare(b, "vi"));
}

function renderNccProductList() {
  const box = $("#bulkNccRows");
  const machine = $("#nccMachine")?.value;
  if (!box || !machine) return;
  const draft = readFreshV42Draft(V42_NCC_DRAFT) || {};
  const values = draft.machines?.[machine] || {};
  const products = nccProductsForMachine(machine);
  box.innerHTML = products.length ? products.map((product, index) => `
    <div class="bulk-ncc-row ncc-product-card" data-machine="${htmlEscape(machine)}" data-product="${htmlEscape(product)}">
      <div class="ncc-product-info"><b>${htmlEscape(product)}</b><span>1 thùng = ${productInfo(product).pack} sản phẩm</span><span class="ncc-product-total"></span></div>
      <div class="bulk-box-control"><input class="bulk-boxes" type="number" min="0" step="1" inputmode="numeric" placeholder="Số thùng" value="${htmlEscape(values[product] || "")}" data-step="${index}" aria-label="Số thùng ${htmlEscape(product)}" /><button type="button" class="clear-ncc-row" data-clear-ncc tabindex="-1" aria-label="Xóa số thùng ${htmlEscape(product)}">×</button></div>
    </div>`).join("") : `<p class="muted">Máy này chưa có sản phẩm trong layout.</p>`;
  updateNccBatchPreview();
}

function updateNccBatchPreview() {
  const rows = nccDraftRows().map(item => ({ ...item, boxes: Number(item.boxes || 0) })).filter(item => item.boxes > 0);
  const boxes = rows.reduce((sum, item) => sum + item.boxes, 0);
  const products = rows.reduce((sum, item) => sum + item.boxes * productInfo(item.product).pack, 0);
  $$(".ncc-product-card", $("#bulkNccRows")).forEach(row => {
    const qty = Number($(".bulk-boxes", row).value || 0);
    const product = row.dataset.product;
    const total = $(".ncc-product-total", row);
    if (total) total.textContent = qty > 0 ? `Đã nhập: ${qty} thùng = ${qty * productInfo(product).pack} sản phẩm` : "";
  });
  if ($("#nccBatchPreview")) $("#nccBatchPreview").innerHTML = `
    <div><span>Sản phẩm đã nhập</span><b>${rows.length}</b></div>
    <div><span>Tổng thùng</span><b>${boxes}</b></div>
    <div><span>Quy đổi</span><b>${products} sản phẩm</b></div>`;
}

function nccDraftRows() {
  return $$(".ncc-product-card", $("#bulkNccRows")).map(row => ({
    machine: row.dataset.machine,
    product: row.dataset.product,
    boxes: $(".bulk-boxes", row).value
  }));
}

function persistNccDraft() {
  const form = $("#nccForm");
  if (!form) return;
  const draft = readFreshV42Draft(V42_NCC_DRAFT) || { machines: {} };
  draft.machines ||= {};
  const rows = nccDraftRows();
  const rowMachine = rows[0]?.machine;
  if (rowMachine) {
    draft.machines[rowMachine] = Object.fromEntries(rows.map(item => [item.product, item.boxes]));
  }
  draft.date = form.date.value;
  draft.savedOn = todayISO();
  draft.activeMachine = $("#nccMachine")?.value || rowMachine || "";
  localStorage.setItem(V42_NCC_DRAFT, JSON.stringify(draft));
}

function scheduleNccDraft() {
  clearTimeout(v42NccDraftTimer);
  v42NccDraftTimer = setTimeout(persistNccDraft, 180);
}

function flushNccDraft() {
  clearTimeout(v42NccDraftTimer);
  v42NccDraftTimer = 0;
  persistNccDraft();
}

function resetNccBatch(clearDraft = false) {
  const form = $("#nccForm");
  const box = $("#bulkNccRows");
  if (!form || !box) return;
  if (clearDraft && nccDraftRows().some(item => Number(item.boxes || 0) > 0) && !confirm("Xóa toàn bộ số thùng NCC đang nhập?")) return;
  clearTimeout(v42NccDraftTimer);
  v42NccDraftTimer = 0;
  if (clearDraft) localStorage.removeItem(V42_NCC_DRAFT);
  const draft = clearDraft ? null : readFreshV42Draft(V42_NCC_DRAFT);
  form.date.value = draft?.date || todayISO();
  const machine = $("#nccMachine");
  machine.innerHTML = machineOptionsHtml(draft?.activeMachine || activeDashboardMachine || "");
  renderNccProductList();
}

function saveNccBatch(form) {
  if (!requirePermission("receive")) return;
  const entries = nccDraftRows().map(item => ({ ...item, boxes: Number(item.boxes || 0) })).filter(item => item.boxes > 0);
  if (!entries.length) return showToast("Chưa nhập số thùng NCC.");
  if (entries.some(item => !Number.isInteger(item.boxes))) return showToast("Số thùng phải là số nguyên.");
  const merged = new Map();
  entries.forEach(item => {
    const key = `${item.machine}||${item.product}`;
    if (!merged.has(key)) merged.set(key, { machine: item.machine, product: item.product, boxes: 0 });
    merged.get(key).boxes += item.boxes;
  });
  const rows = [...merged.values()];
  const totalBoxes = rows.reduce((sum, item) => sum + item.boxes, 0);
  const totalProducts = rows.reduce((sum, item) => sum + item.boxes * productInfo(item.product).pack, 0);
  if (!confirm(`Lưu lô NCC gồm ${rows.length} sản phẩm, ${totalBoxes} thùng (${totalProducts} sản phẩm)?`)) return;
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
  showToast(`Đã lưu ${rows.length} sản phẩm NCC.`);
}







