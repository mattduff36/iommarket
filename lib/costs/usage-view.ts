import { COST_SECTION_LABELS } from "@/lib/costs/dto";
import { formatMarkedGbp } from "@/lib/costs/format";
import type { CostLineDto } from "@/lib/costs/dto";

export const COST_USAGE_PAGE_SIZE = 10;

export const COST_USAGE_RANGES = [
  "7d",
  "30d",
  "mtd",
  "last-month",
  "all",
] as const;

export type CostUsageRange = (typeof COST_USAGE_RANGES)[number];

export const COST_USAGE_RANGE_LABELS: Record<CostUsageRange, string> = {
  "7d": "7d",
  "30d": "30d",
  mtd: "MTD",
  "last-month": "Last month",
  all: "All",
};

export const COST_USAGE_CURSOR_SERIES = COST_SECTION_LABELS.CURSOR;
export const COST_MINIMUM_DISPLAY_MINOR = 1;

const SERIES_ORDER = [
  COST_USAGE_CURSOR_SERIES,
  COST_SECTION_LABELS.VERCEL_HOSTING,
  COST_SECTION_LABELS.DATABASE,
  COST_SECTION_LABELS.OTHER,
] as const;

export const COST_USAGE_SERIES_COLORS: Record<string, string> = {
  [COST_USAGE_CURSOR_SERIES]: "#0085FF",
  [COST_SECTION_LABELS.VERCEL_HOSTING]: "#C5A059",
  [COST_SECTION_LABELS.DATABASE]: "#10B981",
  [COST_SECTION_LABELS.OTHER]: "#636366",
};

export interface CostUsageDayPoint {
  day: string;
  label: string;
  daily: Record<string, number>;
  cumulative: Record<string, number | null>;
  invoicedPence?: number | null;
  remainingToInvoicePence?: number | null;
}

export interface CostBillingDisplayPoint {
  day: string;
  invoicedPence: number | null;
  remainingToInvoicePence: number | null;
}

/** Sanitized invoice history. Monetary values are supplied, never recalculated here. */
export interface CostBillingDisplay {
  invoicesAvailable: boolean;
  asOf: string;
  history: CostBillingDisplayPoint[];
}

