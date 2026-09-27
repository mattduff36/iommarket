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
  emailStatus: "PENDING" | "SENDING" | "SENT" | "FAILED" | null;
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
  emailStatus?: "PENDING" | "SENDING" | "SENT" | "FAILED" | null;
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

const PROVIDER_SECTION_ORDER: CostCategory[] = [
  "CURSOR",
  "VERCEL_HOSTING",
  "DATABASE",
  "SHARED_VERCEL",
];

export function groupCostSections(lines: CostLineDto[]): CostDashboardDto["sections"] {
  const provider = PROVIDER_SECTION_ORDER.flatMap((category) => {
    const categoryLines = lines.filter((line) => line.category === category);
    if (categoryLines.length === 0) return [];
    const amountMinor = categoryLines.reduce((total, line) => total + line.amountMinor, 0);
    return [{
      key: category,
      label: COST_SECTION_LABELS[category],
      amountLabel: formatMarkedGbp(BigInt(amountMinor)),
      provisional: category === "SHARED_VERCEL" && categoryLines.some((line) => line.provisional),
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
