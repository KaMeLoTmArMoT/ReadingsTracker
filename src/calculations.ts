import type { ActiveForecast, Point2D, ReadingEntry } from "./types";

export function toUTCDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function yyyymm(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function fmtYMD(y: number, m1: number, d: number): string {
  const mm = String(m1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

export function daysBetweenUTC(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86400000;
}

export function allocateByMonth(
  startUTC: Date,
  endUTC: Date,
  amount: number,
  outMonthTotals: Record<string, number>,
): void {
  const totalDays = daysBetweenUTC(startUTC, endUTC);
  if (!(totalDays > 0)) return;

  let cursor = new Date(startUTC.getTime());

  while (cursor < endUTC) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();

    const monthStart = new Date(Date.UTC(y, m, 1));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1));

    const segStart = cursor > monthStart ? cursor : monthStart;
    const segEnd = endUTC < nextMonthStart ? endUTC : nextMonthStart;

    const segDays = daysBetweenUTC(segStart, segEnd);
    if (segDays > 0) {
      const key = yyyymm(segStart);
      outMonthTotals[key] =
        (outMonthTotals[key] || 0) + amount * (segDays / totalDays);
    }

    cursor = nextMonthStart;
  }
}

export function interpolateValueAt(
  targetDateUTC: Date,
  leftEntry: ReadingEntry,
  rightEntry: ReadingEntry,
): number {
  const a = toUTCDate(leftEntry.date);
  const b = toUTCDate(rightEntry.date);
  const t = targetDateUTC;

  const totalDays = daysBetweenUTC(a, b);
  const leftDays = daysBetweenUTC(a, t);
  if (!(totalDays > 0) || leftDays < 0) return leftEntry.value;

  const rate = (rightEntry.value - leftEntry.value) / totalDays;
  return leftEntry.value + rate * leftDays;
}

export function getActiveMonthForecast(
  sorted: ReadingEntry[],
): ActiveForecast | null {
  if (!sorted?.length) return null;

  const last = sorted[sorted.length - 1];
  const lastUTC = toUTCDate(last.date);

  const activeYear = lastUTC.getUTCFullYear();
  const activeMonthIdx = lastUTC.getUTCMonth();
  const activeMonth = String(activeMonthIdx + 1).padStart(2, "0");

  const monthStartUTC = new Date(Date.UTC(activeYear, activeMonthIdx, 1));
  const nextMonthStartUTC = new Date(
    Date.UTC(activeYear, activeMonthIdx + 1, 1),
  );
  const monthDays = Math.round(
    daysBetweenUTC(monthStartUTC, nextMonthStartUTC),
  );

  const elapsedDays = Math.max(
    1,
    Math.floor(daysBetweenUTC(monthStartUTC, lastUTC) + 1),
  );

  const monthStartStr = fmtYMD(activeYear, activeMonthIdx + 1, 1);
  const direct = sorted.find((e) => e.date === monthStartStr);
  let valueAtMonthStart: number | null = null;

  if (direct) {
    valueAtMonthStart = Number(direct.value);
  } else {
    let prev: ReadingEntry | null = null;
    let next: ReadingEntry | null = null;

    for (let i = 0; i < sorted.length; i++) {
      const d = toUTCDate(sorted[i].date);
      if (d < monthStartUTC) prev = sorted[i];
      if (d > monthStartUTC) {
        next = sorted[i];
        break;
      }
      if (d.getTime() === monthStartUTC.getTime()) {
        next = sorted[i];
        break;
      }
    }

    if (
      prev &&
      next &&
      toUTCDate(prev.date) < monthStartUTC &&
      toUTCDate(next.date) > monthStartUTC
    ) {
      valueAtMonthStart = interpolateValueAt(monthStartUTC, prev, next);
    }
  }

  if (valueAtMonthStart === null || !Number.isFinite(valueAtMonthStart))
    return null;

  const consumedSoFar = Number(last.value) - Number(valueAtMonthStart);
  if (!Number.isFinite(consumedSoFar) || consumedSoFar <= 0) return null;

  const predictedMonth = (consumedSoFar / elapsedDays) * monthDays;

  const monthEndUTC = new Date(Date.UTC(activeYear, activeMonthIdx + 1, 0));
  const monthEndStr = fmtYMD(
    activeYear,
    activeMonthIdx + 1,
    monthEndUTC.getUTCDate(),
  );

  if (lastUTC.getTime() >= monthEndUTC.getTime()) return null;

  return {
    activeYear: String(activeYear),
    activeMonthIdx,
    activeMonth,
    monthStartStr,
    monthEndStr,
    monthDays,
    elapsedDays,
    valueAtMonthStart,
    lastDateStr: last.date,
    lastValue: Number(last.value),
    predictedMonth,
    predictedEndValue: Number(valueAtMonthStart) + predictedMonth,
  };
}

export function mmddFromRefDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function findDateAtLevel(
  points: Point2D[],
  targetY: number,
): Date | null {
  if (!points?.length || !Number.isFinite(targetY)) return null;

  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const yy = Number(p.y);
    if (Number.isFinite(yy)) maxY = Math.max(maxY, yy);
  }
  if (!(maxY >= targetY)) return null;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const ya = Number(a.y);
    const yb = Number(b.y);
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;

    if (ya === targetY) return new Date(a.x);
    if (yb === targetY) return new Date(b.x);

    const crosses =
      (ya < targetY && yb > targetY) || (ya > targetY && yb < targetY);
    if (!crosses) continue;

    const denom = yb - ya;
    if (denom === 0) continue;

    const t = (targetY - ya) / denom;
    const ax = new Date(a.x).getTime();
    const bx = new Date(b.x).getTime();
    const x = ax + t * (bx - ax);
    return new Date(x);
  }

  return null;
}

export function addSyntheticDec31ForClosedYears(
  yearGroups: Record<string, ReadingEntry[]>,
  yearsSortedAsc: string[],
): void {
  for (let idx = 0; idx < yearsSortedAsc.length - 1; idx++) {
    const year = yearsSortedAsc[idx];
    const nextYear = yearsSortedAsc[idx + 1];

    const list = yearGroups[year];
    const nextList = yearGroups[nextYear];
    if (!list?.length || !nextList?.length) continue;

    const hasDec31 = list.some((e) => String(e.date).endsWith("-12-31"));
    if (hasDec31) continue;

    const lastThis = list[list.length - 1];
    const firstNext = nextList[0];

    const dec31UTC = new Date(Date.UTC(Number(year), 11, 31));
    const lastThisUTC = toUTCDate(lastThis.date);
    const firstNextUTC = toUTCDate(firstNext.date);

    if (lastThisUTC < dec31UTC && firstNextUTC > dec31UTC) {
      const syntheticValue = interpolateValueAt(dec31UTC, lastThis, firstNext);
      yearGroups[year] = [
        ...list,
        { date: `${year}-12-31`, value: syntheticValue },
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
  }
}
