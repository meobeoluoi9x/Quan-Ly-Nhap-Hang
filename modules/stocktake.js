/* Quản Lý Nhập Hàng V4.5.0 - stocktake.js */
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
        <input type="number" step="1" inputmode="numeric" placeholder="Giữ ${item.qty}" />
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
  if (rows.some(item => !Number.isInteger(item.actual))) return showToast("Tồn thực tế phải là số nguyên.");
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

