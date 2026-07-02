/* Quản Lý Nhập Hàng V4.4.0 - ui.js */
function activateCabinSubview(name) {
  if (name === "transfer" && !hasPermission("stocktake")) return;
  $$("[data-cabin-view]").forEach(button => button.classList.toggle("active", button.dataset.cabinView === name));
  $$("[data-cabin-panel]").forEach(panel => {
    const active = panel.dataset.cabinPanel === name;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  if (name === "transfer") resetTransfer();
}

function applyManagementView() {
  const select = $("#managementSelect");
  if (!select) return;
  const canManage = hasPermission("manage");
  const layoutOption = select.querySelector('option[value="layout"]');
  if (layoutOption) layoutOption.disabled = !canManage;
  let value = select.value || localStorage.getItem(V42_MANAGEMENT) || "account";
  if (value === "layout" && !canManage) value = "account";
  select.value = value;
  localStorage.setItem(V42_MANAGEMENT, value);
  $$(".management-panel").forEach(panel => {
    const adminPanel = panel.id === "memberAdminCard" || panel.id === "machineAdminCard";
    panel.classList.toggle("management-hidden", panel.dataset.managementPanel !== value || (adminPanel && !canManage));
  });
}

function activateView(name) {
  const operationViews = ["quickfill", "ncc", "cabin"];
  if (name === "operations") {
    const saved = localStorage.getItem("qlnh_operation_view_v42") || "quickfill";
    name = saved === "quickfill" && hasPermission("fill") ? saved
      : saved === "ncc" && hasPermission("receive") ? saved
      : "cabin";
  }
  const requestedTab = $(`.tab[data-view="${name}"]`) || $(`[data-operation-view="${name}"]`);
  if (requestedTab?.dataset.authRequired && !(syncUser || syncAccess)) {
    openAuthModal();
    return;
  }
  if (requestedTab?.dataset.permission && !requirePermission(requestedTab.dataset.permission)) return;
  $$(".tab").forEach(tab => {
    const active = operationViews.includes(name) ? tab.classList.contains("operation-menu-tab") : tab.dataset.view === name;
    tab.classList.toggle("active", active);
  });
  $$(".view").forEach(view => view.classList.toggle("active", view.id === name));
  $$(".operation-tab").forEach(tab => {
    const active = tab.dataset.operationView === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  if (operationViews.includes(name)) localStorage.setItem("qlnh_operation_view_v42", name);
  if (name === "audit") renderStocktake();
  if (name === "cabin") renderCabin();
  if (name === "history") renderHistory();
  if (name === "system" && hasPermission("manage")) renderMembers();
  closeDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function addLayoutEditorRow(values = {}) {
  const box = $("#layoutEditorRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "layout-editor-row";
  row.dataset.id = values.id || "";
  row.innerHTML = `
    <input class="layout-slot" type="number" min="1" step="1" value="${Number(values.slot_number || values.slot || 1)}" aria-label="Số slot" />
    <div class="layout-product-combo"><input class="layout-product" type="text" value="${htmlEscape(values.product || "")}" placeholder="Chọn hoặc gõ sản phẩm" autocomplete="off" aria-label="Sản phẩm" /><button type="button" class="product-list-btn" data-product-menu aria-label="Mở danh sách">⌄</button><div class="product-picker-menu" hidden></div></div>
    <input class="layout-capacity" type="number" min="1" step="1" value="${Number(values.capacity || values.max || 24)}" aria-label="Sức chứa" />
    <button type="button" class="remove-row-btn" data-remove-layout-row aria-label="Xóa slot">×</button>`;
  box.appendChild(row);
  updateMachineSlotCount();
}

function showProductMenu(combo) {
  const input = $(".layout-product", combo);
  const menu = $(".product-picker-menu", combo);
  const query = input.value.trim().toLocaleLowerCase("vi");
  const products = allProducts().filter(product => !query || product.toLocaleLowerCase("vi").includes(query)).slice(0, 30);
  menu.innerHTML = products.map(product => `<button type="button" data-product-choice="${htmlEscape(product)}">${htmlEscape(product)}</button>`).join("")
    || `<span>Nhấn Enter để dùng tên mới</span>`;
  menu.hidden = false;
}

function applyPermissions() {
  const authenticated = Boolean(syncUser && syncAccess);
  $$('[data-auth-required]').forEach(element => element.classList.toggle("hidden", !authenticated));
  $$('[data-permission]').forEach(element => element.classList.toggle("hidden", !hasPermission(element.dataset.permission)));
  const restricted = $(".tab.active[data-permission]");
  if (restricted && !hasPermission(restricted.dataset.permission)) activateView("dashboard");
  const authRequired = $(".tab.active[data-auth-required]");
  if (authRequired && !authenticated) activateView("dashboard");
  $("#memberAdminCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#machineAdminCard")?.classList.toggle("hidden", !hasPermission("manage"));
  $("#syncConfigCard")?.classList.toggle("hidden", !(hasPermission("manage") && isSyncAdminMode()));
  if ($("#quickfill")?.classList.contains("active") && !hasPermission("fill")) activateView("cabin");
  if ($("#ncc")?.classList.contains("active") && !hasPermission("receive")) activateView("cabin");
  applyManagementView();
}

function renderAll() {
  cabinSnapshot = null;
  renderRoute(); renderSummary(); renderOrders(); renderSlow(); renderCabin(); renderHistory(); renderAudit(); renderSelectedCabin(); renderSyncStatus();
  if (!$("#quickfill").classList.contains("active") || !$("#quickFillBox .slot-card")) renderQuickFill();
  if (!$("#audit").classList.contains("active") || !$("#stocktakeBox .stocktake-row")) renderStocktake();
  updateTransferPreview();
  applyManagementView();
}
