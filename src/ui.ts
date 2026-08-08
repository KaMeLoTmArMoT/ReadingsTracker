import {
  drawChart,
  exportLineChart,
  highlightSupplierPeriod,
} from "./charts";
import { getEffectiveEntries, getSupplierSummaries } from "./calculations";
import {
  addCategory,
  addEntry,
  currentUser,
  datasets,
  deleteCategory,
  deleteEntry,
  handleGoogleSignIn,
  handleSignOut,
  importCSVEntries,
  manualReSync,
  moveEntry,
  persistState,
  syncState,
  toggleCollapse,
  updateEntry,
} from "./state";
import type { ReadingEntry } from "./types";

export function renderAuthUI(): void {
  const badge = document.getElementById("authBadge");
  const label = document.getElementById("userLabel");
  const btn = document.getElementById("authBtn");
  const syncBtn = document.getElementById("syncBtn");
  const syncText = document.getElementById("syncStatusText");

  if (!badge || !btn || !label) return;

  if (syncBtn && syncText) {
    const syncIcon = syncBtn.querySelector(".sync-icon");
    if (currentUser) {
      syncBtn.style.display = "inline-flex";
      syncBtn.onclick = () => manualReSync();
      if (syncState === "syncing") {
        syncText.textContent = "Syncing...";
        syncIcon?.classList.add("spin");
        syncBtn.className = "btn-sync syncing";
      } else if (syncState === "error") {
        syncText.textContent = "Sync Error (Retry)";
        syncIcon?.classList.remove("spin");
        syncBtn.className = "btn-sync error";
      } else {
        syncText.textContent = "Synced";
        syncIcon?.classList.remove("spin");
        syncBtn.className = "btn-sync synced";
      }
    } else {
      syncBtn.style.display = "none";
    }
  }

  if (currentUser) {
    badge.textContent = "Cloud Sync Active";
    badge.className = "auth-badge cloud";
    label.textContent = currentUser.email || "Logged in";
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
      Sign Out
    `;
    btn.onclick = () => handleSignOut();
  } else {
    badge.textContent = "Guest Mode";
    badge.className = "auth-badge guest";
    label.textContent = "Offline / LocalStorage";
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"/>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
        <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 10.8 0 12s.7 2.3 1.9 4.7l3.7-2.9z"/>
        <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"/>
      </svg>
      Sign in with Google
    `;
    btn.onclick = () => handleGoogleSignIn();
  }
}

export function exportCSV(i: number): void {
  const ds = datasets[i];
  if (!ds) return;

  const rows = [
    ["category", "date", "value", "supplier"],
    ...ds.entries.map((e) => [ds.name, e.date, e.value, e.supplier || ""]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ds.name}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function parseCSVText(text: string): ReadingEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headerParts = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const dateColIdx = headerParts.indexOf("date");
  const valColIdx = headerParts.indexOf("value");
  const supplierColIdx = headerParts.indexOf("supplier");

  let dateIdx = dateColIdx !== -1 ? dateColIdx : 1;
  let valueIdx = valColIdx !== -1 ? valColIdx : 2;
  let supplierIdx = supplierColIdx !== -1 ? supplierColIdx : 3;

  const hasHeader =
    dateColIdx !== -1 || valColIdx !== -1 || headerParts.includes("category");

  if (!hasHeader) {
    const sampleCols = lines[0].split(",");
    if (sampleCols.length >= 2) {
      dateIdx = 0;
      valueIdx = 1;
      supplierIdx = 2;
    }
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      const d = parts[dateIdx] || (parts.length >= 2 ? parts[0] : "");
      const rawVal = parts[valueIdx] || (parts.length >= 2 ? parts[1] : "");
      const supplier = parts[supplierIdx] || "";
      const v = Number(rawVal.replace(",", "."));
      const entry: ReadingEntry = { date: d, value: v };
      if (supplier) entry.supplier = supplier;
      return entry;
    })
    .filter((r) => r.date && Number.isFinite(r.value));
}

export function importCSV(event: Event, i: number): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result as string;
    if (!text) return;

    const parsedEntries = parseCSVText(text);
    if (parsedEntries.length > 0) {
      importCSVEntries(i, parsedEntries);
    }
    input.value = "";
  };
  reader.readAsText(file);
}

