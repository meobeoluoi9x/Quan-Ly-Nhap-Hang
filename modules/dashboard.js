/* Quản Lý Nhập Hàng V5.2.5 - dashboard.js */
function renderRoute() {
  $("#todayText").textContent = viDate();

  const machines = config().machines.map(machine => machine.name);
  if (!activeDashboardMachine || !machines.includes(activeDashboardMachine)) {
    activeDashboardMachine = machines[0] || null;
  }

  $("#routeBadge").textContent = activeDashboardMachine || "Theo máy";
  $("#routeMachines").innerHTML = machines.map(machine => {
    const health = machineHealth(machine);
    return `<button class="machine-dashboard-tab ${machine === activeDashboardMachine ? "active" : ""} ${health.cls}" data-machine="${htmlEscape(machine)}">
      <span>${htmlEscape(machine)}</span>
      <small>${health.label}</small>
    </button>`;
  }).join("");

  $$(".machine-dashboard-tab").forEach(button => {
    button.addEventListener("click", () => {
      activeDashboardMachine = button.dataset.machine;
      activeOrderMachine = activeDashboardMachine;
      localStorage.setItem("fill_assistant_active_machine", activeDashboardMachine);
      renderAll();
    });
  });
}

function renderCabin() {
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const machines = unique([
    ...config().machines.map(machine => machine.name),
    ...Object.keys(cab).map(key => key.split("||")[0])
  ]).sort((a, b) => a.localeCompare(b, "vi"));
  if (!machines.includes(activeCabinMachine)) activeCabinMachine = machines[0] || "";
  if ($("#cabinMachine")) {
    $("#cabinMachine").innerHTML = machines.map(machine => `<option value="${htmlEscape(machine)}">${htmlEscape(machine)}</option>`).join("");
    $("#cabinMachine").value = activeCabinMachine;
  }
  const rows = Object.entries(cab).map(([key, qty]) => {
    const [machine, product] = key.split("||");
    const raw = Number(rawCabin[key] || 0);
    const pack = productInfo(product).pack;
    const status = raw < 0 ? `Lệch ${Math.abs(raw)}` : qty < 12 ? "Sắp hết" : qty < pack ? "Tồn thấp" : "Ổn";
    const cls = raw < 0 || qty < 12 ? "red" : qty < pack ? "yellow" : "green";
    return { machine, product, qty: Number(qty || 0), pack, raw, status, cls };
  }).filter(item => item.machine === activeCabinMachine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));
  const total = rows.reduce((sum, item) => sum + item.qty, 0);
  const attention = rows.filter(item => item.cls !== "green").length;
  $("#cabinSummary").innerHTML = `<div><span>Sản phẩm</span><b>${rows.length}</b></div><div><span>Tổng tồn</span><b>${total}</b></div><div><span>Cần chú ý</span><b>${attention}</b></div>`;
  $("#cabinBox").innerHTML = rows.map(item => {
    const warn = item.raw < 0
      ? `<span class="small warn-text">Lệch ${Math.abs(item.raw)} sản phẩm</span>`
      : item.status === "Sắp hết"
        ? `<span class="cabin-status cabin-status-red">Sắp hết</span>`
        : item.status === "Tồn thấp"
          ? `<span class="cabin-status cabin-status-amber">Tồn thấp</span>`
          : `<span class="cabin-status cabin-status-blue">${htmlEscape(item.status)}</span>`;
    return `<div class="row qty-row ${item.cls}"><span><b>${htmlEscape(item.product)}</b>${warn}</span><b class="qty-num">${item.qty}</b></div>`;
  }).join("") || `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}

function exportCabinCsv() {
  const machine = activeCabinMachine;
  const cab = displayCabin();
  const rawCabin = currentCabin();
  const rows = Object.entries(cab).map(([key, qty]) => {
    const [rowMachine, product] = key.split("||");
    if (rowMachine !== machine) return null;
    const raw = Number(rawCabin[key] || 0);
    const pack = productInfo(product).pack;
    const status = raw < 0 ? `Lệch ${Math.abs(raw)} sản phẩm` : qty < 12 ? "Sắp hết" : qty < pack ? "Tồn thấp" : "Ổn";
    return [machine, product, Number(qty || 0), status, pack];
  }).filter(Boolean).sort((a, b) => a[1].localeCompare(b[1], "vi"));
  if (!rows.length) return showToast("Máy này chưa có tồn cabin để xuất.");
  const csvRows = [
    ["Tồn cabin - Quản Lý Nhập Hàng"],
    [`Máy: ${machine}`],
    [`Xuất lúc: ${new Date().toLocaleString("vi-VN")}`],
    [],
    ["Máy", "Sản phẩm", "Tồn hiện tại", "Trạng thái", "Sản phẩm/thùng"],
    ...rows,
    [],
    ["TỔNG", "", rows.reduce((sum, row) => sum + Number(row[2] || 0), 0), "", ""]
  ];
  const csv = "\ufeff" + csvRows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `ton-cabin-${machine.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`Đã xuất tồn cabin ${machine}.`);
}

