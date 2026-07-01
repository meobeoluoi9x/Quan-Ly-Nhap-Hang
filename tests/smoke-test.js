const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const path = require("node:path");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const v42Source = fs.readFileSync(path.join(root, "v42.js"), "utf8");

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
  "isAquaProduct",
  "productInfo",
  "suggestOrder",
  "suggestedOrderForLayout",
  "htmlEscape",
  "csvCell"
].forEach(name => vm.runInContext(extractLastFunction(name), context));

context.config = () => ({ products: {} });

assert.equal(context.suggestOrder(56, "Aqua"), 0);
assert.equal(context.suggestOrder(28, "Aqua"), 28);
assert.equal(context.suggestOrder(1, "Aqua"), 56);
assert.equal(context.suggestOrder(0, "Aqua"), 84);

const twoSlots = { slotCount: 2, capacity: 40 };
assert.equal(context.suggestedOrderForLayout(16, "Pepsi chanh", twoSlots, 16), 24);
assert.equal(context.suggestedOrderForLayout(17, "Pepsi chanh", twoSlots, 17), 0);

const normalized = context.normalizeState({ fillLogs: null, nccLogs: {}, adjustLogs: [] });
assert.ok(Array.isArray(normalized.fillLogs));
assert.ok(Array.isArray(normalized.nccLogs));
assert.ok(Array.isArray(normalized.machineConfigs));

assert.equal(context.htmlEscape(`<b title='x'>&</b>`), "&lt;b title=&#39;x&#39;&gt;&amp;&lt;/b&gt;");
assert.equal(context.csvCell("=2+2"), `"'=2+2"`);
assert.equal(context.csvCell(-5), `"-5"`);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");
assert.match(html, /Quản Lý Nhập Hàng V4\.2\.6/);
assert.match(html, /app\.js\?v=4\.2\.6/);
assert.match(html, /v42\.js\?v=4\.2\.6/);
assert.match(html, /id="nccMachine"/);
assert.equal((html.match(/data-operation-view=/g) || []).length, 9);
assert.match(html, /class="tab operation-menu-tab" data-view="operations"/);
assert.match(v42Source, /function saveTransfer\(/);
assert.match(v42Source, /function saveStocktakeBatch\(/);
assert.match(v42Source, /V42_HISTORY_PAGE_SIZE = 30/);
assert.match(v42Source, /data-history-page="prev"/);
assert.match(v42Source, /function renderNccProductList\(/);
assert.match(v42Source, /function nccProductsForMachine\(/);
assert.match(v42Source, /unique\(config\(\)\.slots\.filter\(slot => slot\.machine === machine\)\.map\(slot => slot\.product\)\)/);
assert.match(v42Source, /Đã lưu \$\{rows\.length\} sản phẩm NCC/);
assert.match(v42Source, /const refreshNccDraft = event => \{/);
assert.match(v42Source, /updateNccBatchPreview\(\);\s+persistNccDraft\(\);/);
assert.doesNotMatch(v42Source, /data-add-boxes|data-val=/);

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.name, "Quản Lý Nhập Hàng V4.2.6");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
assert.match(serviceWorker, /quan-ly-nhap-hang-v4-2-6/);
assert.match(serviceWorker, /\.\/v42\.js/);
assert.doesNotMatch(extractLastFunction("renderHistoryV4Runtime"), /onclick=/);
assert.doesNotMatch(extractLastFunction("renderAudit"), /onclick=/);

console.log("V4.2.6 smoke tests: PASS");
