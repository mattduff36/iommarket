import type { CostCategory, Prisma } from "@prisma/client";
import {
  buildRequestButtonLabel,
  COST_SECTION_LABELS,
  toCostLineDto,
  toInvoiceRequestDto,
  type CostDashboardDto,
  type CostLineDto,
} from "@/lib/costs/dto";
import { formatMarkedGbp } from "@/lib/costs/format";
import { minorToSafeNumber, sumMinor, ZERO_MINOR } from "@/lib/costs/money";

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

function groupSections(lines: CostLineDto[]) {
  const order: CostCategory[] = [
    "CURSOR",
    "VERCEL_HOSTING",
    "DATABASE",
    "OTHER",
    "SHARED_VERCEL",
  ];
  return order
    .map((category) => {
      const categoryLines = lines.filter((line) => line.category === category);
      const amountMinor = categoryLines.reduce((total, line) => total + line.amountMinor, 0);
      const provisional = category === "SHARED_VERCEL" && categoryLines.some((line) => line.provisional);
      return {
        key: category,
        label:
          category === "SHARED_VERCEL" && provisional
            ? "Provisional Shared Hosting"
            : COST_SECTION_LABELS[category],
        amountLabel: formatMarkedGbp(BigInt(amountMinor)),
        provisional,
        lines: categoryLines,
      };
    })
    .filter((section) => section.lines.length > 0);
}

export async function getCostDashboard(input: {
  db: typeof import("@/lib/db").db;
  enabled: boolean;
  isOwner: boolean;
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
    };
  }

  const [config, entries, pending, requests, latestSync, quarantinedCount] = await Promise.all([
    input.db.costLedgerConfig.findUnique({ where: { id: "default" } }),
    input.db.costEntry.findMany({
      where: { settlement: { is: null } },
      orderBy: [{ servicePeriodStart: "asc" }, { createdAt: "asc" }],
    }),
    input.db.invoiceRequest.findFirst({
      where: { status: "PENDING" },
      include: { emails: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    input.db.invoiceRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { emails: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    input.db.costSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    }),
    input.db.costSourceSnapshot.count({
      where: { quarantined: true },
    }),
  ]);

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

  const syncCompletedAt = latestSync?.completedAt ?? null;
  const stale =
    !syncCompletedAt ||
    Date.now() - syncCompletedAt.getTime() > STALE_SYNC_MS ||
    latestSync?.status === "FAILED";

  return {
    enabled: true,
    startedAt: config?.startedAt.toISOString() ?? null,
    isOwner: input.isOwner,
    projectedTotalLabel: formatMarkedGbp(projected),
    projectedTotalMinor: minorToSafeNumber(projected),
    invoiceableTotalLabel: formatMarkedGbp(invoiceable),
    invoiceableTotalMinor: minorToSafeNumber(invoiceable),
    requestButtonLabel: buildRequestButtonLabel(invoiceable),
    canRequestInvoice: !pending && invoiceable > ZERO_MINOR,
    pendingRequest: pendingDto,
    sections: groupSections(entries.map(toCostLineDto)),
    requests: requests.map((request) =>
      toInvoiceRequestDto({
        ...request,
        emailStatus: request.emails[0]?.status ?? null,
        outboxId: request.emails[0]?.id ?? null,
      }),
    ),
    sync: {
      status: latestSync?.status ?? "NONE",
      stale,
      quarantinedCount,
      completedAt: syncCompletedAt?.toISOString() ?? null,
      errorCode: latestSync?.errorCode ?? null,
    },
  };
}
