/* Quản Lý Nhập Hàng V5.2.0 - transfer.js */
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


