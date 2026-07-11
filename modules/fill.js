/* Quản Lý Nhập Hàng V5.2.4 - fill.js */
function quickFillSlotsForMachine(machine) {
  return config().slots.filter(slot => slot.machine === machine)
    .sort((a, b) => Number(a.slot) - Number(b.slot));
}

function persistQuickDraft() {
  const cards = $$(".slot-card", $("#quickFillBox"));
  if (!cards.length) return;
  const values = {};
  cards.forEach(card => { values[card.dataset.slot] = $("input", card)?.value || ""; });
  localStorage.setItem(V42_FILL_DRAFT, JSON.stringify({
    machine: cards[0].dataset.machine,
    date: $("#quickDate")?.value || todayISO(),
    values,
    step: v42FillStep
  }));
}

function setQuickStep(index, focus = false) {
  const cards = $$(".slot-card", $("#quickFillBox"));
  if (!cards.length) return;
  v42FillStep = Math.max(0, Math.min(index, cards.length - 1));
  cards.forEach((card, i) => card.classList.toggle("mobile-active", i === v42FillStep));
  if ($("#quickStepLabel")) $("#quickStepLabel").textContent = `${v42FillStep + 1}/${cards.length}`;
  if ($("#quickPrevBtn")) $("#quickPrevBtn").disabled = v42FillStep === 0;
  if ($("#quickNextBtn")) $("#quickNextBtn").textContent = v42FillStep === cards.length - 1 ? "Xong" : "Tiếp";
  if (focus) $("input", cards[v42FillStep])?.focus();
  persistQuickDraft();
}

function renderQuickFill() {
  persistQuickDraft();
  const machine = $("#quickMachine")?.value;
  const box = $("#quickFillBox");
  if (!box) return;
  const slots = quickFillSlotsForMachine(machine);
  if (!slots.length) {
    box.innerHTML = `<p class="muted">Máy này chưa có slot.</p>`;
    return;
  }
  const draft = readV42Draft(V42_FILL_DRAFT);
  const values = draft?.machine === machine ? draft.values || {} : {};
  if (draft?.machine === machine && draft.date) $("#quickDate").value = draft.date;
  v42FillStep = draft?.machine === machine ? Number(draft.step || 0) : 0;
  box.innerHTML = `
    <div class="quick-fill-list">${slots.map((slot, index) => {
      const cabinQty = getCabinQty(machine, slot.product);
      return `
      <div class="slot-card" data-machine="${htmlEscape(slot.machine)}" data-slot="${Number(slot.slot)}" data-product="${htmlEscape(slot.product)}">
        <div class="quick-slot-info"><b>Slot ${Number(slot.slot)}</b><span>${htmlEscape(slot.product)}${slot.max ? ` · Max ${Number(slot.max)}` : ""}</span><em>Tồn cabin: ${cabinQty} sản phẩm</em></div>
        <div class="slot-controls compact embedded">
          <input class="quick-fill-qty" type="number" min="0" step="1" inputmode="numeric" placeholder="Số sản phẩm" value="${htmlEscape(values[slot.slot] || "")}" data-step="${index}" />
          <button type="button" class="clear-slot" data-clear tabindex="-1" aria-label="Xóa số lượng">×</button>
        </div>
      </div>`;
    }).join("")}</div>
    <div class="mobile-step-nav"><button type="button" id="quickPrevBtn" class="btn ghost">Trước</button><b id="quickStepLabel"></b><button type="button" id="quickNextBtn" class="btn primary">Tiếp</button></div>
    <div class="quick-fill-footer"><div><b id="quickFillPending">0 slot</b><span>chờ lưu</span></div><div class="quick-fill-footer-actions"><button type="button" id="clearQuickFillBtn" class="btn ghost">Xóa hết</button><button type="button" id="saveQuickFillBtn" class="btn primary">Lưu Fill Sản phẩm</button></div></div>`;

  box.oninput = event => {
    if (event.target.matches(".quick-fill-qty")) { updateQuickFillPending(); persistQuickDraft(); }
  };
  box.onkeydown = event => {
    if (!event.target.matches(".quick-fill-qty") || event.key !== "Tab") return;
    event.preventDefault();
    const inputs = $$(".quick-fill-qty", box);
    const index = inputs.indexOf(event.target);
    const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
    if (next) next.focus();
    else (event.shiftKey ? $("#quickMachine") : $("#saveQuickFillBtn"))?.focus();
  };
  box.onclick = event => {
    const button = event.target.closest("button");
    if (!button) return;
    const card = button.closest(".slot-card");
    if (card && button.hasAttribute("data-clear")) {
      $("input", card).value = "";
      updateQuickFillPending(); persistQuickDraft();
    } else if (button.id === "quickPrevBtn") setQuickStep(v42FillStep - 1, true);
    else if (button.id === "quickNextBtn") {
      const count = $$(".slot-card", box).length;
      if (v42FillStep < count - 1) setQuickStep(v42FillStep + 1, true);
      else $("#saveQuickFillBtn")?.focus();
    } else if (button.id === "clearQuickFillBtn") {
      $$(".quick-fill-qty", box).forEach(input => { input.value = ""; });
      updateQuickFillPending(); persistQuickDraft();
    } else if (button.id === "saveQuickFillBtn") saveQuickFillBatch();
  };
  setQuickStep(v42FillStep);
  updateQuickFillPending();
}

function getQuickFillEntries() {
  return $$(".slot-card", $("#quickFillBox"))
    .map(card => ({
      card,
      machine: card.dataset.machine,
      slot: Number(card.dataset.slot),
      product: card.dataset.product,
      qty: Number($("input", card).value || 0)
    }))
    .filter(item => item.qty > 0);
}

function updateQuickFillPending() {
  const pending = getQuickFillEntries();
  const total = pending.reduce((sum, item) => sum + item.qty, 0);
  const label = $("#quickFillPending");
  if (label) label.textContent = `${pending.length} slot · ${total} sản phẩm`;
}

function saveQuickFillBatch() {
  if (!requirePermission("fill")) return;
  const inputs = $$(".quick-fill-qty", $("#quickFillBox"));
  if (inputs.some(input => input.value.trim() && (!Number.isInteger(Number(input.value)) || Number(input.value) < 0))) {
    return showToast("Số lượng phải là số nguyên từ 0 trở lên.");
  }
  const entries = getQuickFillEntries();
  if (!entries.length) return showToast("Chưa nhập số lượng Fill Sản phẩm.");
  if (entries.some(item => item.qty > 50) && !confirm("Có slot trên 50 sản phẩm. Vẫn lưu?")) return;
  const date = $("#quickDate").value || todayISO();
  const recordedAt = new Date().toISOString();
  entries.forEach(item => state.fillLogs.push(touchRecord({
    id: makeId(), date, machine: item.machine, slot: item.slot,
    product: item.product, qty: item.qty, recorded_at: recordedAt
  })));
  localStorage.removeItem(V42_FILL_DRAFT);
  saveState();
  renderQuickFill();
  showToast(`Đã lưu ${entries.length} slot Fill Sản phẩm.`);
}





