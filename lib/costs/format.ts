import { minorToSafeNumber } from "@/lib/costs/money";

const GBP_FORMATTER = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMarkedGbp(minor: bigint | number): string {
  const amount = typeof minor === "bigint" ? minorToSafeNumber(minor) : minor;
  const formatted = GBP_FORMATTER.format(Math.abs(amount) / 100);
  return amount < 0 ? `-${formatted}` : formatted;
}

export function formatInvoiceRequestLabel(minor: bigint | number): string {
  return `Request an invoice for ${formatMarkedGbp(minor)}`;
}
