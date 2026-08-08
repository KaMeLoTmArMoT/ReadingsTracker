import { Chart, type ChartDataset, type ChartType, type Plugin, registerables } from "chart.js";
import "chartjs-adapter-date-fns";

declare module "chart.js" {
  interface PluginOptionsByType<TType extends ChartType> {
    supplierLineTransitions?: {
      periods?: SupplierPeriodSummary[];
      highlightedSupplier?: string | null;
    };
    supplierBarTransitions?: {
      periods?: SupplierPeriodSummary[];
      year?: string;
      highlightedSupplier?: string | null;
    };
  }
}

import {
  addSyntheticDec31ForClosedYears,
  allocateByMonth,
  findDateAtLevel,
  getActiveMonthForecast,
  getSupplierSummaries,
  mmddFromRefDate,
  toUTCDate,
} from "./calculations";
import { datasets } from "./state";
import type {
  ActiveForecast,
  ChartInstance,
  Point2D,
  ReadingEntry,
  SupplierPeriodSummary,
} from "./types";

Chart.register(...registerables);

const yearColors = [
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#64748b",
  "#14b8a6",
  "#ec4899",
  "#6366f1",
  "#a855f7",
];

export const deltaArrowsPlugin: Plugin<"bar"> = {
  id: "deltaArrows",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;

    const dsIndex = chart.data.datasets.length - 1;
    const meta = chart.getDatasetMeta(dsIndex);
    const data = (chart.data.datasets[dsIndex]?.data as number[]) || [];
    if (!meta || !meta.data?.length) return;

    const xScale = chart.scales[meta.xAxisID || "x"];
    if (!xScale) return;

    const baseY = xScale.bottom + 4;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "500 11px Inter, sans-serif";

    for (let i = 1; i < data.length; i++) {
      const curr = Number(data[i]);
      const prev = Number(data[i - 1]);
      const el = meta.data[i];
      if (!el) continue;

      let label = "—";
      let color = "#64748b";

      if (Number.isFinite(curr) && Number.isFinite(prev) && prev !== 0) {
        const pct = ((curr - prev) / prev) * 100;
        const up = pct >= 0;
        const arrow = up ? "↑" : "↓";
        color = up ? "#f87171" : "#4ade80";
        label = `${arrow} ${pct >= 0 ? "+" : ""}${Math.round(pct)}%`;
      }

      ctx.fillStyle = color;
      ctx.fillText(label, el.x, baseY);
    }

    ctx.restore();
  },
};

export const activeHighlightedSupplier: Record<number, string | null> = {};

export function highlightSupplierPeriod(
  categoryIndex: number,
  supplierName: string | null,
): void {
  activeHighlightedSupplier[categoryIndex] = supplierName;
  const ds = datasets[categoryIndex];
  if (!ds) return;

  if (ds.chart) {
    ds.chart.update?.();
  }
  if (ds.barCharts) {
    for (const key of Object.keys(ds.barCharts)) {
      ds.barCharts[key]?.update?.();
    }
  }
}

