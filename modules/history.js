/* Quản Lý Nhập Hàng V4.5.0 - history.js */
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
    const detail = activeHistoryType === "fill" && item.slot ? `Slot ${item.slot} · ${htmlEscape(item.product)}` : htmlEscape(item.product);
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
  const body = rows.map(item => activeHistoryType === "fill" ? [historyDateTime(item), item.machine, item.slot || "", item.product, item.qty]
    : activeHistoryType === "ncc" ? [historyDateTime(item), item.machine, item.product, nccBoxes(item), item.qty]
    : [historyDateTime(item), item.machine, item.product, Number(item.actual) - Number(item.qty), item.actual, item.qty]);
  downloadCsvFile([header, ...body], `lich-su-${activeHistoryType}-${todayISO()}.csv`);
}