export interface CostUsageModel {
  range: CostUsageRange;
  fromDay: string | null;
  toDay: string | null;
  rangeLabel: string;
  seriesKeys: string[];
  chartSeriesKeys: string[];
  series: Array<{ key: string; amountMinor: number; amountLabel: string }>;
  points: CostUsageDayPoint[];
  filteredLines: CostLineDto[];
  billingApplied: boolean;
  invoicesAvailable: boolean;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface CostSummaryLine extends CostLineDto {
  sourceCount: number;
}

function summaryIdentity(line: CostLineDto): {
  key: string;
  label: string;
} {
  const startDay = utcDay(new Date(line.periodStart));
  const endDay = utcDay(new Date(line.periodEnd));
  const label = line.category === "CURSOR" ? "Development usage" : line.label;
  return {
    key: [
      line.category,
      line.invoiceability,
      startDay,
      line.category === "CURSOR" ? "" : endDay,
      label,
    ].join("|"),
    label,
  };
}

export function summarizeCostLines(lines: CostLineDto[]): CostSummaryLine[] {
  const groups = new Map<string, CostSummaryLine>();

  for (const line of lines) {
    const identity = summaryIdentity(line);
    const current = groups.get(identity.key);
    if (current) {
      const amountMinor = current.amountMinor + line.amountMinor;
      groups.set(identity.key, {
        ...current,
        amountMinor,
        amountLabel: formatMarkedGbp(amountMinor),
        sourceCount: current.sourceCount + 1,
      });
      continue;
    }

    groups.set(identity.key, {
      ...line,
      id: `summary:${identity.key}`,
      label: identity.label,
      kind: "CHARGE",
      sourceCount: 1,
    });
  }

  return [...groups.values()].filter(
    (line) => Math.abs(line.amountMinor) >= COST_MINIMUM_DISPLAY_MINOR,
  );
}

function parseUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function addUtcDays(day: string, amount: number): string {
  const date = parseUtcDay(day);
  date.setUTCDate(date.getUTCDate() + amount);
  return utcDay(date);
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function formatDayLabel(day: string): string {
  const date = parseUtcDay(day);
  return `${date.getUTCDate()} ${MONTH_LABELS[date.getUTCMonth()]}`;
}

export function lineSeriesKey(line: CostLineDto): string {
  if (line.category === "CURSOR") return COST_USAGE_CURSOR_SERIES;
  if (line.category === "SHARED_VERCEL") {
    return COST_SECTION_LABELS.VERCEL_HOSTING;
  }
  if (line.category === "OTHER") return line.section || COST_SECTION_LABELS.OTHER;
  return COST_SECTION_LABELS[line.category];
}

const MANUAL_SERIES_COLORS = ["#F59E0B", "#EC4899", "#14B8A6", "#8B5CF6", "#F97316", "#06B6D4"];

export function costSeriesColor(key: string, index = 0): string {
  return COST_USAGE_SERIES_COLORS[key] ?? MANUAL_SERIES_COLORS[index % MANUAL_SERIES_COLORS.length] ?? "#8E8E93";
}

export function usageRangeBounds(
  range: CostUsageRange,
  now: Date,
  lineDays: string[],
): { fromDay: string; toDay: string } | null {
  const today = utcDay(now);
  if (range === "7d") return { fromDay: addUtcDays(today, -6), toDay: today };
  if (range === "30d") return { fromDay: addUtcDays(today, -29), toDay: today };
  if (range === "mtd") return { fromDay: `${today.slice(0, 8)}01`, toDay: today };
  if (range === "last-month") {
    const firstThisMonth = parseUtcDay(`${today.slice(0, 8)}01`);
    const lastPrev = new Date(firstThisMonth);
    lastPrev.setUTCDate(0);
    const lastPrevDay = utcDay(lastPrev);
    return { fromDay: `${lastPrevDay.slice(0, 8)}01`, toDay: lastPrevDay };
  }
  if (lineDays.length === 0) return null;
  const sorted = [...lineDays].sort();
  return {
    fromDay: sorted[0] ?? today,
    toDay: sorted[sorted.length - 1] ?? today,
  };
}

function daysInRange(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  for (let day = fromDay; day <= toDay; day = addUtcDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function paginateCostLines(lines: CostLineDto[], page: number) {
  const totalPages = Math.max(1, Math.ceil(lines.length / COST_USAGE_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * COST_USAGE_PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    pageLines: lines.slice(start, start + COST_USAGE_PAGE_SIZE),
  };
}

export function toCostBillingDisplay(input: {
  invoicedPence: number | null;
  asOf: string;
  history: readonly {
    day: string;
    invoicedPence: number;
    remainingToInvoicePence: number | null;
  }[];
}): CostBillingDisplay {
  const invoicesAvailable = input.invoicedPence !== null;
  return {
    invoicesAvailable,
    asOf: input.asOf,
    history: input.history.map((point) => ({
      day: point.day,
      invoicedPence: invoicesAvailable ? point.invoicedPence : null,
      remainingToInvoicePence: point.remainingToInvoicePence,
    })),
  };
}

export function costBillingHasPlot(billing: CostBillingDisplay): boolean {
  return billing.history.some((point) =>
    (billing.invoicesAvailable && point.invoicedPence !== null)
    || point.remainingToInvoicePence !== null,
  );
}

function calendarDay(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(value);
  if (!match?.[1]) return null;
  const day = match[1];
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10) === day ? day : null;
}

function lineDay(line: CostLineDto): string {
  return utcDay(new Date(line.periodStart));
}

function orderSeriesKeys(keys: readonly string[]): string[] {
  const unique = [...new Set(keys)];
  const head = SERIES_ORDER.filter((key) => unique.includes(key));
  return [...head, ...unique.filter((key) => !head.includes(key))];
}

function billingHistory(
  billing: CostBillingDisplay | undefined,
): { asOfDay: string; byDay: Map<string, CostBillingDisplayPoint> } | null {
  if (!billing) return null;
  const asOfDay = calendarDay(billing.asOf);
  if (!asOfDay) return null;
  const byDay = new Map<string, CostBillingDisplayPoint>();
  for (const point of billing.history) {
    const day = calendarDay(point.day);
    if (!day || day > asOfDay) continue;
    byDay.set(day, { ...point, day });
  }
  return { asOfDay, byDay };
}

function resolveBounds(
  range: CostUsageRange,
  now: Date,
  lineDays: string[],
  billing: { asOfDay: string; byDay: Map<string, CostBillingDisplayPoint> } | null,
): { fromDay: string; toDay: string } | null {
  if (!billing) return usageRangeBounds(range, now, lineDays);
  if (range === "all") {
    const days = [...lineDays, ...billing.byDay.keys()].filter((day) => day <= billing.asOfDay);
    const first = [...days].sort()[0];
    return first ? { fromDay: first, toDay: billing.asOfDay } : null;
  }
  const bounds = usageRangeBounds(range, parseUtcDay(billing.asOfDay), lineDays);
  if (!bounds || bounds.fromDay > billing.asOfDay) return null;
  return {
    fromDay: bounds.fromDay,
    toDay: bounds.toDay <= billing.asOfDay ? bounds.toDay : billing.asOfDay,
  };
}

export function buildCostUsageModel(input: {
  lines: CostLineDto[];
  range: CostUsageRange;
  now?: Date;
  billing?: CostBillingDisplay;
}): CostUsageModel {
  const billed = billingHistory(input.billing);
  const now = input.now ?? new Date();
  const eligible = [...input.lines]
    .filter((line) => !billed || lineDay(line) <= billed.asOfDay)
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart));
  const bounds = resolveBounds(input.range, now, eligible.map(lineDay), billed);
  const filteredLines = bounds
    ? eligible.filter((line) => {
        const day = lineDay(line);
        return day >= bounds.fromDay && day <= bounds.toDay;
      })
    : [];
  const priorLines = billed && bounds
    ? eligible.filter((line) => lineDay(line) < bounds.fromDay)
    : [];
  const seriesKeys = orderSeriesKeys(filteredLines.map(lineSeriesKey));
  const chartSeriesKeys = orderSeriesKeys([
    ...seriesKeys,
    ...priorLines.map(lineSeriesKey),
  ]);
  const days = bounds ? daysInRange(bounds.fromDay, bounds.toDay) : [];
  const dailyByDay = new Map<string, Record<string, number>>(
    days.map((day) => [day, Object.fromEntries(seriesKeys.map((key) => [key, 0]))]),
  );
  for (const line of filteredLines) {
    const current = dailyByDay.get(lineDay(line));
    if (!current) continue;
    const key = lineSeriesKey(line);
    current[key] = (current[key] ?? 0) + line.amountMinor;
  }

  const opening = Object.fromEntries(chartSeriesKeys.map((key) => [key, 0]));
  for (const line of priorLines) {
    const key = lineSeriesKey(line);
    opening[key] = (opening[key] ?? 0) + line.amountMinor;
  }
  const daysWithLines = new Set(filteredLines.map(lineDay));
  let costsKnown = !billed || priorLines.length > 0;
  let running = { ...opening };
  const points = days.map((day) => {
    const daily = dailyByDay.get(day) ?? {};
    if (daysWithLines.has(day)) costsKnown = true;
    if (costsKnown) {
      running = Object.fromEntries(
        chartSeriesKeys.map((key) => [key, (running[key] ?? 0) + (daily[key] ?? 0)]),
      );
    }
    const supplied = billed?.byDay.get(day);
    return {
      day,
      label: formatDayLabel(day),
      daily: { ...daily },
      cumulative: Object.fromEntries(
        chartSeriesKeys.map((key) => [key, costsKnown ? running[key] ?? 0 : null]),
      ),
      invoicedPence: input.billing?.invoicesAvailable ? supplied?.invoicedPence ?? null : null,
      remainingToInvoicePence: billed ? supplied?.remainingToInvoicePence ?? null : null,
    };
  });
  const series = seriesKeys.map((key) => {
    const amountMinor = filteredLines
      .filter((line) => lineSeriesKey(line) === key)
      .reduce((total, line) => total + line.amountMinor, 0);
    return { key, amountMinor, amountLabel: formatMarkedGbp(amountMinor) };
  });

  return {
    range: input.range,
    fromDay: bounds?.fromDay ?? null,
    toDay: bounds?.toDay ?? null,
    rangeLabel: bounds
      ? `${formatDayLabel(bounds.fromDay)} – ${formatDayLabel(bounds.toDay)}`
      : "No usage in this period",
    seriesKeys,
    chartSeriesKeys,
    series,
    points,
    filteredLines,
    billingApplied: Boolean(billed),
    invoicesAvailable: Boolean(billed && input.billing?.invoicesAvailable),
  };
}
