import {
  getEffectiveEntries,
  getSupplierSummaries,
  groupEntriesByYear,
} from "./calculations";
import { drawChart, exportLineChart, highlightSupplierPeriod } from "./charts";
import {
  buildCategoryReportData,
  formatReportPlainText,
  getStyledChartBlob,
  shareOrCopyReport,
} from "./report";
import { renderPageNavigation } from "./sharing";
import {
  MAX_CATEGORIES_PER_PAGE,
  MAX_ENTRIES_PER_CATEGORY,
  addCategory,
  addEntry,
  canEditActivePage,
  currentUser,
  deleteCategory,
  deleteEntry,
  escapeHtml,
  getActiveDatasets,
  getActivePage,
  handleGoogleSignIn,
  handleSignOut,
  importCSVEntries,
  manualReSync,
  moveEntry,
  persistState,
  sortCategoryEntries,
  syncState,
  toggleCollapse,
  updateEntry,
} from "./state";
import type { CategoryDataset, ReadingEntry } from "./types";

export function renderAuthUI(notice?: string): void {
  const badge = document.getElementById("authBadge");
  const label = document.getElementById("userLabel");
  const btn = document.getElementById("authBtn");
  const syncBtn = document.getElementById("syncBtn");
  const syncText = document.getElementById("syncStatusText");

  if (!badge || !btn || !label) return;

  if (notice) {
    let toast = document.getElementById("authToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "authToast";
      toast.className = "auth-toast-banner";
      document.querySelector(".container")?.prepend(toast);
    }
    toast.textContent = notice;
    toast.style.display = "block";
    setTimeout(() => {
      if (toast) toast.style.display = "none";
    }, 6000);
  }

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
  const ds = getActiveDatasets()[i];
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
  const ds = getActiveDatasets()[i];
  if (!ds || !ds.entries.length) return "";

  const sorted = [...ds.entries]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!sorted.length) return "";

  const yearGroups = groupEntriesByYear(sorted);
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

export function openReportModal(categoryIndex: number): void {
  const activePage = getActivePage();
  const ds = getActiveDatasets()[categoryIndex];
  if (!ds || !activePage) return;

  const reportData = buildCategoryReportData(activePage.title, ds);
  if (!reportData) {
    alert("Недостатньо даних для формування звіту.");
    return;
  }

  let reportOverlay = document.getElementById("reportModalOverlay");
  if (!reportOverlay) {
    reportOverlay = document.createElement("div");
    reportOverlay.id = "reportModalOverlay";
    reportOverlay.className = "tracker-modal-overlay";
    document.body.appendChild(reportOverlay);
  }

  const initialText = formatReportPlainText(reportData);

  reportOverlay.innerHTML = `
    <div class="tracker-modal-content report-modal-content">
      <div class="tracker-modal-header">
        <h3>📤 Звіт для Telegram: ${ds.name}</h3>
        <button class="modal-close-btn" id="closeReportModalBtn">&times;</button>
      </div>
      <div class="tracker-modal-body">
        <p class="section-desc">Текст звіту та графік підготовлено для надсилання в Telegram:</p>
        <textarea id="reportTextEditor" class="report-textarea" rows="6">${initialText}</textarea>
        <div id="reportActionStatus" class="report-status-msg"></div>
      </div>
      <div class="tracker-modal-footer report-modal-footer">
        <button class="btn-modal-action btn-share-native" id="btnShareNative">
          📱 Надіслати (Share)
        </button>
        <button class="btn-modal-action" id="btnCopyGraphAndText">
          🖼️ Графік + Текст (Ctrl+V)
        </button>
        <button class="btn-modal-secondary" id="btnCopyTextOnly">
          📋 Тільки текст
        </button>
      </div>
    </div>
  `;

  reportOverlay.style.display = "flex";

  const closeBtn = reportOverlay.querySelector("#closeReportModalBtn");
  closeBtn?.addEventListener("click", () => {
    reportOverlay.style.display = "none";
  });

  const statusEl = reportOverlay.querySelector(
    "#reportActionStatus",
  ) as HTMLElement | null;
  const textarea = reportOverlay.querySelector(
    "#reportTextEditor",
  ) as HTMLTextAreaElement | null;

  const showStatus = (msg: string, isError = false) => {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = `report-status-msg ${isError ? "error" : "success"}`;
      statusEl.style.display = "block";
    }
  };

  // 1. Native share button
  reportOverlay
    .querySelector("#btnShareNative")
    ?.addEventListener("click", async () => {
      if (!ds.chart) return;
      const blob = await getStyledChartBlob(ds.chart);
      const text = textarea?.value || initialText;
      const res = await shareOrCopyReport(
        blob,
        text,
        `${activePage.title} — ${ds.name}`,
      );
      showStatus(res.message, !res.success);
    });

  // 2. Graph + Text copy
  reportOverlay
    .querySelector("#btnCopyGraphAndText")
    ?.addEventListener("click", async () => {
      if (!ds.chart) return;
      const blob = await getStyledChartBlob(ds.chart);
      const text = textarea?.value || initialText;
      const res = await shareOrCopyReport(
        blob,
        text,
        `${activePage.title} — ${ds.name}`,
      );
      showStatus(res.message, !res.success);
    });

  // 3. Text only
  reportOverlay
    .querySelector("#btnCopyTextOnly")
    ?.addEventListener("click", async () => {
      const text = textarea?.value || initialText;
      try {
        await navigator.clipboard.writeText(text);
        showStatus("Текст звіту успішно скопійовано!");
      } catch {
        showStatus("Помилка копіювання до буфера.", true);
      }
    });
}