function quickFixNegative(machine, product, qty) {
  if (!confirm(`Tạo điều chỉnh +${qty} cho ${machine} - ${product}?`)) return;

  const item = { id: makeId(), date: todayISO(), machine, product, qty: Number(qty), reason: "Sửa cabin âm" };
  state.adjustLogs.push(item);
  lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
  saveState();
  showToast("Đã tạo điều chỉnh.", true);
}

function renderDashboardCabinAudit() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#dashboardCabinAuditBox");
  if (!box) return;

  box.innerHTML = items.length ? `
    <div class="cabin-audit-list">
      ${items.map(item => `
        <div class="cabin-audit-row" data-machine="${item.machine}" data-product="${item.product}" data-current="${item.qty}">
          <div>
            <b>${item.product}</b>
            <span>Hiện tại: ${item.qty} ${unitName(item.product)}</span>
          </div>
          <input type="number" min="0" step="1" inputmode="numeric" value="${item.qty}" />
          <button class="mini save-audit">Lưu</button>
        </div>
      `).join("")}
    </div>
  ` : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;

  $$(".save-audit", box).forEach(button => {
    button.addEventListener("click", () => {
      const row = button.closest(".cabin-audit-row");
      const machine = row.dataset.machine;
      const product = row.dataset.product;
      const current = Number(row.dataset.current || 0);
      const actual = Number($("input", row).value || 0);
      const diff = actual - current;

      if (diff === 0) {
        showToast(`${product}: không có chênh lệch.`);
        return;
      }

      const item = {
        id: makeId(),
        date: todayISO(),
        machine,
        product,
        qty: diff,
        reason: "Kiểm kê"
      };

      state.adjustLogs.push(item);
      lastAction = { type: "deleteAdjust", index: state.adjustLogs.length - 1, item };
      saveState();
      $("#dashboardCabinAuditCard").classList.remove("hidden");
      showToast(`Đã điều chỉnh ${product}: ${diff > 0 ? "+" : ""}${diff}.`, true);
    });
  });
}

function machineHealth(machine) {
  const rows = buildOrderRows().filter(row => row.machine === machine);
  const hasNegative = negativeCabinItems().some(item => item.machine === machine);

  if (hasNegative) return { cls: "red", label: "Lỗi" };
  if (rows.some(row => row.pack.packs >= 3)) return { cls: "red", label: "Thiếu nặng" };
  if (rows.length > 0) return { cls: "yellow", label: "Cần đặt" };
  return { cls: "green", label: "Ổn" };
}

function renderSlow() {
  const machine = activeDashboardMachine;
  const pairs = unique(config().slots
    .filter(slot => slot.machine === machine)
    .map(slot => `${slot.machine}||${slot.product}`));

  const rows = pairs.map(key => {
    const [machineName, product] = key.split("||");
    const total30 = getRecentFill(product, machineName, 30);
    const count = state.fillLogs.filter(log => log.machine === machineName && log.product === product).length;

    let cls = "blue";
    let status = `Đang học (${count}/5 lần fill)`;
    if (count >= 5 && total30 <= 5) {
      cls = "yellow";
      status = "Bán chậm 30 ngày";
    }
    if (count >= 5 && total30 > 30) {
      cls = "green";
      status = "Bán tốt";
    }
    return { product, total30, count, cls, status };
  });

  $("#slowBox").innerHTML = rows.slice(0, 12).map(item => `
    <div class="compact-info-row ${item.cls}">
      <b>${htmlEscape(item.product)}</b>
      <span>${htmlEscape(item.status)} · Fill 30 ngày: ${item.total30}</span>
    </div>
  `).join("") || `<p class="muted">Máy này chưa có dữ liệu slot.</p>`;
}

function renderSelectedCabin() {
  const machine = activeDashboardMachine;
  const cab = displayCabin();
  const items = Object.entries(cab)
    .map(([key, qty]) => {
      const [m, product] = key.split("||");
      return { machine: m, product, qty, raw: currentCabin()[key] || 0 };
    })
    .filter(item => item.machine === machine)
    .sort((a, b) => a.product.localeCompare(b.product, "vi"));

  const box = $("#selectedCabinBox");
  if (!box) return;

  box.innerHTML = items.length ? items.map(item => {
    const cls = item.raw < 0 ? "red" : item.qty < 12 ? "red" : item.qty < productInfo(item.product).pack ? "yellow" : "green";
    const warn = item.raw < 0 ? ` · Lệch ${Math.abs(item.raw)} ${unitName(item.product)}` : "";
    return `<div class="compact-info-row ${cls}"><b>${htmlEscape(item.product)}</b><span>${item.qty} ${unitName(item.product)}${htmlEscape(warn)}</span></div>`;
  }).join("") : `<p class="muted">Máy này chưa có dữ liệu cabin.</p>`;
}