export function renderStatsChips(i: number): string {
  const ds = datasets[i];
  if (!ds || !ds.entries.length) return "";

  const sorted = [...ds.entries]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!sorted.length) return "";

  const yearGroups: Record<string, ReadingEntry[]> = {};
  for (const e of sorted) {
    const year = String(e.date).slice(0, 4);
    if (!yearGroups[year]) yearGroups[year] = [];
    yearGroups[year].push(e);
  }

  const years = Object.keys(yearGroups).sort();
  const yearBaselines: Record<string, number> = {};

  for (const [idx, year] of years.entries()) {
    if (idx === 0) {
      yearBaselines[year] = yearGroups[year][0].value;
    } else {
      const prevYear = years[idx - 1];
      const prevEntries = yearGroups[prevYear];
      const lastPrev = prevEntries[prevEntries.length - 1];
      const firstCurr = yearGroups[year][0];

      const d1 = new Date(lastPrev.date).getTime();
      const d2 = new Date(firstCurr.date).getTime();
      const jan1 = new Date(`${year}-01-01`).getTime();

      const totalDays = (d2 - d1) / 86400000;
      const daysToJan = (jan1 - d1) / 86400000;

      if (totalDays > 0 && daysToJan >= 0) {
        const rate = (firstCurr.value - lastPrev.value) / totalDays;
        yearBaselines[year] = lastPrev.value + rate * daysToJan;
      } else {
        yearBaselines[year] = firstCurr.value;
      }
    }
  }

  let chipsHTML = '<div class="stats-chips-container">';

  for (const year of years) {
    const list = yearGroups[year];
    const lastVal = list[list.length - 1].value;
    const growth = lastVal - yearBaselines[year];
    chipsHTML += `
      <span class="stat-chip">
        <span class="stat-chip-label">${year}:</span>
        <span class="stat-chip-value">${Math.round(growth)}</span>
      </span>
    `;
  }

  const totalGrowth = sorted[sorted.length - 1].value - sorted[0].value;
  chipsHTML += `
    <span class="stat-chip total">
      <span class="stat-chip-label">Total Growth:</span>
      <span class="stat-chip-value">${Math.round(totalGrowth)}</span>
    </span>
  `;

  const cmp = ds._comparisons;
  if (cmp?.items?.length) {
    const matchedYears = cmp.items
      .map((x) => `${x.year}: ${x.mmdd}`)
      .join(" · ");
    chipsHTML += `
      <span class="stat-chip match">
        <span class="stat-chip-label">Same level (${cmp.currentDate}):</span>
        <span class="stat-chip-value">${matchedYears}</span>
      </span>
    `;
  }

  chipsHTML += "</div>";
  return chipsHTML;
}

