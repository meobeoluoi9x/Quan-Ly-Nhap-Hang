const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtimeModules = ["order.js", "dashboard.js", "runtime-core.js", "xlsx.js", "fill.js", "ncc.js", "stocktake.js", "transfer.js", "history.js", "ui.js", "bootstrap.js"];
const v42Source = runtimeModules.map(name => fs.readFileSync(path.join(root, "modules", name), "utf8")).join("\n");
const orderSource = fs.readFileSync(path.join(root, "modules", "order.js"), "utf8");
const dashboardSource = fs.readFileSync(path.join(root, "modules", "dashboard.js"), "utf8");
const runtimeCoreSource = fs.readFileSync(path.join(root, "modules", "runtime-core.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const functionNames = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(match => match[1]);
assert.equal(new Set(functionNames).size, functionNames.length, "app.js contains duplicate function declarations");

function extractLastFunction(name) {
  return extractLastFunctionFromSource(source, name);
}

function extractLastOrderFunction(name) {
  return extractLastFunctionFromSource(orderSource, name);
}

function extractLastFunctionFromSource(input, name) {
  const pattern = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, "gm");
  const matches = [...input.matchAll(pattern)];
  assert.ok(matches.length, `Missing function: ${name}`);
  const start = matches[matches.length - 1].index;
  const nextPattern = /^(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/gm;
  nextPattern.lastIndex = start + 1;
  const next = nextPattern.exec(input);
  return input.slice(start, next ? next.index : input.length);
}

const context = vm.createContext({ console });
[
  "normalizeState",
  "stableConfigId",
].forEach(name => vm.runInContext(extractLastFunction(name), context));
vm.runInContext(extractLastFunction("mergeConfigRows"), context);
vm.runInContext(extractLastFunction("isAccessDeniedError"), context);
assert.equal(context.isAccessDeniedError({ message: "Tài khoản chưa được quản trị viên cấp quyền" }), true);
assert.equal(context.isAccessDeniedError({ message: "Failed to fetch" }), false);
assert.equal(context.isAccessDeniedError({ message: "JWT expired" }), false);
context.state = context.normalizeState({ machineConfigs: [
  { id: "machine-d3", name: "Máy D3", archived: false, updated_at: "2026-08-10T02:00:00.000Z", _sync: "synced" }
] });
context.mergeConfigRows("machineConfigs", [
  { id: "machine-d3", name: "Máy D3", archived: true, updated_at: "2026-08-10T01:00:00.000Z" }
]);
assert.equal(context.state.machineConfigs[0].archived, false, "older remote archived state must not hide D3");
context.mergeConfigRows("machineConfigs", [
  { id: "machine-d3", name: "Máy D3", archived: true, updated_at: "2026-08-10T03:00:00.000Z" }
]);
assert.equal(context.state.machineConfigs[0].archived, true, "newer remote state should still win");
context.state.machineConfigs[0] = { id: "machine-d3", name: "Máy D3", archived: false, updated_at: "2026-08-10T04:00:00.000Z", _sync: "pending" };
context.mergeConfigRows("machineConfigs", [
  { id: "machine-d3", name: "Máy D3", archived: true, updated_at: "2026-08-10T05:00:00.000Z" }
]);
assert.equal(context.state.machineConfigs[0].archived, false, "pending local changes must not be overwritten by remote merge");

[
  "defaultStorageRules",
  "activeStorageRules",
  "storageRuleForProduct",
  "isAquaProduct",
  "productInfo",
  "clampOrderByStorageLimit",
  "suggestOrder",
  "aquaReservePacksAfterFill",
  "suggestedAquaOrderForLayout",
  "suggestedOrderForLayout",
].forEach(name => vm.runInContext(extractLastOrderFunction(name), context));

[
  "htmlEscape",
  "csvCell"
].forEach(name => vm.runInContext(extractLastFunction(name), context));

context.config = () => ({ products: {} });
context.state = context.normalizeState({
  productStorageRules: [
    { id: "rule-aqua", product: "Aqua", no_wrap: true, pack: 28, shelf_per_pack: 1, max_packs: 3 },
    { id: "rule-sting-dau", product: "Sting lon Dâu", no_wrap: true, pack: 28, shelf_per_pack: 0.5, max_packs: 2 }
  ]
});

assert.equal(context.suggestOrder(56, "Aqua"), 0);
assert.equal(context.suggestOrder(28, "Aqua"), 28);
assert.equal(context.suggestOrder(1, "Aqua"), 56);
assert.equal(context.suggestOrder(0, "Aqua"), 84);
assert.equal(context.suggestOrder(6, "Pepsi chanh"), 24);
assert.equal(context.suggestOrder(7, "Pepsi chanh"), 0);

const twoSlots = { slotCount: 2, capacity: 40 };
assert.equal(context.suggestedOrderForLayout(0, "Pepsi chanh", twoSlots, 0), 48);
assert.equal(context.suggestedOrderForLayout(6, "Pepsi chanh", twoSlots, 6), 48);
assert.equal(context.suggestedOrderForLayout(7, "Pepsi chanh", twoSlots, 7), 0);
const d3AquaSlots = { slotCount: 4, capacity: 57 };
const thuVienAquaSlots = { slotCount: 4, capacity: 49 };
const ngoaiGaNineAquaSlots = { slotCount: 9, capacity: 121 };
assert.equal(context.suggestedOrderForLayout(0, "Aqua", d3AquaSlots, 0), 112);
assert.equal(context.suggestedOrderForLayout(28, "Aqua", d3AquaSlots, 28), 84);
assert.equal(context.suggestedOrderForLayout(0, "Aqua", thuVienAquaSlots, 0), 84);
assert.equal(context.suggestedOrderForLayout(0, "Aqua", ngoaiGaNineAquaSlots, 0), 168);
function jsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

jsonEqual(context.clampOrderByStorageLimit(84, 0, "Aqua"), { qty: 84, limited: false, reason: "" });
jsonEqual(context.clampOrderByStorageLimit(28, 42, "Aqua"), { qty: 28, limited: false, reason: "" });
jsonEqual(context.clampOrderByStorageLimit(56, 0, "Sting lon Dâu"), { qty: 56, limited: false, reason: "" });
jsonEqual(context.clampOrderByStorageLimit(28, 49, "Sting lon Dâu"), { qty: 0, limited: true, reason: "Giới hạn tốn chỗ: tối đa 2 thùng cabin" });

const normalized = context.normalizeState({ fillLogs: null, nccLogs: {}, adjustLogs: [] });
assert.ok(Array.isArray(normalized.fillLogs));
assert.ok(Array.isArray(normalized.nccLogs));
assert.ok(Array.isArray(normalized.machineConfigs));
assert.ok(Array.isArray(normalized.productStorageRules));

assert.equal(context.htmlEscape(`<b title='x'>&</b>`), "&lt;b title=&#39;x&#39;&gt;&amp;&lt;/b&gt;");
assert.equal(context.csvCell("=2+2"), `"'=2+2"`);
assert.equal(context.csvCell(-5), `"-5"`);

const draftStorage = new Map();
const draftContext = vm.createContext({
  todayISO: () => "2026-07-13",
  localStorage: {
    getItem: key => draftStorage.get(key) ?? null,
    removeItem: key => draftStorage.delete(key)
  }
});
["readV42Draft", "isV42DraftFresh", "readFreshV42Draft"]
  .forEach(name => vm.runInContext(extractLastFunctionFromSource(runtimeCoreSource, name), draftContext));
draftStorage.set("stale", JSON.stringify({ date: "2026-07-12", savedOn: "2026-07-12" }));
assert.equal(draftContext.readFreshV42Draft("stale"), null);
assert.equal(draftStorage.has("stale"), false);
draftStorage.set("today", JSON.stringify({ date: "2026-07-01", savedOn: "2026-07-13" }));
assert.equal(draftContext.readFreshV42Draft("today").date, "2026-07-01");

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");
assert.match(html, /Quản Lý Nhập Hàng V5\.4\.13/);
assert.match(html, /app\.js\?v=5\.4\.13/);
runtimeModules.forEach(name => assert.match(html, new RegExp(`modules/${name.replace(".", "\\.")}\\?v=5\\.4\\.13`)));
assert.match(html, /id="nccMachine"/);
assert.match(html, /id="storageRuleForm"/);
assert.match(html, /id="historyExportMachines"/);
assert.match(html, /id="selectAllHistoryMachines"/);
assert.match(html, /value="updates">Cập nhật phiên bản/);
assert.match(html, /class="version-notes"/);
assert.equal((html.match(/data-operation-view=/g) || []).length, 9);
assert.match(html, /class="tab operation-menu-tab" data-view="operations"/);

assert.match(orderSource, /function clampOrderByStorageLimit\(/);
assert.doesNotMatch(source, /function clampOrderByStorageLimit\(/);
assert.doesNotMatch(source, /function buildOrderRows\(/);
assert.match(dashboardSource, /function renderRoute\(/);
assert.match(dashboardSource, /function renderCabin\(/);
assert.match(dashboardSource, /function renderSelectedCabin\(/);
assert.doesNotMatch(source, /function renderCabin\(/);
assert.match(source, /function saveStorageRules\(/);
assert.match(source, /var machineEditorNew = false;/);
assert.match(source, /if \(!machineEditorNew && \(!selectedMachineEditorId/);
assert.match(source, /machineEditorNew = true;/);
assert.match(source, /machineEditorNew = false;/);
assert.match(source, /Không kiểm tra được quyền — đang dùng quyền đã lưu/);
assert.match(source, /function isAccessDeniedError\(/);
assert.match(source, /product_storage_rules/);
assert.match(orderSource, /storageLimited/);
assert.doesNotMatch(source, /data-add-boxes|data-val=/);

assert.match(v42Source, /function saveTransfer\(/);
assert.match(v42Source, /function saveStocktakeBatch\(/);
assert.match(v42Source, /V42_HISTORY_PAGE_SIZE = 30/);
assert.match(v42Source, /data-history-page="prev"/);
assert.match(v42Source, /function renderNccProductList\(/);
assert.match(v42Source, /function nccProductsForMachine\(/);
assert.match(v42Source, /function quickFillSlotsForMachine\(/);
assert.match(v42Source, /sort\(\(a, b\) => Number\(a\.slot\) - Number\(b\.slot\)\)/);
assert.doesNotMatch(v42Source, /function quickFillProductsForMachine\(/);
assert.doesNotMatch(v42Source, /function quickFillProductLayout\(/);
assert.match(v42Source, /data-slot="\$\{Number\(slot\.slot\)\}"/);
assert.match(v42Source, /<b>Slot \$\{Number\(slot\.slot\)\}<\/b>/);
assert.match(v42Source, /Tồn thực tế phải là số nguyên từ 0 trở lên/);
assert.match(v42Source, /item\.actual < 0/);
assert.match(v42Source, /function exportNccXlsx\(/);
assert.match(v42Source, /function exportHistoryXlsx\(/);
assert.match(v42Source, /function exportCabinXlsx\(/);
assert.match(v42Source, /Tồn trong máy/);
assert.match(v42Source, /Đã lưu \$\{rows\.length\} sản phẩm NCC/);
assert.match(v42Source, /const refreshNccDraft = event => \{/);
assert.match(v42Source, /function scheduleNccDraft\(\)/);
assert.match(v42Source, /setTimeout\(persistNccDraft, 180\)/);
assert.match(v42Source, /savedOn: todayISO\(\)/);
assert.match(v42Source, /function readFreshV42Draft\(key\)/);
assert.match(v42Source, /function refreshOperationDatesForNewDay\(\)/);
assert.match(v42Source, /document\.addEventListener\("visibilitychange"/);
assert.match(v42Source, /#nccForm.*addEventListener\("submit"/);
assert.match(v42Source, /#quickMachine.*addEventListener\("change", renderQuickFill\)/);
assert.match(v42Source, /Lưu \$\{entries\.length\} slot Fill Sản phẩm/);
assert.match(v42Source, /Lưu lô NCC gồm \$\{rows\.length\} sản phẩm/);
assert.match(v42Source, /Lưu kiểm kê \$\{changes\.length\} sản phẩm/);
assert.match(v42Source, /Lưu phiếu chuyển \$\{rows\.length\} sản phẩm/);
assert.doesNotMatch(source.match(/function setupSelectsV4Runtime\(\)[\s\S]*?\n\}/)?.[0] || "", /quickMachine.*addEventListener/);
assert.doesNotMatch(extractLastFunction("setupForms"), /bulkNccRows|resetNccBatch|saveNccBatch/);
assert.doesNotMatch(v42Source, /v42NccStep|nccStepNav|setNccStep|ensureNccStepNav/);
assert.doesNotMatch(stylesSource, /\.quick-fill-list \.slot-card,\.bulk-ncc-row\{display:none\}/);
assert.match(stylesSource, /\.ncc-product-card\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(230px,340px\)/);
assert.match(stylesSource, /\.ncc-product-card \.bulk-box-control\{display:grid;grid-template-columns:minmax\(0,1fr\) 38px/);
assert.match(stylesSource, /@media\(max-width:720px\)[\s\S]*?\.ncc-product-card\{display:grid;grid-template-columns:1fr/);
assert.match(stylesSource, /@media\(max-width:720px\)[\s\S]*?\.quick-fill-footer\{[\s\S]*?position:static/);
assert.match(v42Source, /class="ncc-product-total"/);
assert.match(v42Source, /<div class="bulk-box-control"><input[\s\S]*?<button type="button" class="clear-ncc-row"/);
assert.doesNotMatch(v42Source, /bulk-conversion/);
assert.match(stylesSource, /\.storage-rule-row/);
assert.doesNotMatch(v42Source, /data-add-boxes|data-val=/);
assert.doesNotMatch(v42Source, /productLayout\(/);
const xlsxSource = fs.readFileSync(path.join(root, "modules", "xlsx.js"), "utf8");
assert.match(xlsxSource, /historySortRows/);
assert.match(xlsxSource, /function historySlotSortValue\(slot\)/);
assert.match(xlsxSource, /Chưa có slot/);
assert.match(xlsxSource, /"Máy", "Slot", "Sản phẩm", "Tổng đã fill"/);
assert.match(xlsxSource, /"Tổng nhập NCC"/);
assert.match(xlsxSource, /"Tồn cabin"/);
assert.match(xlsxSource, /"Tổng trong máy"/);
assert.match(xlsxSource, /"Lệch NCC"/);
assert.match(xlsxSource, /N\(F\$\{row\}\)\+N\(G\$\{row\}\)/);
assert.match(xlsxSource, /N\(E\$\{row\}\)-N\(D\$\{row\}\)-N\(H\$\{row\}\)/);
assert.match(xlsxSource, /function historyNccTotalsByProduct\(selectedMachines\)/);
assert.match(xlsxSource, /function historyFillLayoutRows\(selectedMachines\)/);
assert.match(xlsxSource, /layoutRows: fillLayoutRows/);
assert.doesNotMatch(xlsxSource, /"Đã bán"/);
assert.doesNotMatch(xlsxSource, /"Tồn đầu kỳ"/);
assert.doesNotMatch(xlsxSource, /"Tiêu hao tạm tính"/);
assert.match(xlsxSource, /rows: historySummaryRows\(machineRows, \{ nccTotals, layoutRows: machineLayoutRows \}\)/);
assert.match(xlsxSource, /summarySource\(machine, slot, product\)/);
assert.doesNotMatch(xlsxSource, /Doi chieu/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.name, "Quản Lý Nhập Hàng V5.4.13");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
assert.match(serviceWorker, /quan-ly-nhap-hang-v5-4-13/);
runtimeModules.forEach(name => assert.match(serviceWorker, new RegExp(`\\./modules/${name.replace(".", "\\.")}`)));
assert.doesNotMatch(extractLastFunctionFromSource(v42Source, "renderHistoryV4Runtime"), /onclick=/);
assert.doesNotMatch(extractLastFunction("renderAudit"), /onclick=/);

console.log("V5.4.13 smoke tests: PASS");








