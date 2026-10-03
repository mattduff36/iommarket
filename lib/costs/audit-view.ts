import type { CostUsageModel } from "./usage-view";

/** Report only ledger charges. Provider cash must never be inferred from these values. */
export function buildCostAuditView(model: CostUsageModel) {
  const composition = model.series.filter((series) => series.amountMinor > 0);
  const positiveTotal = composition.reduce((sum, series) => sum + series.amountMinor, 0);
  const netTotal = model.series.reduce((sum, series) => sum + series.amountMinor, 0);
  const daily = model.points.map((point) => ({
    ...point,
    total: Object.values(point.daily).reduce((sum, value) => sum + value, 0),
  }));
  const rankedDays = daily.filter((point) => point.total > 0)
    .sort((a, b) => b.total - a.total || a.day.localeCompare(b.day)).slice(0, 7);
  return { composition, positiveTotal, netTotal, daily, rankedDays,
    negativeCategories: model.series.filter((series) => series.amountMinor < 0),
    provisionalTotal: model.filteredLines.filter((line) => line.provisional)
      .reduce((sum, line) => sum + line.amountMinor, 0),
  };
}
