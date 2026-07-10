const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const runtimeModules = ["runtime-core.js", "fill.js", "ncc.js", "stocktake.js", "transfer.js", "history.js", "ui.js", "bootstrap.js"];
const v42Source = runtimeModules.map(name => fs.readFileSync(path.join(root, "modules", name), "utf8")).join("\n");
const stylesSource = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const functionNames = [...source.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(match => match[1]);
assert.equal(new Set(functionNames).size, functionNames.length, "app.js contains duplicate function declarations");

function extractLastFunction(name) {
  const pattern = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, "gm");
  const matches = [...source.matchAll(pattern)];
  assert.ok(matches.length, `Missing function: ${name}`);
  const start = matches[matches.length - 1].index;
  const nextPattern = /^(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/gm;
  nextPattern.lastIndex = start + 1;
  const next = nextPattern.exec(source);
  return source.slice(start, next ? next.index : source.length);
}

const context = vm.createContext({ console });
[
  "normalizeState",
  "stableConfigId",
  "defaultStorageRules",
  "activeStorageRules",
  "storageRuleForProduct",
  "isAquaProduct",
  "productInfo",
  "clampOrderByStorageLimit",
  "suggestOrder",
  "suggestedOrderForLayout",
  "htmlEscape",
  "csvCell"
].forEach(name => vm.runInContext(extractLastFunction(name), context));

context.config = () => ({ products: {} });
context.state = context.normalizeState({
  productStorageRules: [
    { id: "rule-aqua", product: "Aqua", no_wrap: true, pack: 28, shelf_per_pack: 1, max_packs: 2 },
    { id: "rule-sting-dau", product: "Sting lon Dâu", no_wrap: true, pack: 24, shelf_per_pack: 0.5, max_packs: 2 }
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
function jsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

jsonEqual(context.clampOrderByStorageLimit(84, 0, "Aqua"), { qty: 56, limited: true, reason: "Giới hạn tốn chỗ: tối đa 2 thùng cabin" });
jsonEqual(context.clampOrderByStorageLimit(28, 42, "Aqua"), { qty: 0, limited: true, reason: "Giới hạn tốn chỗ: tối đa 2 thùng cabin" });
jsonEqual(context.clampOrderByStorageLimit(48, 0, "Sting lon Dâu"), { qty: 48, limited: false, reason: "" });
jsonEqual(context.clampOrderByStorageLimit(24, 49, "Sting lon Dâu"), { qty: 0, limited: true, reason: "Giới hạn tốn chỗ: tối đa 2 thùng cabin" });

const normalized = context.normalizeState({ fillLogs: null, nccLogs: {}, adjustLogs: [] });
assert.ok(Array.isArray(normalized.fillLogs));
assert.ok(Array.isArray(normalized.nccLogs));
assert.ok(Array.isArray(normalized.machineConfigs));
assert.ok(Array.isArray(normalized.productStorageRules));

assert.equal(context.htmlEscape(`<b title='x'>&</b>`), "&lt;b title=&#39;x&#39;&gt;&amp;&lt;/b&gt;");
assert.equal(context.csvCell("=2+2"), `"'=2+2"`);
assert.equal(context.csvCell(-5), `"-5"`);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");
assert.match(html, /Quản Lý Nhập Hàng V4\.5\.0/);
assert.match(html, /app\.js\?v=4\.5\.0/);
runtimeModules.forEach(name => assert.match(html, new RegExp(`modules/${name.replace(".", "\\.")}\\?v=4\\.5\\.0`)));
assert.match(html, /id="nccMachine"/);
assert.match(html, /id="storageRuleForm"/);
assert.equal((html.match(/data-operation-view=/g) || []).length, 9);
assert.match(html, /class="tab operation-menu-tab" data-view="operations"/);

assert.match(source, /function clampOrderByStorageLimit\(/);
assert.match(source, /function saveStorageRules\(/);
assert.match(source, /product_storage_rules/);
assert.match(source, /storageLimited/);
assert.doesNotMatch(source, /data-add-boxes|data-val=/);

assert.match(v42Source, /function saveTransfer\(/);
assert.match(v42Source, /function saveStocktakeBatch\(/);
assert.match(v42Source, /V42_HISTORY_PAGE_SIZE = 30/);
assert.match(v42Source, /data-history-page="prev"/);
assert.match(v42Source, /function renderNccProductList\(/);
assert.match(v42Source, /function nccProductsForMachine\(/);
assert.match(v42Source, /function quickFillProductsForMachine\(/);
assert.match(v42Source, /function quickFillProductLayout\(/);
assert.match(v42Source, /unique\(config\(\)\.slots\.filter\(slot => slot\.machine === machine\)\.map\(slot => slot\.product\)\)/);
assert.match(v42Source, /data-product="\$\{htmlEscape\(product\)\}"/);
assert.doesNotMatch(v42Source, /data-slot="\$\{Number\(slot\.slot\)\}"/);
assert.match(v42Source, /Tồn thực tế phải là số nguyên/);
assert.doesNotMatch(v42Source, /item\.actual < 0/);
assert.match(v42Source, /Đã lưu \$\{rows\.length\} sản phẩm NCC/);
assert.match(v42Source, /const refreshNccDraft = event => \{/);
assert.match(v42Source, /function scheduleNccDraft\(\)/);
assert.match(v42Source, /setTimeout\(persistNccDraft, 180\)/);
assert.match(v42Source, /#nccForm.*addEventListener\("submit"/);
assert.match(v42Source, /#quickMachine.*addEventListener\("change", renderQuickFill\)/);
assert.doesNotMatch(source.match(/function setupSelectsV4Runtime\(\)[\s\S]*?\n\}/)?.[0] || "", /quickMachine.*addEventListener/);
assert.doesNotMatch(extractLastFunction("setupForms"), /bulkNccRows|resetNccBatch|saveNccBatch/);
assert.doesNotMatch(v42Source, /v42NccStep|nccStepNav|setNccStep|ensureNccStepNav/);
assert.doesNotMatch(stylesSource, /\.quick-fill-list \.slot-card,\.bulk-ncc-row\{display:none\}/);
assert.match(stylesSource, /\.ncc-product-card\{display:grid;grid-template-columns:minmax\(0,1fr\) 38px/);
assert.match(stylesSource, /\.storage-rule-row/);
assert.doesNotMatch(v42Source, /data-add-boxes|data-val=/);
assert.doesNotMatch(v42Source, /productLayout\(/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.name, "Quản Lý Nhập Hàng V4.5.0");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
assert.match(serviceWorker, /quan-ly-nhap-hang-v4-5-0/);
runtimeModules.forEach(name => assert.match(serviceWorker, new RegExp(`\\./modules/${name.replace(".", "\\.")}`)));
assert.doesNotMatch(extractLastFunction("renderHistoryV4Runtime"), /onclick=/);
assert.doesNotMatch(extractLastFunction("renderAudit"), /onclick=/);

console.log("V4.5.0 smoke tests: PASS");
