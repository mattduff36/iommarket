import { createHash } from "node:crypto";
import type { CostCategory, CostInvoiceability } from "@prisma/client";
import { isPeriodClosed } from "@/lib/costs/dates";
import {
  billedCostToDecimalString,
  focusRowChecksum,
  type FocusChargeRow,
} from "@/lib/costs/focus";
import { addDecimalStrings } from "@/lib/costs/money";

export type ClassifiedCostKind = "hosting" | "database" | "shared" | "ignored";

export interface ClassifiedFocusCharge {
  kind: ClassifiedCostKind;
  category: CostCategory | null;
  invoiceability: CostInvoiceability | null;
  bucketKey: string;
  checksum: string;
  nativeAmount: string;
  nativeCurrency: string;
  periodStart: Date;
  periodEnd: Date;
  displayLabel: string;
  row: FocusChargeRow;
}

export interface QuarantinedFocusCharge {
  reason: string;
  rawIndex?: number;
  row?: FocusChargeRow;
}

export interface FocusClassificationConfig {
  projectId: string;
  databaseResourceId: string;
  now?: Date;
}

function tagValue(row: FocusChargeRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row.Tags[key];
    if (value) return value;
  }
  return null;
}

function resourceId(row: FocusChargeRow): string | null {
  return tagValue(row, ["ResourceId", "resourceId", "StoreId", "storeId", "integrationResourceId"]);
}

function projectId(row: FocusChargeRow): string | null {
  return tagValue(row, ["ProjectId", "projectId"]);
}

export function buildFocusBucketKey(input: {
  category: CostCategory;
  identity: string;
  row: FocusChargeRow;
}): string {
  return [
    "vercel",
    input.category,
    input.identity,
    input.row.ServiceName,
    input.row.ServiceCategory ?? "",
    input.row.ChargeCategory,
    input.row.PricingCategory ?? "",
    input.row.PricingUnit ?? "",
    input.row.ConsumedUnit ?? "",
    input.row.RegionId ?? "",
    input.row.ChargePeriodStart,
    input.row.ChargePeriodEnd,
  ].join(":");
}

export function classifyFocusRow(
  row: FocusChargeRow,
  config: FocusClassificationConfig,
): ClassifiedFocusCharge | QuarantinedFocusCharge {
  if (row.BillingCurrency !== "USD") {
    return { reason: "Unsupported billing currency.", row };
  }

  const periodStart = new Date(row.ChargePeriodStart);
  const periodEnd = new Date(row.ChargePeriodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return { reason: "Invalid charge period.", row };
  }

  const now = config.now ?? new Date();
  const nativeAmount = billedCostToDecimalString(row);
  const checksum = focusRowChecksum(row);
  const matchedResourceId = resourceId(row);
  const matchedProjectId = projectId(row);

  if (matchedResourceId && matchedResourceId === config.databaseResourceId) {
    return {
      kind: "database",
      category: "DATABASE",
      invoiceability: "INVOICEABLE",
      bucketKey: buildFocusBucketKey({
        category: "DATABASE",
        identity: matchedResourceId,
        row,
      }),
      checksum,
      nativeAmount,
      nativeCurrency: "USD",
      periodStart,
      periodEnd,
      displayLabel: row.ServiceName,
      row,
    };
  }

  if (matchedResourceId && matchedResourceId !== config.databaseResourceId) {
    return {
      kind: "ignored",
      category: null,
      invoiceability: null,
      bucketKey: "",
      checksum,
      nativeAmount,
      nativeCurrency: "USD",
      periodStart,
      periodEnd,
      displayLabel: row.ServiceName,
      row,
    };
  }

  if (matchedProjectId && matchedProjectId === config.projectId) {
    return {
      kind: "hosting",
      category: "VERCEL_HOSTING",
      invoiceability: "INVOICEABLE",
      bucketKey: buildFocusBucketKey({
        category: "VERCEL_HOSTING",
        identity: matchedProjectId,
        row,
      }),
      checksum,
      nativeAmount,
      nativeCurrency: "USD",
      periodStart,
      periodEnd,
      displayLabel: row.ServiceName,
      row,
    };
  }

  if (matchedProjectId && matchedProjectId !== config.projectId) {
    return {
      kind: "ignored",
      category: null,
      invoiceability: null,
      bucketKey: "",
      checksum,
      nativeAmount,
      nativeCurrency: "USD",
      periodStart,
      periodEnd,
      displayLabel: row.ServiceName,
      row,
    };
  }

  if (!matchedProjectId && !matchedResourceId) {
    return {
      kind: "shared",
      category: "SHARED_VERCEL",
      invoiceability: isPeriodClosed(periodEnd, now) ? "INVOICEABLE" : "PROVISIONAL",
      bucketKey: buildFocusBucketKey({
        category: "SHARED_VERCEL",
        identity: "shared",
        row,
      }),
      checksum,
      nativeAmount,
      nativeCurrency: "USD",
      periodStart,
      periodEnd,
      displayLabel: row.ServiceName,
      row,
    };
  }

  return { reason: "Unclassifiable FOCUS charge.", row };
}

export function classifyFocusRows(
  rows: Array<{ row: FocusChargeRow; rawIndex: number }>,
  config: FocusClassificationConfig,
): {
  classified: ClassifiedFocusCharge[];
  quarantined: QuarantinedFocusCharge[];
  ignored: ClassifiedFocusCharge[];
} {
  const classified: ClassifiedFocusCharge[] = [];
  const quarantined: QuarantinedFocusCharge[] = [];
  const ignored: ClassifiedFocusCharge[] = [];

  for (const item of rows) {
    const result = classifyFocusRow(item.row, config);
    if ("reason" in result) {
      quarantined.push({ ...result, rawIndex: item.rawIndex });
      continue;
    }
    if (result.kind === "ignored") {
      ignored.push(result);
      continue;
    }
    classified.push(result);
  }

  return { classified, quarantined, ignored };
}

export function aggregateClassifiedCharges(
  charges: ClassifiedFocusCharge[],
): ClassifiedFocusCharge[] {
  const groups = new Map<string, ClassifiedFocusCharge[]>();
  for (const charge of charges) {
    const current = groups.get(charge.bucketKey) ?? [];
    current.push(charge);
    groups.set(charge.bucketKey, current);
  }

  return [...groups.entries()].map(([, group]) => {
    if (group.length === 1) return group[0];
    const nativeAmount = addDecimalStrings(group.map((item) => item.nativeAmount));
    return {
      ...group[0],
      nativeAmount,
      checksum: createHash("sha256")
        .update(group.map((item) => item.checksum).sort().join(":"))
        .digest("hex"),
    };
  });
}

export function sharedMembershipChecksum(
  chargeChecksum: string,
  projectIds: string[],
  invoiceability: CostInvoiceability,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        chargeChecksum,
        projectIds: [...projectIds].sort(),
        invoiceability,
      }),
    )
    .digest("hex");
}
