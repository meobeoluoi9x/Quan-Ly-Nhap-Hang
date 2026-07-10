/* Quản Lý Nhập Hàng V4.5.0 - bootstrap.js */
function setupV42() {
  if ($(".app-header p")) $(".app-header p").textContent = "V4.5.0 - Hàng tốn chỗ";
  $("#quickDate")?.addEventListener("change", persistQuickDraft);
  $("#quickMachine")?.addEventListener("change", renderQuickFill);
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
  $("#historyList")?.addEventListener("click", event => {
    const button = event.target.closest("[data-history-page]");
    if (!button || button.disabled) return;
    v42HistoryPage += button.dataset.historyPage === "next" ? 1 : -1;
    renderHistoryV4Runtime();
    $("#historyList")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
}

setupV42();

