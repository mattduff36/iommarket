import { parseDecimalString } from "@/lib/costs/money";

export interface MarketplaceImportLine {
  invoiceId: string;
  lineId: string;
  nativeAmount: string;
  nativeCurrency: "USD";
  periodStart: Date;
  periodEnd: Date;
  serviceName: string;
}

export interface FocusCoverageLine {
  nativeAmount: string;
  periodStart: Date;
  periodEnd: Date;
  serviceName: string;
}

export function marketplaceImportBucketKey(line: Pick<MarketplaceImportLine, "invoiceId" | "lineId">): string {
  return `manual:supabase:${line.invoiceId}:${line.lineId}`;
}

function sameAmount(left: string, right: string): boolean {
  const a = parseDecimalString(left);
  const b = parseDecimalString(right);
  const scale = Math.max(a.scale, b.scale);
  const leftUnscaled = a.unscaled * BigInt(10) ** BigInt(scale - a.scale);
  const rightUnscaled = b.unscaled * BigInt(10) ** BigInt(scale - b.scale);
  return leftUnscaled === rightUnscaled;
}

function overlaps(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart.getTime() < rightEnd.getTime() && rightStart.getTime() < leftEnd.getTime();
}

export function focusCoversMarketplaceLine(
  line: MarketplaceImportLine,
  focusRows: readonly FocusCoverageLine[],
): boolean {
  const service = line.serviceName.toLowerCase();
  return focusRows.some((row) => {
    const name = row.serviceName.toLowerCase();
    const supabase = service.includes("supabase") || name.includes("supabase");
    return (
      supabase &&
      sameAmount(line.nativeAmount, row.nativeAmount) &&
      overlaps(line.periodStart, line.periodEnd, row.periodStart, row.periodEnd)
    );
  });
}
