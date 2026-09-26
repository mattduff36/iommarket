import { CostMoneyError, parseDecimalString, quantizeDecimal } from "@/lib/costs/money";

/** Five decimal places of a cent collapses binary float noise without rounding to whole cents. */
export const PROVIDER_CENT_SCALE = 5;

export function floatToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CostMoneyError("Amount must be finite.");
  }
  const text = Object.is(value, -0) ? "0" : value.toPrecision(15);
  if (/e/i.test(text)) {
    return quantizeDecimal(value.toFixed(12), 12);
  }
  return text;
}

export function normalizeProviderCents(value: number | string): string {
  const decimal = typeof value === "string" ? value.trim() : floatToDecimalString(value);
  return quantizeDecimal(decimal, PROVIDER_CENT_SCALE);
}

export function centsToUsd(cents: string): string {
  const parsed = parseDecimalString(cents);
  const negative = parsed.unscaled < BigInt(0);
  const digits = (negative ? -parsed.unscaled : parsed.unscaled)
    .toString()
    .padStart(parsed.scale + 3, "0");
  const scale = parsed.scale + 2;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  const sign = negative ? "-" : "";
  return `${sign}${whole}.${fraction}`;
}

export function normalizeProviderUsd(cents: number | string): string {
  return centsToUsd(normalizeProviderCents(cents));
}

export function parseDisplayUsd(value: string): string | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed || /included|free/i.test(trimmed)) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return null;
  return quantizeDecimal(trimmed, 8);
}

export function displayReconciles(
  preciseUsd: string,
  display: string | null,
): "matched" | "rounded" | "diverged" | "absent" {
  if (!display) return "absent";
  const precise = quantizeDecimal(preciseUsd, 8);
  const shown = quantizeDecimal(display, 8);
  if (precise === shown) return "matched";
  const preciseCents = parseDecimalString(precise);
  const shownCents = parseDecimalString(shown);
  const scale = Math.max(preciseCents.scale, shownCents.scale);
  const left = preciseCents.unscaled * BigInt(10) ** BigInt(scale - preciseCents.scale);
  const right = shownCents.unscaled * BigInt(10) ** BigInt(scale - shownCents.scale);
  const difference = left > right ? left - right : right - left;
  const oneCent = BigInt(10) ** BigInt(scale - 2);
  return difference <= oneCent ? "rounded" : "diverged";
}
