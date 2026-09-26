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
  deploymentTarget?: "main" | "preview" | "shared";
  row: FocusChargeRow;
}

export interface QuarantinedFocusCharge {
  reason: string;
  rawIndex?: number;
  row?: FocusChargeRow;
}

export interface FocusClassificationConfig {
  projectId: string;
  projectIds?: readonly string[];
  previewProjectId?: string;
  databaseResourceIds: readonly string[];
  now?: Date;
  untaggedPolicy?: "shared" | "unresolved";
}

function allowedProjectIds(config: FocusClassificationConfig): Set<string> {
  const ids = config.projectIds && config.projectIds.length > 0
    ? config.projectIds
    : [config.projectId];
  return new Set(ids);
}

function deploymentTargetFor(
  project: string,
  config: FocusClassificationConfig,
): "main" | "preview" | "shared" {
  if (config.previewProjectId && project === config.previewProjectId) return "preview";
  if (project === config.projectId) return "main";
  return "shared";
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

  const databaseResourceIds = new Set(config.databaseResourceIds);
  if (matchedResourceId && databaseResourceIds.has(matchedResourceId)) {
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

  if (matchedResourceId && !databaseResourceIds.has(matchedResourceId)) {
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

  if (matchedProjectId && allowedProjectIds(config).has(matchedProjectId)) {
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
      deploymentTarget: deploymentTargetFor(matchedProjectId, config),
      row,
    };
  }

  if (matchedProjectId && !allowedProjectIds(config).has(matchedProjectId)) {
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
    if (config.untaggedPolicy === "unresolved") {
      return { reason: "Untagged FOCUS row is unresolved until mapped.", row };
    }
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
    const distinct = [...new Map(group.map((item) => [item.checksum, item])).values()];
    if (distinct.length === 1) return distinct[0];
    const nativeAmount = addDecimalStrings(distinct.map((item) => item.nativeAmount));
    return {
      ...distinct[0],
      nativeAmount,
      checksum: createHash("sha256")
        .update(distinct.map((item) => item.checksum).sort().join(":"))
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