export const supplierLineTransitionsPlugin: Plugin<"line"> = {
  id: "supplierLineTransitions",
  afterDraw(
    chart,
    _args,
    options: {
      periods?: SupplierPeriodSummary[];
      highlightedSupplier?: string | null;
    },
  ) {
    const periods = options?.periods;
    if (!periods || periods.length <= 1) return;

    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale || !chartArea) return;

    const highlighted = options.highlightedSupplier;

    interface TransitionBadge {
      xPix: number;
      period: SupplierPeriodSummary;
      yearStr: string;
      isFocused: boolean;
      yLevel: number;
    }

    const validBadges: TransitionBadge[] = [];

    for (let pIdx = 1; pIdx < periods.length; pIdx++) {
      const p = periods[pIdx];
      if (!p.startDate) continue;

      const yearStr = p.startDate.slice(0, 4);
      const mmdd = p.startDate.slice(5);
      const refTime = new Date(`2000-${mmdd}`).getTime();
      const xPix = xScale.getPixelForValue(refTime);

      if (xPix < chartArea.left || xPix > chartArea.right) continue;

      const isFocused = !highlighted || highlighted === p.supplier;
      validBadges.push({
        xPix,
        period: p,
        yearStr,
        isFocused,
        yLevel: 0,
      });
    }

    if (!validBadges.length) return;

    validBadges.sort((a, b) => a.xPix - b.xPix);

    const MIN_X_DIST = 55;
    for (let idx = 0; idx < validBadges.length; idx++) {
      let level = 0;
      for (let prevIdx = 0; prevIdx < idx; prevIdx++) {
        if (
          Math.abs(validBadges[idx].xPix - validBadges[prevIdx].xPix) <
          MIN_X_DIST
        ) {
          if (validBadges[prevIdx].yLevel === level) {
            level++;
          }
        }
      }
      validBadges[idx].yLevel = level;
    }

    ctx.save();

    for (const b of validBadges) {
      const { xPix, period: p, yearStr, isFocused, yLevel } = b;
      const alphaHex = isFocused ? "FF" : "33";

      // 1. Vertical dashed line
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = `${p.color}${alphaHex}`;
      ctx.lineWidth = isFocused ? 2 : 1;
      ctx.moveTo(xPix, chartArea.top);
      ctx.lineTo(xPix, chartArea.bottom);
      ctx.stroke();

      // 2. Circle Pin Marker on dataset curve for matching year
      for (let dsIdx = 0; dsIdx < chart.data.datasets.length; dsIdx++) {
        const dsLabel = chart.data.datasets[dsIdx]?.label;
        if (dsLabel === yearStr) {
          const meta = chart.getDatasetMeta(dsIdx);
          if (meta?.data?.length) {
            let closestEl = meta.data[0];
            let minDist = Math.abs(closestEl.x - xPix);
            for (const el of meta.data) {
              const d = Math.abs(el.x - xPix);
              if (d < minDist) {
                minDist = d;
                closestEl = el;
              }
            }

            if (closestEl && minDist < 30) {
              ctx.save();
              ctx.beginPath();
              ctx.setLineDash([]);
              ctx.arc(
                closestEl.x,
                closestEl.y,
                isFocused ? 5 : 3.5,
                0,
                Math.PI * 2,
              );
              ctx.fillStyle = `${p.color}${alphaHex}`;
              ctx.fill();
              ctx.strokeStyle = "#ffffff";
              ctx.lineWidth = 1.5;
              ctx.stroke();
              ctx.restore();
            }
          }
        }
      }

      // 3. Staggered Pill Badge near top
      const labelText = `🔄 '${yearStr.slice(2)} ${p.supplier}`;
      ctx.font = "600 10px Inter, sans-serif";
      const textMetrics = ctx.measureText(labelText);
      const paddingX = 6;
      const badgeWidth = textMetrics.width + paddingX * 2;
      const badgeHeight = 16;
      const badgeY = chartArea.top + 6 + yLevel * (badgeHeight + 4);

      const rx = xPix - badgeWidth / 2;
      const ry = badgeY;
      const radius = 8;

      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(rx + radius, ry);
      ctx.lineTo(rx + badgeWidth - radius, ry);
      ctx.quadraticCurveTo(rx + badgeWidth, ry, rx + badgeWidth, ry + radius);
      ctx.lineTo(rx + badgeWidth, ry + badgeHeight - radius);
      ctx.quadraticCurveTo(
        rx + badgeWidth,
        ry + badgeHeight,
        rx + badgeWidth - radius,
        ry + badgeHeight,
      );
      ctx.lineTo(rx + radius, ry + badgeHeight);
      ctx.quadraticCurveTo(rx, ry + badgeHeight, rx, ry + badgeHeight - radius);
      ctx.lineTo(rx, ry + radius);
      ctx.quadraticCurveTo(rx, ry, rx + radius, ry);
      ctx.closePath();

      ctx.fillStyle = isFocused
        ? "rgba(15, 23, 42, 0.92)"
        : "rgba(15, 23, 42, 0.4)";
      ctx.fill();
      ctx.strokeStyle = `${p.color}${alphaHex}`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = isFocused ? p.color : `${p.color}66`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, xPix, ry + badgeHeight / 2);
    }

    ctx.restore();
  },
};

