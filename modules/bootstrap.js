/* Quản Lý Nhập Hàng V5.4.13 - bootstrap.js */
function bootApp() {
  applyDisplaySettings();
  ensureSyncView();
  setupTabs();
  setupForms();
  setupSyncForms();
  setupQuickPads();
  window.FILL_BASE_CONFIG ||= window.FILL_CONFIG;
  seedMachineConfig();
  seedProductStorageRules();
  refreshOperationalSelects();

  $("#quickDate")?.addEventListener("change", persistQuickDraft);
  $("#quickMachine")?.addEventListener("change", renderQuickFill);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshOperationDatesForNewDay();
  });
  window.addEventListener("focus", refreshOperationDatesForNewDay);
  $$(".operation-tab").forEach(button => button.addEventListener("click", () => activateView(button.dataset.operationView)));

  $("#nccForm")?.addEventListener("submit", event => {
    event.preventDefault();
    saveNccBatch(event.currentTarget);
  });
  const refreshNccDraft = event => {
    if (!event.target.matches(".bulk-boxes")) return;
    updateNccBatchPreview();
    scheduleNccDraft();
  };
  $("#bulkNccRows")?.addEventListener("input", refreshNccDraft);
  $("#bulkNccRows")?.addEventListener("change", event => {
    if (!event.target.matches(".bulk-boxes")) return;
    updateNccBatchPreview();
    flushNccDraft();
  });
  $("#nccMachine")?.addEventListener("change", () => {
    flushNccDraft();
    renderNccProductList();
  });
  $("#bulkNccRows")?.addEventListener("keydown", event => {
    if (!event.target.matches(".bulk-boxes") || event.key !== "Tab") return;
    if (event.repeat) return;
    event.preventDefault();
    const inputs = $$(".bulk-boxes", $("#bulkNccRows"));
    const index = inputs.indexOf(event.target);
    const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
    if (next) next.focus();
    else (event.shiftKey ? $("#nccMachine") : $("#saveNccBatchBtn"))?.focus();
  });
  $("#resetNccBatchBtn")?.addEventListener("click", () => resetNccBatch(true));
  $("#bulkNccRows")?.addEventListener("click", event => {
    const clear = event.target.closest("[data-clear-ncc]");
    if (!clear) return;
    const card = clear.closest(".ncc-product-card");
    $(".bulk-boxes", card).value = "";
    updateNccBatchPreview();
    flushNccDraft();
  });

  $("#stocktakeBox")?.addEventListener("input", updateStocktakePreview);
  $("#exportCabinXlsxBtn")?.addEventListener("click", exportCabinXlsx);
  $("#exportHistoryXlsxBtn")?.addEventListener("click", exportHistoryXlsx);
  $("#selectAllHistoryMachines")?.addEventListener("click", () => {
    const inputs = $$("#historyExportMachines input");
    const check = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = check; });
  });
  $("#displaySettingsForm")?.addEventListener("submit", event => {
    event.preventDefault();
    if (!requirePermission("manage")) return;
    const values = new FormData(event.currentTarget);
    saveDisplaySettings({
      title: String(values.get("title") || "").trim() || "Quản Lý Nhập Hàng",
      version: String(values.get("version") || "").trim() || `V${APP_VERSION}`,
      note: String(values.get("note") || "").trim()
    });
    showToast("Đã lưu hiển thị app.");
  });
  $("#historyList")?.addEventListener("click", event => {
    const button = event.target.closest("[data-history-page]");
    if (button && !button.disabled) {
      v42HistoryPage += button.dataset.historyPage === "next" ? 1 : -1;
      renderHistoryV4Runtime();
      $("#historyList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const action = event.target.closest("[data-history-action]");
    if (!action) return;
    if (action.dataset.historyAction === "delete-transfer") return deleteTransferBatch(action.dataset.historyId);
    const handlers = {
      "edit-fill": editFill, "delete-fill": deleteFill,
      "edit-ncc": editNcc, "delete-ncc": deleteNcc,
      "delete-adjust": deleteAdjust
    };
    handlers[`${action.dataset.historyAction}-${action.dataset.historyType}`]?.(action.dataset.historyId);
  });
  $$("[data-cabin-view]").forEach(button => button.addEventListener("click", () => activateCabinSubview(button.dataset.cabinView)));
  $("#addTransferRowBtn")?.addEventListener("click", () => addTransferRow());
  $("#resetTransferBtn")?.addEventListener("click", resetTransfer);
  $("#saveTransferBtn")?.addEventListener("click", saveTransfer);
  $("#transferFromMachine")?.addEventListener("change", () => { refreshTransferProducts(); updateTransferPreview(); });
  $("#transferToMachine")?.addEventListener("change", updateTransferPreview);
  $("#transferRows")?.addEventListener("input", updateTransferPreview);
  $("#transferRows")?.addEventListener("change", updateTransferPreview);
  $("#transferRows")?.addEventListener("click", event => {
    const remove = event.target.closest("[data-remove-transfer-row]");
    if (!remove) return;
    remove.closest(".transfer-row").remove();
    if (!$(".transfer-row", $("#transferRows"))) addTransferRow();
    updateTransferPreview();
  });

  $("#managementSelect")?.addEventListener("change", applyManagementView);
  $("#layoutEditorRows")?.addEventListener("focusin", event => {
    if (event.target.matches(".layout-product")) showProductMenu(event.target.closest(".layout-product-combo"));
  });
  $("#layoutEditorRows")?.addEventListener("input", event => {
    if (event.target.matches(".layout-product")) showProductMenu(event.target.closest(".layout-product-combo"));
  });
  $("#layoutEditorRows")?.addEventListener("keydown", event => {
    if (!event.target.matches(".layout-product")) return;
    const combo = event.target.closest(".layout-product-combo");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      showProductMenu(combo);
      const choices = $$("[data-product-choice]", combo);
      if (choices.length) choices[0].focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      $(".product-picker-menu", combo).hidden = true;
      machineEditorDirty = true;
    } else if (event.key === "Escape") {
      $(".product-picker-menu", combo).hidden = true;
    }
  });
  $("#layoutEditorRows")?.addEventListener("click", event => {
    const toggle = event.target.closest("[data-product-menu]");
    if (toggle) {
      const combo = toggle.closest(".layout-product-combo");
      showProductMenu(combo);
      $(".layout-product", combo).focus();
      return;
    }
    const choice = event.target.closest("[data-product-choice]");
    if (choice) {
      const combo = choice.closest(".layout-product-combo");
      $(".layout-product", combo).value = choice.dataset.productChoice;
      $(".product-picker-menu", combo).hidden = true;
      machineEditorDirty = true;
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".layout-product-combo")) $$(".product-picker-menu").forEach(menu => { menu.hidden = true; });
  });

  resetNccBatch();
  resetTransfer();
  renderQuickFill();
  renderStocktake();
  renderHistoryV4Runtime();
  renderMachineManager(true);
  renderStorageRuleManager();
  applyManagementView();
  renderAll();
  initSyncClient().then(() => queueAutoSync()).catch(() => renderSyncStatus());
}

bootApp();






