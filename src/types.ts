export interface ReadingEntry {
  date: string;
  value: number;
  supplier?: string;
}

export interface EffectiveReadingEntry extends ReadingEntry {
  effectiveSupplier: string;
}

export interface SupplierPeriodSummary {
  supplier: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  totalConsumption: number;
  color: string;
}

export interface ComparisonItem {
  year: string;
  mmdd: string;
}

export interface ComparisonData {
  currentDate: string;
  items: ComparisonItem[];
}

export interface ChartInstance {
  destroy: () => void;
  toBase64Image: () => string;
  update?: (mode?: any) => void;
}

export interface CategoryDataset {
  name: string;
  entries: ReadingEntry[];
  chart?: ChartInstance | null;
  barCharts?: Record<string, ChartInstance>;
  collapsed?: boolean;
  _comparisons?: ComparisonData | null;
}

export interface ActiveForecast {
  activeYear: string;
  activeMonthIdx: number;
  activeMonth: string;
  monthStartStr: string;
  monthEndStr: string;
  monthDays: number;
  elapsedDays: number;
  valueAtMonthStart: number;
  lastDateStr: string;
  lastValue: number;
  predictedMonth: number;
  predictedEndValue: number;
}

export interface Point2D {
  x: string;
  y: number;
}
