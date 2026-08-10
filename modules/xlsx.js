/* Quản Lý Nhập Hàng V5.4.13 - xlsx.js */
function xlsxEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xlsxColName(index) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function xlsxSafeSheetName(name, used = new Set()) {
  const base = String(name || "Sheet")
    .replace(/[\[\]\*\/\\\?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLocaleLowerCase("vi"))) {
    const suffix = ` ${index++}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLocaleLowerCase("vi"));
  return candidate;
}

function xlsxCellXml(cell, rowIndex, colIndex) {
  const ref = `${xlsxColName(colIndex)}${rowIndex}`;
  const style = cell?.style ? ` s="${cell.style}"` : "";
  if (cell?.formula) return `<c r="${ref}"${style}><f>${xlsxEscape(cell.formula)}</f></c>`;
  const value = cell && typeof cell === "object" && "value" in cell ? cell.value : cell;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t>${xlsxEscape(value)}</t></is></c>`;
}

function xlsxSheetXml(sheet) {
  const rows = sheet.rows || [];
  const widths = sheet.widths || [];
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>` : "";
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => xlsxCellXml(cell, rowIndex + 1, colIndex)).join("");
    const height = row.some(cell => cell?.style === 1 || cell?.style === 2) ? ` ht="${rowIndex === 0 ? 22 : 20}" customHeight="1"` : "";
    return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
  }).join("");
  const freeze = sheet.freezeTopRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${sheetRows}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.7" bottom="0.7" header="0.3" footer="0.3"/><pageSetup orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function xlsxZipPart(path, content) {
  const encoder = new TextEncoder();
  return { path, bytes: encoder.encode(content) };
}

function xlsxCrc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function xlsxU16(value) {
  return [value & 255, (value >>> 8) & 255];
}

function xlsxU32(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

function xlsxBuildZip(parts) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  parts.forEach(part => {
    const name = encoder.encode(part.path);
    const crc = xlsxCrc32(part.bytes);
    const local = new Uint8Array([
      ...xlsxU32(0x04034b50), ...xlsxU16(20), ...xlsxU16(0), ...xlsxU16(0),
      ...xlsxU16(0), ...xlsxU16(0), ...xlsxU32(crc), ...xlsxU32(part.bytes.length),
      ...xlsxU32(part.bytes.length), ...xlsxU16(name.length), ...xlsxU16(0)
    ]);
    chunks.push(local, name, part.bytes);
    central.push({ name, crc, size: part.bytes.length, offset });
    offset += local.length + name.length + part.bytes.length;
  });
  const centralStart = offset;
  central.forEach(entry => {
    const header = new Uint8Array([
      ...xlsxU32(0x02014b50), ...xlsxU16(20), ...xlsxU16(20), ...xlsxU16(0), ...xlsxU16(0),
      ...xlsxU16(0), ...xlsxU16(0), ...xlsxU32(entry.crc), ...xlsxU32(entry.size),
      ...xlsxU32(entry.size), ...xlsxU16(entry.name.length), ...xlsxU16(0), ...xlsxU16(0),
      ...xlsxU16(0), ...xlsxU16(0), ...xlsxU32(0), ...xlsxU32(entry.offset)
    ]);
    chunks.push(header, entry.name);
    offset += header.length + entry.name.length;
  });
  const end = new Uint8Array([
    ...xlsxU32(0x06054b50), ...xlsxU16(0), ...xlsxU16(0), ...xlsxU16(central.length),
    ...xlsxU16(central.length), ...xlsxU32(offset - centralStart), ...xlsxU32(centralStart),
    ...xlsxU16(0)
  ]);
  chunks.push(end);
  return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function downloadXlsxWorkbook(sheets, filename) {
  const used = new Set();
  const safeSheets = sheets.map(sheet => ({ ...sheet, name: xlsxSafeSheetName(sheet.name, used) }));
  const workbookSheets = safeSheets.map((sheet, index) => `<sheet name="${xlsxEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const workbookRels = safeSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const contentTypes = safeSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const parts = [
    xlsxZipPart("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>`),
    xlsxZipPart("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    xlsxZipPart("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    xlsxZipPart("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets><calcPr calcMode="auto"/></workbook>`),
    xlsxZipPart("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF94A3B8"/></left><right style="thin"><color rgb="FF94A3B8"/></right><top style="thin"><color rgb="FF94A3B8"/></top><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs></styleSheet>`)
  ];
  safeSheets.forEach((sheet, index) => parts.push(xlsxZipPart(`xl/worksheets/sheet${index + 1}.xml`, xlsxSheetXml(sheet))));
  const link = document.createElement("a");
  link.href = URL.createObjectURL(xlsxBuildZip(parts));
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function xlsxTitleRow(text, width) {
  return [{ value: text, style: 2 }, ...Array(Math.max(0, width - 1)).fill("")];
}

function xlsxHeaderRow(labels) {
  return labels.map(label => ({ value: label, style: 1 }));
}

function xlsxDataRow(values) {
  return values.map(value => typeof value === "object" ? { style: 3, ...value } : { value, style: 3 });
}

function xlsxTotalRow(values) {
  return values.map(value => typeof value === "object" ? { style: 4, ...value } : { value, style: 4 });
}

function orderSheetRows(rows, title) {
  const header = ["Máy", "Sản phẩm", "Số slot", "Sức chứa", "Tồn cabin", "Tồn dùng tính đơn", "Số thùng", "Quy đổi sản phẩm", "Ghi chú"];
  const body = rows.map((row, index) => {
    const excelRow = index + 5;
    return xlsxDataRow([
      row.machine, row.product, row.slotCount, row.capacity, row.qty, row.projected,
      row.pack.packs, { formula: `G${excelRow}*${row.pack.packSize}` }, row.storageReason || ""
    ]);
  });
  const totalRowIndex = body.length + 5;
  return [
    xlsxTitleRow(title, header.length),
    xlsxDataRow([`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`, "", "", "", "", "", "", "", ""]),
    Array(header.length).fill(""),
    xlsxHeaderRow(header),
    ...body,
    xlsxTotalRow(["TỔNG", "", "", "", "", "", { formula: `SUM(G5:G${totalRowIndex - 1})` }, { formula: `SUM(H5:H${totalRowIndex - 1})` }, ""])
  ];
}

function exportNccXlsx() {
  if (!syncUser) return showToast("Cần đăng nhập để xuất Excel.");
  const machines = selectedNccExportMachines();
  const rows = buildOrderRows().filter(row => machines.includes(row.machine));
  if (!machines.length) return showToast("Chưa chọn máy để xuất Excel.");
  if (!rows.length) return showToast("Các máy đã chọn chưa có sản phẩm cần nhập.");
  const grouped = groupOrdersByMachine(rows);
  const sheets = [{
    name: "Tong hop",
    rows: orderSheetRows(rows, `Đơn nhập hàng NCC - ${todayISO()}`),
    widths: [18, 28, 10, 12, 12, 18, 10, 18, 28],
    freezeTopRow: true,
    autoFilter: `A4:I${rows.length + 5}`
  }];
  machines.forEach(machine => {
    const machineRows = grouped[machine] || [];
    if (!machineRows.length) return;
    sheets.push({
      name: machine,
      rows: orderSheetRows(machineRows, `Đơn nhập hàng NCC - ${machine}`),
      widths: [18, 28, 10, 12, 12, 18, 10, 18, 28],
      freezeTopRow: true,
      autoFilter: `A4:I${machineRows.length + 5}`
    });
  });
  downloadXlsxWorkbook(sheets, `don-nhap-hang-${todayISO()}.xlsx`);
  showToast(`Đã xuất Excel ${machines.length} máy.`);
}

function exportCabinXlsx() {
  if (!syncUser) return showToast("Cần đăng nhập để xuất Excel.");
  const machine = activeCabinMachine;
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const rows = Object.entries(cab).map(([key, qty]) => {
    const [rowMachine, product] = key.split("||");
    if (rowMachine !== machine) return null;
    const raw = Number(rawCabin[key] || 0);
    const pack = productInfo(product).pack;
    const status = raw < 0 ? `Lệch ${Math.abs(raw)} sản phẩm` : qty < 12 ? "Sắp hết" : qty < pack ? "Tồn thấp" : "Ổn";
    return { machine, product, qty: Number(qty || 0), status, pack };
  }).filter(Boolean).sort((a, b) => a.product.localeCompare(b.product, "vi"));
  if (!rows.length) return showToast("Máy này chưa có tồn cabin để xuất.");
  const data = rows.map(row => xlsxDataRow([row.machine, row.product, row.qty, row.status, row.pack]));
  const totalRow = rows.length + 5;
  downloadXlsxWorkbook([{
    name: machine || "Ton cabin",
    rows: [
      xlsxTitleRow(`Tồn cabin - ${machine}`, 5),
      xlsxDataRow([`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`, "", "", "", ""]),
      Array(5).fill(""),
      xlsxHeaderRow(["Máy", "Sản phẩm", "Tồn hiện tại", "Trạng thái", "Sản phẩm/thùng"]),
      ...data,
      xlsxTotalRow(["TỔNG", "", { formula: `SUM(C5:C${totalRow - 1})` }, "", ""])
    ],
    widths: [18, 30, 14, 16, 16],
    freezeTopRow: true,
    autoFilter: `A4:E${totalRow}`
  }], `ton-cabin-${machine.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${todayISO()}.xlsx`);
  showToast(`Đã xuất tồn cabin ${machine}.`);
}

function historyExportTypeLabel() {
  return activeHistoryType === "fill" ? "Nhập Fill"
    : activeHistoryType === "ncc" ? "Nhập Hàng NCC"
      : activeHistoryType === "transfer" ? "Chuyển tồn"
        : "Kiểm kê cabin";
}

function historyMachineOrderIndex(machine) {
  const target = canonicalMachineName(machine);
  const index = config().machines.findIndex(item => canonicalMachineName(item.name) === target);
  return index === -1 ? 9999 : index;
}

function historySlotSortValue(slot) {
  const value = String(slot ?? "").trim();
  if (!value) return Number.MAX_SAFE_INTEGER;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER - 1;
}

function historySortRows(rows) {
  return [...rows].sort((a, b) =>
    historyMachineOrderIndex(a.machine) - historyMachineOrderIndex(b.machine)
    || String(a.machine || "").localeCompare(String(b.machine || ""), "vi")
    || historySlotSortValue(a.slot) - historySlotSortValue(b.slot)
    || String(a.product || "").localeCompare(String(b.product || ""), "vi")
    || String(a.recorded_at || a.date).localeCompare(String(b.recorded_at || b.date))
  );
}

function historyNccTotalsByProduct(selectedMachines) {
  const from = $("#historyDate")?.value || "";
  const to = $("#historyToDate")?.value || "";
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  const machines = new Set(selectedMachines || []);
  const totals = new Map();
  activeLogRows("nccLogs")
    .filter(item => (!from || item.date >= from) && (!to || item.date <= to)
      && (!query || String(item.product).toLocaleLowerCase("vi").includes(query))
      && (!machines.size || machines.has(canonicalMachineName(item.machine))))
    .forEach(item => {
      const machine = item.machine || "";
      const product = item.product || "";
      const key = `${canonicalMachineName(machine)}||${product}`;
      totals.set(key, (totals.get(key) || 0) + Math.abs(Number(item.qty || 0)));
    });
  return totals;
}

function historyFillLayoutRows(selectedMachines) {
  const query = ($("#historyProduct")?.value || "").trim().toLocaleLowerCase("vi");
  const machines = new Set(selectedMachines || []);
  return config().slots
    .filter(slot => (!machines.size || machines.has(canonicalMachineName(slot.machine)))
      && (!query || String(slot.product).toLocaleLowerCase("vi").includes(query)))
    .map(slot => ({
      machine: slot.machine,
      slot: String(slot.slot || ""),
      product: slot.product || "",
      qty: 0
    }));
}

function historySummaryRows(rows, options = {}) {
  const summarySource = typeof options.summarySource === "function" ? options.summarySource : null;
  const nccTotals = options.nccTotals instanceof Map ? options.nccTotals : new Map();
  const groups = new Map();
  if (activeHistoryType === "fill" && Array.isArray(options.layoutRows)) {
    options.layoutRows.forEach(item => {
      const product = item.product || "";
      const machine = item.machine || "";
      const slot = String(item.slot || "");
      const key = `${machine}||${slot}||${product}`;
      if (!groups.has(key)) groups.set(key, { machine, slot, product, qty: 0 });
    });
  }
  historySortRows(rows).forEach(item => {
    const product = item.product || "";
    const machine = item.machine || "";
    const slot = activeHistoryType === "fill" ? String(item.slot || "") : "";
    const key = activeHistoryType === "fill" ? `${machine}||${slot}||${product}` : `${machine}||${product}`;
    if (!groups.has(key)) groups.set(key, { machine, slot, product, qty: 0 });
    const group = groups.get(key);
    group.qty += Math.abs(Number(item.qty || 0));
  });
  const sorted = [...groups.values()].sort((a, b) =>
    historyMachineOrderIndex(a.machine) - historyMachineOrderIndex(b.machine)
    || a.machine.localeCompare(b.machine, "vi")
    || historySlotSortValue(a.slot) - historySlotSortValue(b.slot)
    || a.product.localeCompare(b.product, "vi")
  );
  const metricLabel = activeHistoryType === "ncc" ? "Tổng NCC"
    : activeHistoryType === "transfer" ? "Tổng chuyển"
      : activeHistoryType === "adjust" ? "Tổng chênh lệch"
        : "Tổng đã nhập";
  const nccPrinted = new Set();
  const body = sorted.map((item, index) => {
    const row = index + 5;
    const cabin = getCabinQty(item.machine, item.product);
    if (activeHistoryType === "fill") {
      const sourceRow = summarySource?.(item.machine, item.slot, item.product);
      const machineStockCell = sourceRow ? { formula: `'${xlsxSafeSheetName(item.machine)}'!G${sourceRow}` } : "";
      const nccKey = `${canonicalMachineName(item.machine)}||${item.product}`;
      const nccQty = nccPrinted.has(nccKey) ? "" : Number(nccTotals.get(nccKey) || 0);
      nccPrinted.add(nccKey);
      return xlsxDataRow([
        item.machine, item.slot || "Chưa có slot", item.product, item.qty, nccQty,
        cabin, machineStockCell, { formula: `N(F${row})+N(G${row})` },
        { formula: `N(E${row})-N(D${row})-N(H${row})` }, ""
      ]);
    }
    const sourceRow = summarySource?.(item.machine, "", item.product);
    const manualStockCell = sourceRow ? { formula: `'${xlsxSafeSheetName(item.machine)}'!E${sourceRow}` } : "";
    return xlsxDataRow([item.machine, item.product, item.qty, cabin, manualStockCell, { formula: `D${row}+E${row}` }, { formula: `F${row}-C${row}` }, ""]);
  });
  const total = body.length + 5;
  if (activeHistoryType === "fill") {
    return [
      xlsxTitleRow(`Tổng hợp lịch sử - ${historyExportTypeLabel()}`, 10),
      xlsxDataRow([`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`, "", "", "", "", "", "", "", "", ""]),
      Array(10).fill(""),
      xlsxHeaderRow(["Máy", "Slot", "Sản phẩm", "Tổng đã fill", "Tổng nhập NCC", "Tồn cabin", "Tồn trong máy", "Tổng trong máy", "Lệch NCC", "Ghi chú"]),
      ...body,
      xlsxTotalRow(["TỔNG", "", "", { formula: `SUM(D5:D${total - 1})` }, { formula: `SUM(E5:E${total - 1})` }, { formula: `SUM(F5:F${total - 1})` }, { formula: `SUM(G5:G${total - 1})` }, { formula: `SUM(H5:H${total - 1})` }, { formula: `SUM(I5:I${total - 1})` }, ""])
    ];
  }
  return [
    xlsxTitleRow(`Tổng hợp lịch sử - ${historyExportTypeLabel()}`, 8),
    xlsxDataRow([`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`, "", "", "", "", "", "", ""]),
    Array(8).fill(""),
    xlsxHeaderRow(["Máy", "Sản phẩm", metricLabel, "Tồn cabin hệ thống", "Tồn trong máy", "Tổng thực tế", "Chênh lệch", "Ghi chú"]),
    ...body,
    xlsxTotalRow(["TỔNG", "", { formula: `SUM(C5:C${total - 1})` }, { formula: `SUM(D5:D${total - 1})` }, { formula: `SUM(E5:E${total - 1})` }, { formula: `SUM(F5:F${total - 1})` }, { formula: `SUM(G5:G${total - 1})` }, ""])
  ];
}

function historyDetailRows(rows) {
  const header = activeHistoryType === "fill" ? ["Ngày giờ", "Máy", "Slot", "Sản phẩm", "Số lượng"]
    : activeHistoryType === "ncc" ? ["Ngày giờ", "Máy", "Sản phẩm", "Thùng", "Quy đổi sản phẩm"]
      : activeHistoryType === "transfer" ? ["Ngày giờ", "Máy nguồn", "Máy nhận", "Sản phẩm", "Số lượng"]
        : ["Ngày giờ", "Máy", "Sản phẩm", "Tồn cũ", "Tồn thực tế", "Chênh lệch"];
  const transferTargets = new Map();
  if (activeHistoryType === "transfer") {
    historyRowsV42().filter(item => Number(item.qty) > 0).forEach(item => transferTargets.set(`${item.batch_id || item.id}||${item.product}`, item.machine));
  }
  const body = historySortRows(rows).map(item => activeHistoryType === "fill" ? xlsxDataRow([historyDateTime(item), item.machine, item.slot || "Chưa có slot", item.product, item.qty])
    : activeHistoryType === "ncc" ? xlsxDataRow([historyDateTime(item), item.machine, item.product, nccBoxes(item), item.qty])
      : activeHistoryType === "transfer" ? xlsxDataRow([historyDateTime(item), item.machine, transferTargets.get(`${item.batch_id || item.id}||${item.product}`) || "", item.product, Math.abs(Number(item.qty || 0))])
        : xlsxDataRow([historyDateTime(item), item.machine, item.product, Number(item.actual) - Number(item.qty), item.actual, item.qty]));
  return [xlsxHeaderRow(header), ...body];
}

function exportHistoryXlsx() {
  if (!syncUser) return showToast("Cần đăng nhập để xuất Excel.");
  const selectedMachines = selectedHistoryExportMachines();
  if (!selectedMachines.length) return showToast("Chưa chọn máy để xuất lịch sử.");
  const baseRows = historyRowsV42({ machineFilter: false });
  const rows = activeHistoryType === "transfer"
    ? baseRows.filter(item => {
        const batch = item.batch_id || item.id;
        const related = baseRows.filter(row => (row.batch_id || row.id) === batch);
        return Number(item.qty) < 0 && related.some(row => selectedMachines.includes(canonicalMachineName(row.machine)));
      })
    : baseRows.filter(item => selectedMachines.includes(canonicalMachineName(item.machine)));
  if (!rows.length) return showToast("Chưa có lịch sử phù hợp để xuất.");
  const sortedRows = historySortRows(rows);
  const machines = config().machines
    .map(machine => machine.name)
    .filter(machine => unique(sortedRows.map(row => canonicalMachineName(row.machine))).includes(canonicalMachineName(machine)));
  unique(sortedRows.map(row => row.machine)).forEach(machine => {
    if (!machines.some(item => canonicalMachineName(item) === canonicalMachineName(machine))) machines.push(machine);
  });
  const nccTotals = activeHistoryType === "fill" ? historyNccTotalsByProduct(selectedMachines) : new Map();
  const fillLayoutRows = activeHistoryType === "fill" ? historyFillLayoutRows(selectedMachines) : [];
  fillLayoutRows.forEach(row => {
    if (!machines.some(machine => canonicalMachineName(machine) === canonicalMachineName(row.machine))) machines.push(row.machine);
  });
  const summaryWidth = activeHistoryType === "fill" ? [18, 10, 30, 16, 16, 14, 16, 16, 14, 24] : [18, 30, 16, 18, 16, 16, 14, 24];
  const summaryFilterLastCol = activeHistoryType === "fill" ? "J" : "H";
  const sourceRowsByKey = new Map();
  machines.forEach(machine => {
    const machineRows = sortedRows.filter(row => canonicalMachineName(row.machine) === canonicalMachineName(machine));
    const machineLayoutRows = fillLayoutRows.filter(row => canonicalMachineName(row.machine) === canonicalMachineName(machine));
    const machineSummary = historySummaryRows(machineRows, { nccTotals, layoutRows: machineLayoutRows });
    const bodyEnd = Math.max(4, machineSummary.length - 1);
    for (let row = 5; row <= bodyEnd; row++) {
      const machineName = machineSummary[row - 1]?.[0]?.value || machine;
      const slotValue = activeHistoryType === "fill" ? machineSummary[row - 1]?.[1]?.value || "" : "";
      const slot = slotValue === "Chưa có slot" ? "" : slotValue;
      const product = activeHistoryType === "fill" ? machineSummary[row - 1]?.[2]?.value || "" : machineSummary[row - 1]?.[1]?.value || "";
      sourceRowsByKey.set(activeHistoryType === "fill" ? `${machineName}||${slot}||${product}` : `${machineName}||${product}`, row);
    }
  });
  const sheets = [{
    name: "Tong hop",
    rows: historySummaryRows(sortedRows, {
      nccTotals,
      layoutRows: fillLayoutRows,
      summarySource(machine, slot, product) {
        return sourceRowsByKey.get(activeHistoryType === "fill" ? `${machine}||${slot}||${product}` : `${machine}||${product}`) || "";
      }
    }),
    widths: summaryWidth,
    freezeTopRow: true,
    autoFilter: `A4:${summaryFilterLastCol}${Math.max(5, rows.length + fillLayoutRows.length + 5)}`,
    landscape: true
  }, {
    name: "Chi tiet",
    rows: historyDetailRows(sortedRows),
    widths: [22, 18, 12, 30, 14, 14],
    freezeTopRow: true,
    autoFilter: `A1:F${Math.max(2, rows.length + 1)}`,
    landscape: true
  }];
  machines.forEach(machine => {
    const machineRows = sortedRows.filter(row => canonicalMachineName(row.machine) === canonicalMachineName(machine));
    const machineLayoutRows = fillLayoutRows.filter(row => canonicalMachineName(row.machine) === canonicalMachineName(machine));
    const machineSummaryWidth = activeHistoryType === "fill" ? summaryWidth : [18, 30, 16, 18, 16, 16, 14, 24];
    const machineSummaryFilterLastCol = activeHistoryType === "fill" ? "J" : "H";
    sheets.push({
      name: machine,
      rows: historySummaryRows(machineRows, { nccTotals, layoutRows: machineLayoutRows }),
      widths: machineSummaryWidth,
      freezeTopRow: true,
      autoFilter: `A4:${machineSummaryFilterLastCol}${Math.max(5, machineRows.length + machineLayoutRows.length + 5)}`,
      landscape: true
    });
  });
  downloadXlsxWorkbook(sheets, `lich-su-${activeHistoryType}-${todayISO()}.xlsx`);
  showToast("Đã xuất lịch sử Excel.");
}