export const supplierBarTransitionsPlugin: Plugin<"bar"> = {
  id: "supplierBarTransitions",
  afterDraw(
    chart,
    _args,
    options: {
      periods?: SupplierPeriodSummary[];
      year?: string;
      highlightedSupplier?: string | null;
    },
  ) {
    const periods = options?.periods;
    const year = options?.year;
    if (!periods || !year || periods.length <= 1) return;

    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale || !chartArea) return;

    const highlighted = options.highlightedSupplier;

    ctx.save();
    for (let pIdx = 1; pIdx < periods.length; pIdx++) {
      const p = periods[pIdx];
      if (!p.startDate || !p.startDate.startsWith(year)) continue;

      const monthNum = Number.parseInt(p.startDate.slice(5, 7), 10);
      const barIndex = monthNum - 1;
      const meta = chart.getDatasetMeta(0);
      const el = meta?.data?.[barIndex];
      if (!el) continue;

      const isFocused = !highlighted || highlighted === p.supplier;
      const alpha = isFocused ? "FF" : "33";

      const x = el.x;
      const y = el.y;

      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = `${p.color}${alpha}`;
      ctx.lineWidth = 2;
      ctx.moveTo(x - 12, y - 4);
      ctx.lineTo(x + 12, y - 4);
      ctx.stroke();

      ctx.fillStyle = `${p.color}${alpha}`;
      ctx.font = "600 9px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`🔄 ${p.supplier}`, x, y - 6);
    }
    ctx.restore();
  },
};

