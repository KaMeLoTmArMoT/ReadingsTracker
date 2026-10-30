import { getActiveMonthForecast, groupEntriesByYear } from "./calculations";
import type { CategoryDataset, ChartInstance } from "./types";

export interface ReportData {
  pageTitle: string;
  categoryName: string;
  latestDate: string;
  latestValue: number;
  prevValue?: number;
  delta?: number;
  currentMonthName?: string;
  currentMonthConsumption?: number;
  prevMonthConsumption?: number;
  monthGrowthPct?: number;
  forecastMonthTotal?: number;
  yearGrowth?: number;
  currentYear?: string;
}

export function buildCategoryReportData(
  pageTitle: string,
  ds: CategoryDataset,
): ReportData | null {
  const sorted = [...ds.entries]
    .filter((e) => e.date && Number.isFinite(Number(e.value)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!sorted.length) return null;

  const latest = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
  const delta = prev !== undefined ? latest.value - prev.value : undefined;

  const currentYear = latest.date.slice(0, 4);
  const yearGroups = groupEntriesByYear(sorted);
  const thisYearEntries = yearGroups[currentYear] || [];
  let yearGrowth: number | undefined;
  if (thisYearEntries.length > 0) {
    yearGrowth = latest.value - thisYearEntries[0].value;
  }

  const forecast = getActiveMonthForecast(sorted);

  return {
    pageTitle,
    categoryName: ds.name,
    latestDate: latest.date,
    latestValue: latest.value,
    prevValue: prev?.value,
    delta,
    currentMonthName: forecast?.activeMonth,
    currentMonthConsumption: forecast
      ? Math.round((forecast.lastValue - forecast.valueAtMonthStart) * 10) / 10
      : undefined,
    forecastMonthTotal: forecast
      ? Math.round(forecast.predictedMonth * 10) / 10
      : undefined,
    yearGrowth:
      yearGrowth !== undefined ? Math.round(yearGrowth * 10) / 10 : undefined,
    currentYear,
  };
}

export function formatReportText(data: ReportData): string {
  const lines: string[] = [
    `📊 <b>${data.pageTitle} — ${data.categoryName}</b>`,
    `📅 <b>Дата:</b> ${data.latestDate}`,
    `🔢 <b>Останній показ:</b> ${data.latestValue}${data.delta !== undefined ? ` (Δ: ${data.delta >= 0 ? "+" : ""}${Math.round(data.delta * 10) / 10})` : ""}`,
  ];

  if (data.currentMonthConsumption !== undefined) {
    let monthLine = `⚡ <b>Поточний місяць:</b> ~${data.currentMonthConsumption} од.`;
    if (data.forecastMonthTotal !== undefined) {
      monthLine += ` (прогноз: ~${data.forecastMonthTotal})`;
    }
    lines.push(monthLine);
  }

  if (data.yearGrowth !== undefined && data.currentYear) {
    lines.push(
      `📈 <b>Споживання за ${data.currentYear} рік:</b> ${data.yearGrowth} од.`,
    );
  }

  return lines.join("\n");
}

export function formatReportPlainText(data: ReportData): string {
  return formatReportText(data).replace(/<[^>]*>/g, "");
}

/**
 * Creates an off-screen canvas with dark styling for crisp, non-transparent PNG export
 */
export function getStyledChartBlob(
  chartInstance: ChartInstance,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const rawBase64 = chartInstance.toBase64Image();
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      // Fill modern dark background so the chart doesn't look transparent in Telegram
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => resolve(blob), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = rawBase64;
  });
}

/**
 * Native share or clipboard copy handler for reports
 */
export async function shareOrCopyReport(
  blob: Blob | null,
  text: string,
  title: string,
): Promise<{
  success: boolean;
  method: "share" | "clipboard" | "download";
  message: string;
}> {
  const plainText = text.replace(/<[^>]*>/g, "");

  // 1. Check Web Share API with files (ideal for mobile / Telegram)
  if (blob && navigator.canShare) {
    const file = new File(
      [blob],
      `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`,
      {
        type: "image/png",
      },
    );
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title,
          text: plainText,
          files: [file],
        });
        return {
          success: true,
          method: "share",
          message: "Успішно надіслано!",
        };
      } catch (err: unknown) {
        // User cancelled share dialog or it failed
        if ((err as Error)?.name === "AbortError") {
          return {
            success: false,
            method: "share",
            message: "Надсилання скасовано",
          };
        }
      }
    }
  }

  // 2. Clipboard API: Copy image or text
  if (navigator.clipboard && blob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob,
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
      return {
        success: true,
        method: "clipboard",
        message: "Графік та текст скопійовано! Вставте (Ctrl+V) у Telegram.",
      };
    } catch {
      // Fallback: Copy only text if image clipboard rejected
      try {
        await navigator.clipboard.writeText(plainText);
        return {
          success: true,
          method: "clipboard",
          message: "Текст звіту скопійовано до буфера обміну!",
        };
      } catch {
        // Fallback to text area copy
      }
    }
  }

  return {
    success: false,
    method: "download",
    message:
      "Не вдалося автоматично скопіювати. Ви можете скопіювати текст вручну.",
  };
}
