import type { Prisma } from "@prisma/client";
import { assertPreviewCostLedgerReady } from "@/lib/costs/db";
import {
  buildRequestButtonLabel,
  groupCostSections,
  toCostLineDto,
  toInvoiceRequestDto,
  type CostDashboardDto,
} from "@/lib/costs/dto";
import {
  DEFAULT_MANUAL_COST_CATEGORIES,
  listManualCostCategories,
} from "@/lib/costs/manual-categories";
import { formatMarkedGbp } from "@/lib/costs/format";
import { minorToSafeNumber, sumMinor, ZERO_MINOR } from "@/lib/costs/money";
import { assertAccountsPreview, ACCOUNTS_PREVIEW_CATEGORIES, ACCOUNTS_PREVIEW_START } from "./accounts-preview";
import { PREVIEW_ENTRY_WHERE, PREVIEW_REQUEST_WHERE } from "./accounts-projection";
import type { AccountsSnapshot } from "./accounts-snapshot";
import { buildCursorAudit } from "./cursor-audit";

const STALE_SYNC_MS = 36 * 60 * 60 * 1000;

const invoiceableWhere = {
  invoiceability: "INVOICEABLE" as const,
  settlement: { is: null },
  invoiceLines: { none: { request: { status: "PENDING" as const } } },
};

export async function listUnsettledEntries(client: Prisma.TransactionClient | typeof import("@/lib/db").db) {
  return client.costEntry.findMany({
    orderBy: [{ servicePeriodStart: "asc" }, { createdAt: "asc" }],
  });
}

