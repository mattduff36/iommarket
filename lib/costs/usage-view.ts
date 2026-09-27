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

const SERIES_ORDER = [
  "Included",
  "On-demand",
  COST_SECTION_LABELS.CURSOR,
  COST_SECTION_LABELS.VERCEL_HOSTING,
  COST_SECTION_LABELS.DATABASE,
  "Provisional Shared Hosting",
  COST_SECTION_LABELS.SHARED_VERCEL,
  COST_SECTION_LABELS.OTHER,
] as const;

export const COST_USAGE_SERIES_COLORS: Record<string, string> = {
  Included: "#0085FF",
  "On-demand": "#FF1F1F",
  [COST_SECTION_LABELS.CURSOR]: "#33A3FF",
  [COST_SECTION_LABELS.VERCEL_HOSTING]: "#C5A059",
  [COST_SECTION_LABELS.DATABASE]: "#10B981",
  "Provisional Shared Hosting": "#8E8E93",
  [COST_SECTION_LABELS.SHARED_VERCEL]: "#8E8E93",
  [COST_SECTION_LABELS.OTHER]: "#636366",
};

export interface CostUsageDayPoint {
  day: string;
  label: string;
  daily: Record<string, number>;
  cumulative: Record<string, number>;
}

export interface CostUsageModel {
  range: CostUsageRange;
  fromDay: string | null;
  toDay: string | null;
  rangeLabel: string;
  seriesKeys: string[];
  points: CostUsageDayPoint[];
  totalLabel: string;
  includedLabel: string;
  onDemandLabel: string;
  infrastructureLabel: string;
  filteredLines: CostLineDto[];
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
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
  if (line.category === "CURSOR") {
    if (/\bincluded\b/i.test(line.label)) return "Included";
    if (/\bon-demand\b/i.test(line.label)) return "On-demand";
    return COST_SECTION_LABELS.CURSOR;
  }
  return line.section;
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

export function buildCostUsageModel(input: {
  lines: CostLineDto[];
  range: CostUsageRange;
  now?: Date;
}): CostUsageModel {
  const now = input.now ?? new Date();
  const newestFirst = [...input.lines].sort((left, right) =>
    right.periodStart.localeCompare(left.periodStart),
  );
  const lineDays = newestFirst.map((line) => utcDay(new Date(line.periodStart)));
  const bounds = usageRangeBounds(input.range, now, lineDays);
  const filteredLines = bounds
    ? newestFirst.filter((line) => {
        const day = utcDay(new Date(line.periodStart));
        return day >= bounds.fromDay && day <= bounds.toDay;
      })
    : [];
  const seriesKeys = SERIES_ORDER.filter((key) =>
    filteredLines.some((line) => lineSeriesKey(line) === key),
  );
  const days = bounds ? daysInRange(bounds.fromDay, bounds.toDay) : [];
  const dailyByDay = new Map<string, Record<string, number>>();
  for (const day of days) {
    dailyByDay.set(day, Object.fromEntries(seriesKeys.map((key) => [key, 0])));
  }
  for (const line of filteredLines) {
    const day = utcDay(new Date(line.periodStart));
    const current = dailyByDay.get(day);
    if (!current) continue;
    const key = lineSeriesKey(line);
    current[key] = (current[key] ?? 0) + line.amountMinor;
  }

  const running: Record<string, number> = Object.fromEntries(
    seriesKeys.map((key) => [key, 0]),
  );
  const points = days.map((day) => {
    const daily = dailyByDay.get(day) ?? {};
    for (const key of seriesKeys) {
      running[key] = (running[key] ?? 0) + (daily[key] ?? 0);
    }
    return {
      day,
      label: formatDayLabel(day),
      daily: { ...daily },
      cumulative: { ...running },
    };
  });

  const includedMinor = filteredLines
    .filter((line) => lineSeriesKey(line) === "Included")
    .reduce((total, line) => total + line.amountMinor, 0);
  const onDemandMinor = filteredLines
    .filter((line) => lineSeriesKey(line) === "On-demand")
    .reduce((total, line) => total + line.amountMinor, 0);
  const infrastructureMinor = filteredLines
    .filter((line) => line.category !== "CURSOR")
    .reduce((total, line) => total + line.amountMinor, 0);
  const totalMinor = filteredLines.reduce((total, line) => total + line.amountMinor, 0);

  return {
    range: input.range,
    fromDay: bounds?.fromDay ?? null,
    toDay: bounds?.toDay ?? null,
    rangeLabel: bounds
      ? `${formatDayLabel(bounds.fromDay)} – ${formatDayLabel(bounds.toDay)}`
      : "No usage in this period",
    seriesKeys,
    points,
    totalLabel: formatMarkedGbp(totalMinor),
    includedLabel: formatMarkedGbp(includedMinor),
    onDemandLabel: formatMarkedGbp(onDemandMinor),
    infrastructureLabel: formatMarkedGbp(infrastructureMinor),
    filteredLines,
  };
}
