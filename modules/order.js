/* Quan Ly Nhap Hang V5.2.5 - order logic */
function defaultStorageRules() {
  return [
    { id: stableConfigId("storage-rule", "Aqua"), product: "Aqua", no_wrap: true, pack: 28, shelf_per_pack: 1, max_packs: 3, created_at: "", updated_at: "", _sync: "seeded" },
    { id: stableConfigId("storage-rule", "Sting lon Dâu"), product: "Sting lon Dâu", no_wrap: true, pack: 24, shelf_per_pack: 0.5, max_packs: 2, created_at: "", updated_at: "", _sync: "seeded" }
  ];
}

function activeStorageRules() {
  return (state.productStorageRules || []).filter(rule => !rule.deleted_at);
}

function storageRuleForProduct(product) {
  const name = String(product || "").toLocaleLowerCase("vi");
  return activeStorageRules().find(rule => String(rule.product || "").toLocaleLowerCase("vi") === name) || null;
}

function isAquaProduct(product) {
  const lower = String(product || "").toLowerCase();
  return lower.includes("aqua") || lower.includes("aquafina");
}

function productInfo(product) {
  const rule = storageRuleForProduct(product);
  return config().products?.[product] || { pack: rule?.pack || (isAquaProduct(product) ? 28 : 24), minPacks: 1 };
}

function packText(qty, product) {
  const info = productInfo(product);
  const packs = Math.ceil(Number(qty || 0) / info.pack);
  return { packs, qty: packs * info.pack, unit: unitName(product), packSize: info.pack };
}

function clampOrderByStorageLimit(orderQty, stock, product) {
  if (isAquaProduct(product)) {
    return { qty: orderQty, limited: false, reason: "" };
  }
  const rule = storageRuleForProduct(product);
  if (!rule || !Number.isFinite(Number(rule.max_packs)) || Number(rule.max_packs) <= 0) {
    return { qty: orderQty, limited: false, reason: "" };
  }
  const pack = Number(rule.pack || productInfo(product).pack || 24);
  const currentPacks = Math.max(0, Number(stock || 0)) / pack;
  const remainingPacks = Math.floor(Math.max(0, Number(rule.max_packs) - currentPacks));
  const wantedPacks = Math.ceil(Number(orderQty || 0) / pack);
  const allowedPacks = Math.min(wantedPacks, remainingPacks);
  return {
    qty: Math.max(0, allowedPacks * pack),
    limited: allowedPacks < wantedPacks,
    reason: allowedPacks < wantedPacks ? `Giới hạn tốn chỗ: tối đa ${Number(rule.max_packs)} thùng cabin` : ""
  };
}

function suggestOrder(qty, product) {
  const info = productInfo(product);
  const stock = Number(qty || 0);

  if (isAquaProduct(product)) {
    if (stock >= 56) return 0;
    if (stock >= 28) return info.pack;
    if (stock > 0) return info.pack * 2;
    return info.pack * 3;
  }

  return stock <= 6 ? info.pack : 0;
}

function aquaReservePacksAfterFill() {
  return 1;
}

function suggestedAquaOrderForLayout(stock, product, layout, projected) {
  const pack = productInfo(product).pack;
  const capacity = Number(layout?.capacity || 0);
  if (capacity <= 0) return suggestOrder(projected, product);
  const targetAfterNcc = capacity + (pack * aquaReservePacksAfterFill());
  const shortage = Math.max(0, targetAfterNcc - Math.max(0, Number(projected || stock || 0)));
  return Math.ceil(shortage / pack) * pack;
}

function machineProductLayout(machine, product) {
  const slots = config().slots.filter(slot => slot.machine === machine && slot.product === product);
  return {
    slotCount: slots.length,
    capacity: slots.reduce((sum, slot) => sum + Number(slot.max || 0), 0),
    slots: slots.map(slot => Number(slot.slot)).sort((a, b) => a - b)
  };
}

function suggestedOrderForLayout(stock, product, layout, projected) {
  const pack = productInfo(product).pack;
  if (isAquaProduct(product)) return suggestedAquaOrderForLayout(stock, product, layout, projected);
  if (projected > 6) return 0;
  if (layout.slotCount > 1 && layout.capacity > pack) {
    const shortage = Math.max(pack, layout.capacity - Math.max(0, projected));
    return Math.ceil(shortage / pack) * pack;
  }
  return pack;
}

function buildOrderRows() {
  const rawCabin = currentCabin();
  const keys = new Set(Object.keys(rawCabin));
  config().slots.forEach(slot => keys.add(`${slot.machine}||${slot.product}`));
  const rows = [];
  keys.forEach(key => {
    const [machine, product] = key.split("||");
    const raw = Number(rawCabin[key] || 0);
    if (raw < 0) return;
    const qty = Math.max(0, raw);
    const layout = machineProductLayout(machine, product);
    const expectedDemand = expectedDemandBeforeNextVisit(machine, product);
    const projected = Math.max(0, qty - expectedDemand);
    const suggested = suggestedOrderForLayout(qty, product, layout, projected);
    const storageLimit = clampOrderByStorageLimit(suggested, qty, product);
    const order = storageLimit.qty;
    if (order > 0) rows.push({
      machine, product, qty, raw, order, projected, expectedDemand,
      capacity: layout.capacity, slotCount: layout.slotCount, slots: layout.slots,
      pack: packText(order, product),
      storageLimited: storageLimit.limited,
      storageReason: storageLimit.reason
    });
  });
  return rows.sort((a, b) => a.machine.localeCompare(b.machine, "vi") || a.product.localeCompare(b.product, "vi"));
}