export async function listInvoiceableEntries(client: Prisma.TransactionClient | typeof import("@/lib/db").db) {
  return client.costEntry.findMany({
    where: invoiceableWhere,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

function manualSectionLabel(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const label = "manualCategoryLabel" in metadata ? metadata.manualCategoryLabel : null;
  return typeof label === "string" && label.trim() ? label.trim() : null;
}

export async function getCostDashboard(input: {
  db: typeof import("@/lib/db").db;
  enabled: boolean;
  isOwner: boolean;
  accountsSnapshot?: AccountsSnapshot;
}): Promise<CostDashboardDto> {
  if (!input.enabled) {
    return {
      enabled: false,
      startedAt: null,
      isOwner: input.isOwner,
      projectedTotalLabel: formatMarkedGbp(ZERO_MINOR),
      projectedTotalMinor: 0,
      invoiceableTotalLabel: formatMarkedGbp(ZERO_MINOR),
      invoiceableTotalMinor: 0,
      requestButtonLabel: buildRequestButtonLabel(ZERO_MINOR),
      canRequestInvoice: false,
      pendingRequest: null,
      sections: [],
      requests: [],
      sync: {
        status: "NONE",
        stale: false,
        quarantinedCount: 0,
        completedAt: null,
        errorCode: null,
      },
      unavailableReason: null,
      affectsLiveLedger: false,
      ledgerRevision: null,
      ledgerAsOf: null,
      manualCategories: [...DEFAULT_MANUAL_COST_CATEGORIES],
    };
  }

  if(input.accountsSnapshot)assertAccountsPreview();
  const config = await input.db.costLedgerConfig.findUnique({
    where: { id: "default" },
  });
  if(!input.accountsSnapshot)assertPreviewCostLedgerReady(config);

  const [entries, pending, requests, latestSync, manualCategories] = await Promise.all([
    input.db.costEntry.findMany({
      where: { settlement: { is: null }, ...(input.accountsSnapshot?PREVIEW_ENTRY_WHERE:{}) },
      orderBy: [{ servicePeriodStart: "asc" }, { createdAt: "asc" }],
      include: { sourceSnapshot: { select: { metadata: true } } },
    }),
    input.db.invoiceRequest.findFirst({
      where: { status: "PENDING", ...(input.accountsSnapshot?PREVIEW_REQUEST_WHERE:{}) },
      include: { emails: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    input.db.invoiceRequest.findMany({
      where: input.accountsSnapshot?PREVIEW_REQUEST_WHERE:{},
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { emails: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    input.db.costSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    }),
    listManualCostCategories(input.accountsSnapshot?ACCOUNTS_PREVIEW_CATEGORIES:undefined),
  ]);

  const cursorAudit = input.isOwner
    ? input.accountsSnapshot
      ? {
          status: "unavailable" as const,
          reason: "The Accounts preview snapshot contains aggregated GBP lines only; it has no verifiable model or funding breakdown.",
          currency: "USD" as const,
          rows: [],
        }
      : buildCursorAudit(await input.db.costEntry.findMany({
          where: {
            settlement: { is: null },
            category: "CURSOR",
            kind: "CHARGE",
            reversedBy: { none: {} },
          },
          select: { sourceSnapshot: { select: { metadata: true } } },
        }).then((rows) => rows.map((row) => row.sourceSnapshot)))
    : undefined;

  const projected = sumMinor(entries.map((entry) => entry.markedGbpMinor));
  const invoiceable = pending
    ? ZERO_MINOR
    : sumMinor(
        entries
          .filter((entry) => entry.invoiceability === "INVOICEABLE")
          .map((entry) => entry.markedGbpMinor),
      );

  const pendingDto = pending
    ? toInvoiceRequestDto({
        ...pending,
        emailStatus: pending.emails[0]?.status ?? null,
        outboxId: pending.emails[0]?.id ?? null,
      })
    : null;

  const syncCompletedAt = input.accountsSnapshot ? input.accountsSnapshot.sourceUpdatedAt ? new Date(input.accountsSnapshot.sourceUpdatedAt) : null : latestSync?.completedAt ?? null;
  const stale =
    !syncCompletedAt ||
    Date.now() - syncCompletedAt.getTime() > STALE_SYNC_MS ||
    (!input.accountsSnapshot && latestSync?.status === "FAILED");

  return {
    accountsPreview: Boolean(input.accountsSnapshot),
    enabled: true,
    startedAt: input.accountsSnapshot?ACCOUNTS_PREVIEW_START:config?.startedAt.toISOString() ?? null,
    isOwner: input.isOwner,
    projectedTotalLabel: formatMarkedGbp(projected),
    projectedTotalMinor: minorToSafeNumber(projected),
    invoiceableTotalLabel: formatMarkedGbp(invoiceable),
    invoiceableTotalMinor: minorToSafeNumber(invoiceable),
    requestButtonLabel: buildRequestButtonLabel(invoiceable),
    canRequestInvoice: !pending && invoiceable > ZERO_MINOR,
    pendingRequest: pendingDto,
    sections: groupCostSections(
      entries.map((entry) =>
        toCostLineDto({
          ...entry,
          manualSection: manualSectionLabel(entry.sourceSnapshot.metadata),
        }),
      ),
    ),
    requests: requests.map((request) =>
      toInvoiceRequestDto({
        ...request,
        emailStatus: request.emails[0]?.status ?? null,
        outboxId: request.emails[0]?.id ?? null,
      }),
    ),
    sync: {
      status: input.accountsSnapshot?"SUCCEEDED":latestSync?.status ?? "NONE",
      stale,
      quarantinedCount: input.accountsSnapshot?input.accountsSnapshot.coverage.held:latestSync?.quarantinedCount ?? 0,
      completedAt: syncCompletedAt?.toISOString() ?? null,
      errorCode: input.accountsSnapshot?null:latestSync?.errorCode ?? null,
    },
    unavailableReason: null,
    affectsLiveLedger: false,
    ledgerRevision: input.accountsSnapshot?.revision ?? latestSync?.checksum ?? latestSync?.id ?? null,
    ledgerAsOf: syncCompletedAt?.toISOString() ?? null,
    manualCategories,
    ...(cursorAudit ? { cursorAudit } : {}),
  };
}