export function downloadChartImage(
  chartInstance: ChartInstance | undefined | null,
  filename: string,
): void {
  if (!chartInstance) return;
  const url = chartInstance.toBase64Image();
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportLineChart(i: number): void {
  const ds = datasets[i];
  if (!ds || !ds.chart) return;
  downloadChartImage(ds.chart, `${ds.name}-line.png`);
}

export function drawChart(i: number): void {
  const canvas = document.getElementById(
    `chart-${i}`,
  ) as HTMLCanvasElement | null;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (datasets[i].chart) {
    datasets[i].chart?.destroy();
    datasets[i].chart = null;
  }

  const sorted: ReadingEntry[] = [...datasets[i].entries]
    .filter((e) => e.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!sorted.length) return;

  const forecast = getActiveMonthForecast(sorted);

  const yearGroups: Record<string, ReadingEntry[]> = {};
  for (const e of sorted) {
    const year = String(e.date).slice(0, 4);
    if (!yearGroups[year]) yearGroups[year] = [];
    yearGroups[year].push(e);
  }

  const years = Object.keys(yearGroups).sort();

  addSyntheticDec31ForClosedYears(yearGroups, years);

  const chartDatasets: ChartDataset<"line" | "scatter", Point2D[]>[] = [];
  const yearBaselines: Record<string, number> = {};
  const yearPointsMap: Record<string, Point2D[]> = {};
  const REFERENCE_YEAR = 2000;

  datasets[i]._comparisons = null;

  for (const [yearIndex, year] of years.entries()) {
    let baseline = 0;

    if (yearIndex === 0) {
      baseline = yearGroups[year][0].value;
    } else {
      const prevYear = years[yearIndex - 1];
      const prevYearEntries = yearGroups[prevYear];
      const lastPrevEntry = prevYearEntries[prevYearEntries.length - 1];
      const firstCurrEntry = yearGroups[year][0];

      const lastPrevDate = toUTCDate(lastPrevEntry.date);
      const firstCurrDate = toUTCDate(firstCurrEntry.date);
      const jan1 = toUTCDate(`${year}-01-01`);

      const totalDays =
        (firstCurrDate.getTime() - lastPrevDate.getTime()) / 86400000;
      const daysToJan1 = (jan1.getTime() - lastPrevDate.getTime()) / 86400000;

      if (totalDays > 0 && daysToJan1 >= 0) {
        const rate = (firstCurrEntry.value - lastPrevEntry.value) / totalDays;
        baseline = lastPrevEntry.value + rate * daysToJan1;
      } else {
        baseline = firstCurrEntry.value;
      }
    }

    yearBaselines[year] = baseline;

    const points: Point2D[] = yearGroups[year].map((e) => {
      const monthDay = String(e.date).slice(5);
      return { x: `${REFERENCE_YEAR}-${monthDay}`, y: e.value - baseline };
    });

    points.unshift({ x: `${REFERENCE_YEAR}-01-01`, y: 0 });
    yearPointsMap[year] = points;

    const color = yearColors[yearIndex % yearColors.length];

    chartDatasets.push({
      type: "line",
      label: year,
      data: points,
      borderColor: color,
      backgroundColor: color,
      fill: false,
      tension: 0.2,
      pointRadius: 3,
      borderWidth: 2,
      spanGaps: false,
    });

    if (forecast && year === forecast.activeYear) {
      const x0 = `${REFERENCE_YEAR}-${String(forecast.lastDateStr).slice(5)}`;
      const x1 = `${REFERENCE_YEAR}-${String(forecast.monthEndStr).slice(5)}`;

      const y0 = forecast.lastValue - baseline;
      const y1 = forecast.predictedEndValue - baseline;

      const softColor = `${color}99`;

      chartDatasets.push({
        type: "line",
        label: `${year} (forecast)`,
        data: [
          { x: x0, y: y0 },
          { x: x1, y: y1 },
        ],
        borderColor: softColor,
        backgroundColor: softColor,
        borderDash: [6, 6],
        fill: false,
        tension: 0.0,
        pointRadius: (context) => (context.dataIndex === 1 ? 4 : 0),
        pointHoverRadius: (context) => (context.dataIndex === 1 ? 8 : 0),
        pointHitRadius: (context) => (context.dataIndex === 1 ? 14 : 0),
        borderWidth: 2,
        spanGaps: false,
      });
    }
  }

  // Same-level projection
  const last = sorted[sorted.length - 1];
  const currentYear = String(last.date).slice(0, 4);

  if (
    yearPointsMap[currentYear] &&
    Number.isFinite(yearBaselines[currentYear])
  ) {
    const currY = Number(last.value) - Number(yearBaselines[currentYear]);
    const currX = `${REFERENCE_YEAR}-${String(last.date).slice(5)}`;

    const comparisons: { year: string; mmdd: string }[] = [];

    for (const y of years) {
      if (y === currentYear) continue;

      const pts = yearPointsMap[y];
      if (!pts?.length) continue;

      const matchDate = findDateAtLevel(pts, currY);
      if (!matchDate) continue;

      const matchMMDD = mmddFromRefDate(matchDate);
      const matchX = `${REFERENCE_YEAR}-${matchMMDD}`;

      const idx = years.indexOf(y);
      const color = yearColors[(idx >= 0 ? idx : 0) % yearColors.length];
      const soft = `${color}77`;

      chartDatasets.push({
        type: "line",
        label: `${y} (same level)`,
        data: [
          { x: currX, y: currY },
          { x: matchX, y: currY },
        ],
        borderColor: soft,
        backgroundColor: soft,
        borderDash: [4, 4],
        borderWidth: 1,
        pointRadius: 0,
        tension: 0,
        fill: false,
      });

      chartDatasets.push({
        type: "scatter",
        label: `${y} (match)`,
        data: [{ x: matchX, y: currY }],
        pointRadius: 4,
        pointHoverRadius: 8,
        pointHitRadius: 14,
        backgroundColor: color,
        borderColor: color,
      });

      comparisons.push({ year: y, mmdd: matchMMDD });
    }

    if (comparisons.length) {
      datasets[i]._comparisons = {
        currentDate: last.date,
        items: comparisons,
      };
    }
  }

  datasets[i].chart = new Chart(ctx, {
    type: "line",
    data: { datasets: chartDatasets },
    options: {
      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: "time",
          time: { unit: "month", displayFormats: { month: "MMM" } },
          min: "2000-01-01",
          max: "2000-12-31",
          grid: { color: "rgba(255, 255, 255, 0.06)" },
          ticks: { color: "#94a3b8", font: { family: "Inter, sans-serif" } },
          title: {
            display: true,
            text: "Month",
            color: "#cbd5e1",
            font: { family: "Inter, sans-serif", weight: 500 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255, 255, 255, 0.06)" },
          ticks: { color: "#94a3b8", font: { family: "Inter, sans-serif" } },
          title: {
            display: true,
            text: "Relative Consumption",
            color: "#cbd5e1",
            font: { family: "Inter, sans-serif", weight: 500 },
          },
        },
      },
      plugins: {
        supplierLineTransitions: {
          periods: getSupplierSummaries(datasets[i].entries),
          highlightedSupplier: activeHighlightedSupplier[i],
        },
        legend: {
          labels: {
            color: "#e2e8f0",
            font: { family: "Inter, sans-serif", size: 12 },
            usePointStyle: true,
            boxWidth: 8,
            filter: (legendItem) => {
              const t = legendItem.text || "";
              if (t.includes("(same level)")) return false;
              if (t.includes("(match)")) return false;
              return true;
            },
          },
          display: true,
        },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.9)",
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1,
          padding: 10,
          displayColors: true,
          callbacks: {
            title(context) {
              const val = context[0]?.parsed?.x;
              if (val === null || val === undefined) return "";
              const date = new Date(val);
              const month = date.toLocaleString("en-US", { month: "long" });
              const day = date.getDate();
              return `${day} ${month}`;
            },
            label(context) {
              const label = context.dataset?.label
                ? `${context.dataset.label}: `
                : "";
              const y = context.parsed?.y;
              if (y === null || y === undefined || !Number.isFinite(y))
                return label;
              return `${label}${Math.round(y)}`;
            },
          },
        },
      },
    },
    plugins: [supplierLineTransitionsPlugin],
  });

  drawBarChart(i, sorted, forecast);
}

