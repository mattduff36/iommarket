import { createHash } from "node:crypto";
import { allowlistedFocusTags } from "@/lib/costs/privacy";

export const FOCUS_REQUIRED_FIELDS = [
  "BilledCost",
  "BillingCurrency",
  "ChargeCategory",
  "ChargePeriodStart",
  "ChargePeriodEnd",
  "ServiceName",
  "ServiceProviderName",
  "Tags",
] as const;

export type FocusChargeCategory =
  | "Adjustment"
  | "Credit"
  | "Purchase"
  | "Tax"
  | "Usage";

export interface FocusChargeRow {
  BilledCost: number;
  BilledCostText?: string;
  BillingCurrency: string;
  ChargeCategory: FocusChargeCategory | string;
  ChargePeriodStart: string;
  ChargePeriodEnd: string;
  ConsumedQuantity: number | null;
  ConsumedUnit: string | null;
  EffectiveCost: number | null;
  RegionId: string | null;
  RegionName: string | null;
  ServiceName: string;
  ServiceCategory: string | null;
  ServiceProviderName: string;
  Tags: Record<string, string>;
  PricingCategory: string | null;
  PricingCurrency: string | null;
  PricingQuantity: number | null;
  PricingUnit: string | null;
}

export type ParsedFocusLine =
  | { ok: true; row: FocusChargeRow; rawIndex: number }
  | { ok: false; reason: string; rawIndex: number };

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

export function extractJsonDecimal(line: string, field: string): string | null {
  const match = line.match(
    new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`),
  );
  if (!match) return null;
  return normalizeScientificDecimal(match[1]);
}

export function normalizeScientificDecimal(value: string): string {
  if (!/[eE]/.test(value)) return value;
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) {
    throw new Error("Invalid scientific decimal.");
  }
  const sign = match[1];
  const digits = `${match[2]}${match[3] ?? ""}`;
  const fractionLength = (match[3] ?? "").length;
  const exponent = Number(match[4]);
  const scale = fractionLength - exponent;
  if (scale <= 0) {
    return `${sign}${digits}${"0".repeat(-scale)}`;
  }
  const padded = digits.padStart(scale + 1, "0");
  return `${sign}${padded.slice(0, -scale) || "0"}.${padded.slice(-scale)}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseFocusRow(value: unknown): FocusChargeRow | { reason: string } {
  if (!value || typeof value !== "object") {
    return { reason: "Row is not an object." };
  }

  const record = value as Record<string, unknown>;
  for (const field of FOCUS_REQUIRED_FIELDS) {
    if (!(field in record)) {
      return { reason: `Missing required field ${field}.` };
    }
  }

  const billedCost = asNumber(record.BilledCost);
  if (billedCost === null) {
    return { reason: "BilledCost must be a finite number." };
  }

  const periodStart = asString(record.ChargePeriodStart);
  const periodEnd = asString(record.ChargePeriodEnd);
  const serviceName = asString(record.ServiceName);
  const providerName = asString(record.ServiceProviderName);
  const currency = asString(record.BillingCurrency);
  const chargeCategory = asString(record.ChargeCategory);
  if (!periodStart || !periodEnd || !serviceName || !providerName || !currency || !chargeCategory) {
    return { reason: "Required string fields are empty." };
  }

  const tags =
    record.Tags && typeof record.Tags === "object" && !Array.isArray(record.Tags)
      ? allowlistedFocusTags(record.Tags as Record<string, unknown>)
      : null;
  if (tags === null) {
    return { reason: "Tags must be an object." };
  }

  return {
    BilledCost: billedCost,
    BillingCurrency: currency,
    ChargeCategory: chargeCategory,
    ChargePeriodStart: periodStart,
    ChargePeriodEnd: periodEnd,
    ConsumedQuantity: asNumber(record.ConsumedQuantity),
    ConsumedUnit: asString(record.ConsumedUnit),
    EffectiveCost: asNumber(record.EffectiveCost),
    RegionId: asString(record.RegionId),
    RegionName: asString(record.RegionName),
    ServiceName: serviceName,
    ServiceCategory: asString(record.ServiceCategory),
    ServiceProviderName: providerName,
    Tags: tags,
    PricingCategory: asString(record.PricingCategory),
    PricingCurrency: asString(record.PricingCurrency),
    PricingQuantity: asNumber(record.PricingQuantity),
    PricingUnit: asString(record.PricingUnit),
  };
}

export function parseFocusJsonl(text: string): ParsedFocusLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, rawIndex) => {
      try {
        const billedCost = extractJsonDecimal(line, "BilledCost");
        if (!billedCost) {
          return { ok: false, reason: "BilledCost must be a decimal number.", rawIndex };
        }
        const parsed = parseFocusRow(JSON.parse(line));
        if ("reason" in parsed) {
          return { ok: false, reason: parsed.reason, rawIndex };
        }
        return {
          ok: true,
          row: { ...parsed, BilledCostText: billedCost },
          rawIndex,
        };
      } catch {
        return { ok: false, reason: "Malformed JSONL line.", rawIndex };
      }
    });
}

export function billedCostToDecimalString(row: FocusChargeRow): string {
  if (row.BilledCostText) return row.BilledCostText;
  if (!Number.isFinite(row.BilledCost)) {
    throw new Error("BilledCost is not finite.");
  }
  return row.BilledCost.toString();
}

export function focusRowChecksum(row: FocusChargeRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        BilledCost: row.BilledCostText ?? row.BilledCost,
        BillingCurrency: row.BillingCurrency,
        ChargeCategory: row.ChargeCategory,
        ChargePeriodStart: row.ChargePeriodStart,
        ChargePeriodEnd: row.ChargePeriodEnd,
        ServiceName: row.ServiceName,
        ServiceProviderName: row.ServiceProviderName,
        Tags: row.Tags,
      }),
    )
    .digest("hex");
}