export function createCategoryCard(
  i: number,
  ds: CategoryDataset,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "dataset-card";
  card.id = `dataset-card-${i}`;

  const editable = canEditActivePage();
  const hasData = ds.entries.length > 0;
  const statsChips = renderStatsChips(i);
  const effectiveEntries = getEffectiveEntries(ds.entries);
  const supplierSummaries = getSupplierSummaries(ds.entries);

  const sortedChronological = [...ds.entries]
    .filter((entry) => entry.date && Number.isFinite(Number(entry.value)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let supplierPillsHTML = "";
  if (hasData && supplierSummaries.length > 0) {
    supplierPillsHTML = `
      <div class="supplier-pills-bar">
        <span class="supplier-pills-label">Suppliers:</span>
        ${supplierSummaries
          .map(
            (s) => `
          <div class="supplier-pill" data-i="${i}" data-supplier="${escapeHtml(s.supplier)}" style="--pill-color: ${escapeHtml(s.color)};">
            <span class="supplier-pill-dot" style="background-color: ${escapeHtml(s.color)};"></span>
            <span class="supplier-pill-name">${escapeHtml(s.supplier)}</span>
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

    let isAnomaly = false;
    let anomalyDiff = 0;
    let prevReadingRef = "";

    if (e.date && Number.isFinite(Number(e.value))) {
      const eTime = new Date(e.date).getTime();
      const eVal = Number(e.value);
      let pred: ReadingEntry | null = null;
      for (const item of sortedChronological) {
        const itemTime = new Date(item.date).getTime();
        if (itemTime < eTime) {
          pred = item;
        } else {
          break;
        }
      }
      if (pred && eVal < Number(pred.value)) {
        isAnomaly = true;
        anomalyDiff = Math.round((Number(pred.value) - eVal) * 100) / 100;
        prevReadingRef = `${pred.date} (${pred.value})`;
      }
    }

    if (isInitial) {
      tableRowsHTML += `
        <tr class="supplier-transition-row">
          <td colspan="5">
            <div class="supplier-transition-badge">
              🏁 Initial Supplier: <strong>${escapeHtml(eff.effectiveSupplier)}</strong>
            </div>
          </td>
        </tr>
      `;
    } else if (isTransition) {
      tableRowsHTML += `
        <tr class="supplier-transition-row">
          <td colspan="5">
            <div class="supplier-transition-badge">
              🔄 Supplier Transition: <strong>${escapeHtml(eff.effectiveSupplier)}</strong>
            </div>
          </td>
        </tr>
      `;
    }

    tableRowsHTML += `
      <tr class="${isAnomaly ? "tr-anomaly" : ""}">
        <td class="row-index">${j + 1}</td>
        <td>
          <input type="date" class="input-table-date" value="${escapeHtml(e.date || "")}" data-i="${i}" data-j="${j}" data-field="date" ${!editable ? "disabled" : ""} />
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="number" step="any" class="input-table-number ${isAnomaly ? "input-anomaly" : ""}" value="${Number.isNaN(e.value) ? "" : e.value}" data-i="${i}" data-j="${j}" data-field="value" placeholder="0" ${!editable ? "disabled" : ""} />
            ${isAnomaly ? `<span class="anomaly-badge" title="Показ менший за попередній на ${anomalyDiff} (було ${escapeHtml(prevReadingRef)}). Можлива помилка введення.">⚠️ -${anomalyDiff}</span>` : ""}
          </div>
        </td>
        <td>
          <input type="text" class="input-table-text input-supplier-field" value="${escapeHtml(e.supplier || "")}" placeholder="(${escapeHtml(eff?.effectiveSupplier || "Inherited")})" data-i="${i}" data-j="${j}" data-field="supplier" title="Supplier name (leave blank to inherit from previous row)" ${!editable ? "disabled" : ""} />
        </td>
        <td class="controls-cell">
          ${
            editable
              ? `
            <button class="btn-row-action btn-move-up" data-i="${i}" data-j="${j}" title="Move Up">↑</button>
            <button class="btn-row-action btn-move-down" data-i="${i}" data-j="${j}" title="Move Down">↓</button>
            <button class="btn-row-action btn-delete" data-i="${i}" data-j="${j}" title="Delete Row">🗑️</button>
          `
              : `<span class="read-only-tag">—</span>`
          }
        </td>
      </tr>
    `;
  }

  const isEntryLimitReached = ds.entries.length >= MAX_ENTRIES_PER_CATEGORY;

  card.innerHTML = `
    <div class="header-controls">
      <div class="category-header-title">
        <h2>${escapeHtml(ds.name)}</h2>
        <span class="entries-count-badge">${ds.entries.length}/${MAX_ENTRIES_PER_CATEGORY} readings</span>
      </div>
      <div class="header-action-group">
        ${
          hasData
            ? `<button class="btn-action btn-export" id="export-csv-hdr-${i}">
                📥 Export CSV
              </button>`
            : ""
        }
        ${
          editable
            ? `
          <label class="btn-action btn-import">
            📤 Import CSV
            <input type="file" accept=".csv" class="input-csv-file-hdr" data-i="${i}" style="display:none" />
          </label>
        `
            : ""
        }
        <button class="btn-action btn-toggle" id="toggle-card-${i}">
          ${ds.collapsed ? (editable ? "📋 Edit Table" : "📋 View Table") : "📊 Hide Table"}
        </button>
        ${
          editable
            ? `
          <button class="btn-action btn-delete-cat" id="delete-cat-${i}" title="Delete Category">
            🗑️
          </button>
        `
            : ""
        }
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

      ${
        editable
          ? `
        <div class="table-actions-row">
          <button class="btn-add-row" id="add-row-${i}" ${isEntryLimitReached ? "disabled" : ""} title="${isEntryLimitReached ? `Досягнуто ліміт (${MAX_ENTRIES_PER_CATEGORY} записів)` : "Add new meter reading"}">+ Add Reading Entry ${isEntryLimitReached ? "(Ліміт)" : ""}</button>
          <button class="btn-action btn-sort" id="sort-date-${i}" title="Sort readings chronologically by date">📅 Sort by Date</button>
        </div>
      `
          : ""
      }

      <div class="action-buttons-bar">
        <button class="btn-action btn-export" id="export-csv-${i}">
          📥 Export CSV
        </button>
        ${
          editable
            ? `
          <label class="btn-action btn-import">
            📤 Import CSV
            <input type="file" accept=".csv" class="input-csv-file" data-i="${i}" style="display:none" />
          </label>
        `
            : ""
        }
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
              <div class="chart-header-actions">
                <button class="btn-export-chart-small btn-share-report-action" id="share-report-${i}" title="Звіт для Telegram (графік + текст)">
                  📤 Звіт / Share
                </button>
                <button class="btn-export-chart-small" id="export-line-${i}" title="Save Line Chart as PNG image">
                  📷 Save PNG
                </button>
              </div>
            </div>`
          : ""
      }
      ${supplierPillsHTML}
      <div class="chart-wrap"><canvas id="chart-${i}"></canvas></div>
      <div id="bar-container-${i}" class="bar-charts-container"></div>
    </div>
  `;

  // Bind Buttons
  card
    .querySelector(`#toggle-card-${i}`)
    ?.addEventListener("click", () => toggleCollapse(i));
  card
    .querySelector(`#close-table-${i}`)
    ?.addEventListener("click", () => toggleCollapse(i));
  card
    .querySelector(`#delete-cat-${i}`)
    ?.addEventListener("click", () => deleteCategory(i));
  card
    .querySelector(`#export-line-${i}`)
    ?.addEventListener("click", () => exportLineChart(i));
  card
    .querySelector(`#share-report-${i}`)
    ?.addEventListener("click", () => openReportModal(i));

  card
    .querySelector(`#add-row-${i}`)
    ?.addEventListener("click", () => addEntry(i));
  card
    .querySelector(`#sort-date-${i}`)
    ?.addEventListener("click", () => sortCategoryEntries(i));
  card
    .querySelector(`#export-csv-${i}`)
    ?.addEventListener("click", () => exportCSV(i));
  card
    .querySelector(`#export-csv-hdr-${i}`)
    ?.addEventListener("click", () => exportCSV(i));

  if (editable) {
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

    const bindRowAction = (
      selector: string,
      action: (i: number, j: number) => void,
    ) => {
      for (const btnEl of card.querySelectorAll<HTMLButtonElement>(selector)) {
        btnEl.addEventListener("click", (e) => {
          const target = (e.target as HTMLElement).closest("button");
          if (target) {
            action(Number(target.dataset.i), Number(target.dataset.j));
          }
        });
      }
    };

    bindRowAction(".btn-move-up", (indexI, indexJ) =>
      moveEntry(indexI, indexJ, -1),
    );
    bindRowAction(".btn-move-down", (indexI, indexJ) =>
      moveEntry(indexI, indexJ, 1),
    );
    bindRowAction(".btn-delete", (indexI, indexJ) =>
      deleteEntry(indexI, indexJ),
    );
  }

  const supplierPillEls = card.querySelectorAll<HTMLElement>(".supplier-pill");
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

  return card;
}

export function renderDatasets(
  shouldPersist = true,
  targetCategoryIndex?: number,
): void {
  renderPageNavigation();

  const host = document.getElementById("datasets");
  if (!host) return;

  const currentDatasets = getActiveDatasets();
  const editable = canEditActivePage();

  const isCategoryLimitReached =
    currentDatasets.length >= MAX_CATEGORIES_PER_PAGE;

  const categoryBar = document.querySelector(
    ".new-category-bar",
  ) as HTMLElement | null;
  if (categoryBar) {
    categoryBar.style.display = editable ? "flex" : "none";
    const addCatBtn = document.getElementById(
      "addCategoryBtn",
    ) as HTMLButtonElement | null;
    const catInput = document.getElementById(
      "newCategory",
    ) as HTMLInputElement | null;
    if (addCatBtn && catInput) {
      addCatBtn.disabled = isCategoryLimitReached;
      catInput.disabled = isCategoryLimitReached;
      addCatBtn.textContent = isCategoryLimitReached
        ? `Limit (${MAX_CATEGORIES_PER_PAGE})`
        : "+ Add Category";
      if (isCategoryLimitReached) {
        catInput.placeholder = `Ліміт досягнуто (${MAX_CATEGORIES_PER_PAGE} категорій)`;
      } else {
        catInput.placeholder =
          "New category name (e.g. Electricity, Gas, Water)";
      }
    }
  }

  if (
    targetCategoryIndex !== undefined &&
    currentDatasets[targetCategoryIndex]
  ) {
    const existingCard = document.getElementById(
      `dataset-card-${targetCategoryIndex}`,
    );
    if (existingCard) {
      const newCard = createCategoryCard(
        targetCategoryIndex,
        currentDatasets[targetCategoryIndex],
      );
      existingCard.replaceWith(newCard);
      drawChart(targetCategoryIndex);

      if (shouldPersist) {
        persistState();
      }
      return;
    }
  }

  const currentScrollY = window.scrollY;
  host.innerHTML = "";

  for (const [i, ds] of currentDatasets.entries()) {
    const card = createCategoryCard(i, ds);
    host.appendChild(card);
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