export function drawBarChart(
  i: number,
  sorted: ReadingEntry[],
  forecast: ActiveForecast | null,
): void {
  const barContainer = document.getElementById(`bar-container-${i}`);
  if (!barContainer) return;

  barContainer.innerHTML = "";
  datasets[i].barCharts = {};
  if (!sorted.length) return;

  const monthTotals: Record<string, number> = {};
  for (let k = 0; k < sorted.length - 1; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (!a?.date || !b?.date) continue;

    const aDate = toUTCDate(a.date);
    const bDate = toUTCDate(b.date);
    const diff = Number(b.value) - Number(a.value);

    if (!Number.isFinite(diff)) continue;
    if (!(bDate > aDate)) continue;

    allocateByMonth(aDate, bDate, diff, monthTotals);
  }

  const yearsSet = new Set<string>();
  for (const e of sorted) {
    yearsSet.add(String(e.date).slice(0, 4));
  }
  for (const k of Object.keys(monthTotals)) {
    yearsSet.add(k.slice(0, 4));
  }

  const years = Array.from(yearsSet).sort().reverse();

  for (const [yearIndex, year] of years.entries()) {
    const labels: string[] = [];
    const actualData: number[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      labels.push(mm);
      actualData.push(monthTotals[`${year}-${mm}`] || 0);
    }

    const yearTotal = actualData.reduce((s, v) => s + v, 0);
    const yearColor =
      yearColors[(years.length - 1 - yearIndex) % yearColors.length];

    const yearSection = document.createElement("div");
    yearSection.className = "bar-year-section";
    yearSection.style.borderLeftColor = yearColor;

    const yearHeader = document.createElement("div");
    yearHeader.className = "bar-year-header";

    const yearInfo = document.createElement("div");
    yearInfo.className = "bar-year-info";
    yearInfo.innerHTML = `
      <span class="bar-year-title" style="color: ${yearColor}">${year}</span>
      <span class="bar-year-total">Total: <strong style="color: ${yearColor}">${Math.round(yearTotal)}</strong></span>
    `;

    const exportBtn = document.createElement("button");
    exportBtn.className = "btn-export-chart-small";
    exportBtn.innerHTML = "📷 Save PNG";
    exportBtn.title = `Save ${year} chart as PNG image`;
    exportBtn.onclick = () => {
      const chart = datasets[i].barCharts?.[year];
      downloadChartImage(chart, `${datasets[i].name}-${year}-bars.png`);
    };

    yearHeader.appendChild(yearInfo);
    yearHeader.appendChild(exportBtn);

    const chartWrap = document.createElement("div");
    chartWrap.className = "bar-chart-wrap";

    const canvas = document.createElement("canvas");
    canvas.id = `bar-${i}-${year}`;
    chartWrap.appendChild(canvas);

    yearSection.appendChild(yearHeader);
    yearSection.appendChild(chartWrap);
    barContainer.appendChild(yearSection);

    const ds: ChartDataset<"bar", (number | null)[]>[] = [];

    ds.push({
      type: "bar",
      label: `Consumption ${year}`,
      data: actualData,
      backgroundColor: `${yearColor}CC`,
      borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 4, bottomRight: 4 },
    });

    if (
      forecast &&
      year === forecast.activeYear &&
      Number.isFinite(forecast.predictedMonth)
    ) {
      const monthIdx = forecast.activeMonthIdx;
      const actualThisMonth = actualData[monthIdx] || 0;
      if (forecast.predictedMonth > actualThisMonth) {
        const delta = forecast.predictedMonth - actualThisMonth;
        const predictedDelta = new Array<number | null>(12).fill(null);
        predictedDelta[monthIdx] = delta;

        ds.push({
          type: "bar",
          label: `Forecast ${year}`,
          data: predictedDelta,
          backgroundColor: `${yearColor}33`,
          borderColor: `${yearColor}EE`,
          borderWidth: 1.5,
          borderDash: [4, 4],
          borderRadius: {
            topLeft: 4,
            topRight: 4,
            bottomLeft: 0,
            bottomRight: 0,
          },
        } as unknown as ChartDataset<"bar", (number | null)[]>);
      }
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const barChart = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 20 } },
        scales: {
          x: {
            stacked: true,
            grid: { color: "rgba(255, 255, 255, 0.06)" },
            ticks: {
              padding: 5,
              color: "#94a3b8",
              font: { family: "Inter, sans-serif" },
            },
          },
          y: {
            stacked: true,
            grid: { color: "rgba(255, 255, 255, 0.06)" },
            ticks: { color: "#94a3b8", font: { family: "Inter, sans-serif" } },
          },
        },
        plugins: {
          supplierBarTransitions: {
            periods: getSupplierSummaries(datasets[i].entries),
            year,
            highlightedSupplier: activeHighlightedSupplier[i],
          },
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            callbacks: {
              label(context) {
                const raw = context.raw as number | null;
                if (raw === null || raw === undefined) return "";
                if (context.dataset.label?.startsWith("Forecast")) {
                  const actual = actualData[context.dataIndex] || 0;
                  return `Predicted Total: ${Math.round(actual + raw)}`;
                }
                return `${context.dataset.label}: ${Math.round(raw)}`;
              },
            },
          },
        },
      },
      plugins: [deltaArrowsPlugin, supplierBarTransitionsPlugin],
    });

    const currentBarMap: Record<string, ChartInstance> =
      datasets[i].barCharts || {};
    currentBarMap[year] = barChart;
    datasets[i].barCharts = currentBarMap;
  }
}
