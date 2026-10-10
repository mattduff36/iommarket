export interface SourceCompleteness {
  status: string;
  vehicleCount: number;
  advertisedCount: number | null;
  pagesFetched: number;
  detailMissing: number;
  paginationUncertain: boolean;
}

export function scrapeFailureReason(sources: SourceCompleteness[]) {
  if (sources.length === 0) return "zero-inventory";
  if (sources.some((source) => source.status !== "ok")) return "source-failed";
  if (sources.some((source) => source.paginationUncertain)) return "pagination-uncertain";
  if (sources.some((source) => source.detailMissing > 0)) return "detail-uncertain";
  if (
    sources.some(
      (source) =>
        source.advertisedCount != null && source.vehicleCount < source.advertisedCount,
    )
  ) {
    return "partial-inventory";
  }
  const total = sources.reduce((sum, source) => sum + source.vehicleCount, 0);
  if (total === 0) return "zero-inventory";
  return null;
}
