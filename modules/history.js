/* Quản Lý Nhập Hàng V5.4.2 - history.js */
function isTransferRecord(item) {
  return String(item.reason || "").startsWith("Chuyển tồn:");
}

function historyRowsV42(options = {}) {
  const useMachineFilter = options.machineFilter !== false;
  const key = activeHistoryType === "fill" ? "fillLogs" : activeHistoryType === "ncc" ? "nccLogs" : "adjustLogs";
  const from = $("#historyDate")?.value || "";
  const to = $("#historyToDate")?.value || "";
  const machine = $("#historyMachine")?.value || "";
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  let rows = activeLogRows(key)
    .filter(item => activeHistoryType === "transfer" ? isTransferRecord(item) : activeHistoryType === "adjust" ? !isTransferRecord(item) : true)
    .filter(item => (!from || item.date >= from) && (!to || item.date <= to)
      && (!query || String(item.product).toLocaleLowerCase("vi").includes(query)))
  if (useMachineFilter && machine && activeHistoryType === "transfer") {
    const batches = new Set(rows.filter(item => canonicalMachineName(item.machine) === machine).map(item => item.batch_id || item.id));
    rows = rows.filter(item => batches.has(item.batch_id || item.id));
  } else if (useMachineFilter && machine) {
    rows = rows.filter(item => canonicalMachineName(item.machine) === machine);
  }
  return rows.sort((a, b) => String(b.recorded_at || b.date).localeCompare(String(a.recorded_at || a.date)));
}

function renderHistoryExportMachines() {
  const box = $("#historyExportMachines");
  if (!box) return;
  const current = $("#historyMachine")?.value || "";
  box.innerHTML = config().machines.map(machine => {
    const checked = !current || canonicalMachineName(machine.name) === current;
    return `<label><input type="checkbox" value="${htmlEscape(machine.name)}" ${checked ? "checked" : ""} /><span>${htmlEscape(machine.name)}</span></label>`;
  }).join("");
}

function selectedHistoryExportMachines() {
  return $$("#historyExportMachines input:checked").map(input => canonicalMachineName(input.value));
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
  renderHistoryExportMachines();
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
      const actions = hasPermission("stocktake") ? `<div class="actions"><button class="mini danger" data-history-action="delete-transfer" data-history-id="${htmlEscape(batch.id)}">Xóa phiếu</button></div>` : "";
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
    const detail = activeHistoryType === "fill" && item.slot ? `Slot ${item.slot} · ${htmlEscape(item.product)}` : htmlEscape(item.product);
    const actions = hasPermission(permission) ? `<div class="actions">${activeHistoryType === "adjust" ? "" : `<button class="mini" data-history-action="edit" data-history-type="${activeHistoryType}" data-history-id="${htmlEscape(item.id)}">Sửa</button>`}<button class="mini danger" data-history-action="delete" data-history-type="${activeHistoryType}" data-history-id="${htmlEscape(item.id)}">Xóa</button></div>` : "";
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








