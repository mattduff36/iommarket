import type {
  CostCategory,
  CostInvoiceability,
  CostSyncStatus,
  InvoiceRequestStatus,
} from "@prisma/client";
import { formatInvoiceRequestLabel, formatMarkedGbp } from "@/lib/costs/format";
import { minorToSafeNumber } from "@/lib/costs/money";

export const COST_SECTION_LABELS: Record<CostCategory, string> = {
  CURSOR: "Development",
  VERCEL_HOSTING: "Vercel Hosting",
  DATABASE: "Database",
  SHARED_VERCEL: "Shared Hosting",
  OTHER: "Other",
};

export interface CostLineDto {
  id: string;
  section: string;
  category: CostCategory;
  label: string;
  amountLabel: string;
  amountMinor: number;
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
}

export function toCostLineDto(input: {
  id: string;
  category: CostCategory;
  displayLabel: string;
  markedGbpMinor: bigint;
  invoiceability: CostInvoiceability;
  servicePeriodStart: Date;
  servicePeriodEnd: Date;
}): CostLineDto {
  return {
    id: input.id,
    section: COST_SECTION_LABELS[input.category],
    category: input.category,
    label: input.displayLabel,
    amountLabel: formatMarkedGbp(input.markedGbpMinor),
    amountMinor: minorToSafeNumber(input.markedGbpMinor),
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
