import type {
  CostCategory,
  CostEntryKind,
  CostInvoiceability,
  CostSyncStatus,
  InvoiceRequestStatus,
} from "@prisma/client";
import { formatInvoiceRequestLabel, formatMarkedGbp } from "@/lib/costs/format";
import { minorToSafeNumber } from "@/lib/costs/money";

export const COST_SECTION_LABELS: Record<CostCategory, string> = {
  CURSOR: "Development (Cursor)",
  VERCEL_HOSTING: "Website hosting (Vercel)",
  DATABASE: "Database",
  SHARED_VERCEL: "Shared Vercel services",
  OTHER: "Other",
};
const LEGACY_MANUAL_SECTION_LABEL = "Manual Adjustment";

export interface CostLineDto {
  id: string;
  section: string;
  category: CostCategory;
  label: string;
  amountLabel: string;
  amountMinor: number;
  kind: CostEntryKind;
  invoiceability: CostInvoiceability;
  periodStart: string;
  periodEnd: string;
  provisional: boolean;
}

export interface InvoiceRequestDto {
  id: string;
  status: InvoiceRequestStatus;
  amountLabel: string;
  amountMinor: number;
  entryCount: number;
  createdAt: string;
  confirmedAt: string | null;
  emailStatus: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SUPPRESSED" | null;
  outboxId: string | null;
}

export interface CostSyncHealthDto {
  status: CostSyncStatus | "NONE";
  stale: boolean;
  quarantinedCount: number;
  completedAt: string | null;
  errorCode: string | null;
}

export interface CostDashboardDto {
  accountsPreview?: boolean;
  /** Owner-only source audit. Values remain in their reported USD denomination. */
  cursorAudit?: CursorAuditDto;
  enabled: boolean;
  startedAt: string | null;
  isOwner: boolean;
  projectedTotalLabel: string;
  projectedTotalMinor: number;
  invoiceableTotalLabel: string;
  invoiceableTotalMinor: number;
  requestButtonLabel: string;
  canRequestInvoice: boolean;
  pendingRequest: InvoiceRequestDto | null;
  sections: Array<{
    key: string;
    label: string;
    amountLabel: string;
    provisional: boolean;
    lines: CostLineDto[];
  }>;
  requests: InvoiceRequestDto[];
  sync: CostSyncHealthDto;
  unavailableReason: string | null;
  affectsLiveLedger: boolean;
  ledgerRevision: string | null;
  ledgerAsOf: string | null;
  manualCategories: Array<{ slug: string; label: string }>;
}

export interface CursorAuditDto {
  status: "available" | "partial" | "unavailable";
  reason: string | null;
  currency: "USD";
  rows: Array<{
    day: string;
    model: string;
    funding: "included" | "on-demand";
    eventCount: number;
    nominalUsd: string;
    nominalBasis: "provider-reported" | "rate-card-estimate" | "mixed" | "unavailable";
    nominalMissingEvents: number;
    providerChargeUsd: string;
    clientUsd: string;
    sourceQuality: "complete" | "partial" | "unknown";
    displayDiverged: boolean;
  }>;
}

export function cursorAuditForViewer(
  audit: CursorAuditDto | undefined,
  isOwner: boolean,
): CursorAuditDto | undefined {
  return isOwner ? audit : undefined;
}

export function toCostLineDto(input: {
  id: string;
  category: CostCategory;
  kind: CostEntryKind;
  displayLabel: string;
  markedGbpMinor: bigint;
  invoiceability: CostInvoiceability;
  servicePeriodStart: Date;
  servicePeriodEnd: Date;
  manualSection?: string | null;
}): CostLineDto {
  const manualSection = input.manualSection?.trim();
  return {
    id: input.id,
    section:
      input.category === "OTHER" && manualSection
        ? manualSection
        : input.category === "OTHER"
          ? LEGACY_MANUAL_SECTION_LABEL
          : COST_SECTION_LABELS[input.category],
    category: input.category,
    label: input.displayLabel,
    amountLabel: formatMarkedGbp(input.markedGbpMinor),
    amountMinor: minorToSafeNumber(input.markedGbpMinor),
    kind: input.kind,
    invoiceability: input.invoiceability,
    periodStart: input.servicePeriodStart.toISOString(),
    periodEnd: input.servicePeriodEnd.toISOString(),
    provisional: input.invoiceability === "PROVISIONAL",
  };
}

export function toInvoiceRequestDto(input: {
  id: string;
  status: InvoiceRequestStatus;
  frozenGbpMinor: bigint;
  frozenEntryCount: number;
  createdAt: Date;
  confirmedAt: Date | null;
  emailStatus?: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SUPPRESSED" | null;
  outboxId?: string | null;
}): InvoiceRequestDto {
  return {
    id: input.id,
    status: input.status,
    amountLabel: formatMarkedGbp(input.frozenGbpMinor),
    amountMinor: minorToSafeNumber(input.frozenGbpMinor),
    entryCount: input.frozenEntryCount,
    createdAt: input.createdAt.toISOString(),
    confirmedAt: input.confirmedAt?.toISOString() ?? null,
    emailStatus: input.emailStatus ?? null,
    outboxId: input.outboxId ?? null,
  };
}

export function buildRequestButtonLabel(invoiceableMinor: bigint): string {
  return formatInvoiceRequestLabel(invoiceableMinor);
}

const PROVIDER_SECTIONS: Array<{
  key: CostCategory;
  categories: CostCategory[];
}> = [
  { key: "CURSOR", categories: ["CURSOR"] },
  {
    key: "VERCEL_HOSTING",
    categories: ["VERCEL_HOSTING", "SHARED_VERCEL"],
  },
  { key: "DATABASE", categories: ["DATABASE"] },
];

export function groupCostSections(lines: CostLineDto[]): CostDashboardDto["sections"] {
  const provider = PROVIDER_SECTIONS.flatMap(({ key, categories }) => {
    const categoryLines = lines.filter((line) => categories.includes(line.category));
    if (categoryLines.length === 0) return [];
    const amountMinor = categoryLines.reduce((total, line) => total + line.amountMinor, 0);
    return [{
      key,
      label: COST_SECTION_LABELS[key],
      amountLabel: formatMarkedGbp(BigInt(amountMinor)),
      provisional: categoryLines.some((line) => line.provisional),
      lines: categoryLines,
    }];
  });

  const manualLabels: string[] = [];
  for (const line of lines) {
    if (line.category === "OTHER" && !manualLabels.includes(line.section)) {
      manualLabels.push(line.section);
    }
  }
  const manual = manualLabels.flatMap((label) => {
    const categoryLines = lines.filter(
      (line) => line.category === "OTHER" && line.section === label,
    );
    if (categoryLines.length === 0) return [];
    const amountMinor = categoryLines.reduce((total, line) => total + line.amountMinor, 0);
    return [{
      key: `manual:${label}`,
      label,
      amountLabel: formatMarkedGbp(BigInt(amountMinor)),
      provisional: false,
      lines: categoryLines,
    }];
  });

  return [...provider, ...manual];
}