export function renderDatasets(shouldPersist = true): void {
  const host = document.getElementById("datasets");
  if (!host) return;

  const currentScrollY = window.scrollY;
  host.innerHTML = "";

  for (const [i, ds] of datasets.entries()) {
    const card = document.createElement("div");
    card.className = "dataset-card";

    const hasData = ds.entries.length > 0;
    const statsChips = renderStatsChips(i);
    const effectiveEntries = getEffectiveEntries(ds.entries);
    const supplierSummaries = getSupplierSummaries(ds.entries);

    let supplierPillsHTML = "";
    if (hasData && supplierSummaries.length > 0) {
      supplierPillsHTML = `
        <div class="supplier-pills-bar">
          <span class="supplier-pills-label">Suppliers:</span>
          ${supplierSummaries
            .map(
              (s) => `
            <div class="supplier-pill" data-i="${i}" data-supplier="${s.supplier}" style="--pill-color: ${s.color};">
              <span class="supplier-pill-dot" style="background-color: ${s.color};"></span>
              <span class="supplier-pill-name">${s.supplier}</span>
              <span class="supplier-pill-stats">(${Math.round(s.totalConsumption)} units)</span>
            </div>
          `,
            )
            .join("")}
        </div>
      `;
    }

    let tableRowsHTML = "";
    for (let j = 0; j < ds.entries.length; j++) {
      const e = ds.entries[j];
      const eff = effectiveEntries[j];
      const prevEff = j > 0 ? effectiveEntries[j - 1] : null;

      const isInitial = j === 0 && eff && eff.effectiveSupplier;
      const isTransition =
        j > 0 &&
        prevEff &&
        eff &&
        eff.effectiveSupplier !== prevEff.effectiveSupplier;

      if (isInitial) {
        tableRowsHTML += `
          <tr class="supplier-transition-row">
            <td colspan="5">
              <div class="supplier-transition-badge">
                🏁 Initial Supplier: <strong>${eff.effectiveSupplier}</strong>
              </div>
            </td>
          </tr>
        `;
      } else if (isTransition) {
        tableRowsHTML += `
          <tr class="supplier-transition-row">
            <td colspan="5">
              <div class="supplier-transition-badge">
                🔄 Supplier Transition: <strong>${eff.effectiveSupplier}</strong>
              </div>
            </td>
          </tr>
        `;
      }

      tableRowsHTML += `
        <tr>
          <td class="row-index">${j + 1}</td>
          <td>
            <input type="date" class="input-table-date" value="${e.date || ""}" data-i="${i}" data-j="${j}" data-field="date" />
          </td>
          <td>
            <input type="number" step="any" class="input-table-number" value="${Number.isNaN(e.value) ? "" : e.value}" data-i="${i}" data-j="${j}" data-field="value" placeholder="0" />
          </td>
          <td>
            <input type="text" class="input-table-text input-supplier-field" value="${e.supplier || ""}" placeholder="(${eff?.effectiveSupplier || "Inherited"})" data-i="${i}" data-j="${j}" data-field="supplier" title="Supplier name (leave blank to inherit from previous row)" />
          </td>
          <td class="controls-cell">
            <button class="btn-row-action btn-move-up" data-i="${i}" data-j="${j}" title="Move Up">↑</button>
            <button class="btn-row-action btn-move-down" data-i="${i}" data-j="${j}" title="Move Down">↓</button>
            <button class="btn-row-action btn-delete" data-i="${i}" data-j="${j}" title="Delete Row">🗑️</button>
          </td>
        </tr>
      `;
    }

    card.innerHTML = `
      <div class="header-controls">
        <div class="category-header-title">
          <h2>${ds.name}</h2>
          <span class="entries-count-badge">${ds.entries.length} readings</span>
        </div>
        <div class="header-action-group">
          ${
            hasData
              ? `<button class="btn-action btn-export" id="export-csv-hdr-${i}">
                  📥 Export CSV
                </button>`
              : ""
          }
          <label class="btn-action btn-import">
            📤 Import CSV
            <input type="file" accept=".csv" class="input-csv-file-hdr" data-i="${i}" style="display:none" />
          </label>
          <button class="btn-action btn-toggle" id="toggle-card-${i}">
            ${ds.collapsed ? "📋 Edit Table" : "📊 Hide Table"}
          </button>
          <button class="btn-action btn-delete-cat" id="delete-cat-${i}" title="Delete Category">
            🗑️
          </button>
        </div>
      </div>

      ${statsChips}

      <div class="card-collapsible-content" style="display:${ds.collapsed ? "none" : "block"};">
        <div class="table-responsive">
          <table class="readings-table">
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Date</th>
                <th>Meter Reading Value</th>
                <th>Supplier</th>
                <th style="width: 130px; text-align: center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHTML}
            </tbody>
          </table>
        </div>

        <button class="btn-add-row" id="add-row-${i}" title="Add new meter reading">+ Add Reading Entry</button>

        <div class="action-buttons-bar">
          <button class="btn-action btn-export" id="export-csv-${i}">
            📥 Export CSV
          </button>
          <label class="btn-action btn-import">
            📤 Import CSV
            <input type="file" accept=".csv" class="input-csv-file" data-i="${i}" style="display:none" />
          </label>
          <button class="btn-action btn-close-table" id="close-table-${i}">
            🔼 Collapse Table
          </button>
        </div>
      </div>

      <div class="chart-section">
        ${
          hasData
            ? `<div class="chart-header-bar">
                <span class="chart-section-title">Relative Consumption Trend</span>
                <button class="btn-export-chart-small" id="export-line-${i}" title="Save Line Chart as PNG image">
                  📷 Save PNG
                </button>
              </div>`
            : ""
        }
        ${supplierPillsHTML}
        <div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>
        <div id="bar-container-${i}" class="bar-charts-container"></div>
      </div>
    `;

    host.appendChild(card);

    const toggleBtn = card.querySelector(`#toggle-card-${i}`);
    if (toggleBtn) toggleBtn.addEventListener("click", () => toggleCollapse(i));

    const closeTableBtn = card.querySelector(`#close-table-${i}`);
    if (closeTableBtn)
      closeTableBtn.addEventListener("click", () => toggleCollapse(i));

    const deleteCatBtn = card.querySelector(`#delete-cat-${i}`);
    if (deleteCatBtn)
      deleteCatBtn.addEventListener("click", () => deleteCategory(i));

    const exportLineBtn = card.querySelector(`#export-line-${i}`);
    if (exportLineBtn)
      exportLineBtn.addEventListener("click", () => exportLineChart(i));

    const addRowBtn = card.querySelector(`#add-row-${i}`);
    if (addRowBtn) addRowBtn.addEventListener("click", () => addEntry(i));

    const exportCsvBtn = card.querySelector(`#export-csv-${i}`);
    if (exportCsvBtn)
      exportCsvBtn.addEventListener("click", () => exportCSV(i));

    const exportCsvHdrBtn = card.querySelector(`#export-csv-hdr-${i}`);
    if (exportCsvHdrBtn)
      exportCsvHdrBtn.addEventListener("click", () => exportCSV(i));

    const importCsvInputs = card.querySelectorAll<HTMLInputElement>(
      `.input-csv-file[data-i="${i}"], .input-csv-file-hdr[data-i="${i}"]`,
    );
    for (const inputEl of importCsvInputs) {
      inputEl.addEventListener("change", (e) => importCSV(e, i));
    }

    const inputElements =
      card.querySelectorAll<HTMLInputElement>("input[data-field]");
    for (const inputEl of inputElements) {
      inputEl.addEventListener("change", (e) => {
        const target = e.target as HTMLInputElement;
        const indexI = Number(target.dataset.i);
        const indexJ = Number(target.dataset.j);
        const field = target.dataset.field as "date" | "value" | "supplier";
        updateEntry(indexI, indexJ, field, target.value);
      });
    }

    const supplierPillEls =
      card.querySelectorAll<HTMLElement>(".supplier-pill");
    for (const pillEl of supplierPillEls) {
      pillEl.addEventListener("mouseenter", () => {
        const indexI = Number(pillEl.dataset.i);
        const supName = pillEl.dataset.supplier || null;
        highlightSupplierPeriod(indexI, supName);
      });
      pillEl.addEventListener("mouseleave", () => {
        const indexI = Number(pillEl.dataset.i);
        highlightSupplierPeriod(indexI, null);
      });
    }

    const moveUpButtons =
      card.querySelectorAll<HTMLButtonElement>(".btn-move-up");
    for (const btnEl of moveUpButtons) {
      btnEl.addEventListener("click", (e) => {
        const target = (e.target as HTMLElement).closest("button");
        if (target) {
          const indexI = Number(target.dataset.i);
          const indexJ = Number(target.dataset.j);
          moveEntry(indexI, indexJ, -1);
        }
      });
    }

    const moveDownButtons =
      card.querySelectorAll<HTMLButtonElement>(".btn-move-down");
    for (const btnEl of moveDownButtons) {
      btnEl.addEventListener("click", (e) => {
        const target = (e.target as HTMLElement).closest("button");
        if (target) {
          const indexI = Number(target.dataset.i);
          const indexJ = Number(target.dataset.j);
          moveEntry(indexI, indexJ, 1);
        }
      });
    }

    const deleteButtons =
      card.querySelectorAll<HTMLButtonElement>(".btn-delete");
    for (const btnEl of deleteButtons) {
      btnEl.addEventListener("click", (e) => {
        const target = (e.target as HTMLElement).closest("button");
        if (target) {
          const indexI = Number(target.dataset.i);
          const indexJ = Number(target.dataset.j);
          deleteEntry(indexI, indexJ);
        }
      });
    }

    drawChart(i);
  }

  requestAnimationFrame(() => {
    window.scrollTo({ top: currentScrollY, behavior: "instant" });
  });

  if (shouldPersist) {
    persistState();
  }
}

export function setupDOMEvents(): void {
  const addBtn = document.getElementById("addCategoryBtn");
  const input = document.getElementById(
    "newCategory",
  ) as HTMLInputElement | null;
  const importCategoryInput = document.getElementById(
    "importCategoryCsvInput",
  ) as HTMLInputElement | null;

  if (addBtn && input) {
    const handleAdd = () => {
      const val = input.value;
      if (val.trim()) {
        addCategory(val);
        input.value = "";
      }
    };

    addBtn.addEventListener("click", handleAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    });
  }

  if (importCategoryInput) {
    importCategoryInput.addEventListener("change", (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;

      const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "").trim();
      const categoryName = fileNameWithoutExt || "New Category";

      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        if (!text) return;
        const entries = parseCSVText(text);
        addCategory(categoryName, entries);
        target.value = "";
      };
      reader.readAsText(file);
    });
  }
}
