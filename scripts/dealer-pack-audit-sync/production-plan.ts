import type { PrismaClient } from "@prisma/client";
import {
  captureProductionAccountBaseline,
  classifyProductionListingProvenance,
  planManagedNamespace,
} from "./production-baseline";
import { sealProductionPlan } from "./plan-file";
import { loadProductionSource } from "./production-source";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_AUDIT_VERSION,
  PRODUCTION_BACKUP_ID,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  type ProductionAccountPlan,
  type ProductionAuditPlan,
  type ProductionSourceListing,
} from "./production-types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function resolveAdminUserId(prisma: PrismaClient) {
  const admins = await prisma.user.findMany({
    where: {
      email: { equals: "admin@mpdee.co.uk", mode: "insensitive" },
      role: "ADMIN",
      deletedAt: null,
    },
    select: { id: true },
    take: 2,
  });
  if (admins.length !== 1) {
    throw new Error("production-admin-not-unique");
  }
  return admins[0]!.id;
}

export async function buildProductionAuditPlan(input: {
  prisma: PrismaClient;
  runId: string;
  foundingSourceRunId: string;
  dealerKey?: string;
}): Promise<ProductionAuditPlan> {
  if (PRODUCTION_ACCOUNTS.length !== 5) {
    throw new Error("Production dealer account allowlist must contain exactly five accounts.");
  }
  const adminUserId = await resolveAdminUserId(input.prisma);
  const selectedAccounts = input.dealerKey
    ? PRODUCTION_ACCOUNTS.filter((account) => account.dealerKey === input.dealerKey)
    : PRODUCTION_ACCOUNTS;
  if (selectedAccounts.length === 0) {
    throw new Error(`production-account-not-found:${input.dealerKey}`);
  }
  const accounts: ProductionAccountPlan[] = [];
  for (const account of selectedAccounts) {
    const baseline = await captureProductionAccountBaseline(input.prisma, account);
    const blockers: string[] = [];
    let sourceRunId = "unavailable";
    let sourceChecksum = "unavailable";
    let source: ProductionSourceListing[] = [];
    try {
      const loaded = await loadProductionSource(
        account,
        input.runId,
        input.foundingSourceRunId,
      );
      sourceRunId = loaded.runId;
      sourceChecksum = loaded.checksum;
      source = loaded.listings;
    } catch (error) {
      blockers.push(errorMessage(error));
    }
    const namespace = planManagedNamespace({ account, baseline, source });
    blockers.push(...namespace.blockers);
    const activeStatuses = new Set(["DRAFT", "PENDING", "APPROVED", "LIVE"]);
    const unmanagedActive = baseline.listings.filter((listing) => {
      const provenance = classifyProductionListingProvenance({
        account,
        baseline,
        listing,
      });
      return provenance.kind === "unmanaged" && activeStatuses.has(listing.status);
    }).length;
    if (unmanagedActive + source.length > 100) {
      blockers.push(
        `dealer-cap-exceeded:${unmanagedActive}+${source.length}>100`,
      );
    }
    const uniqueBlockers = [...new Set(blockers)].sort();
    accounts.push({
      dealerKey: account.dealerKey,
      displayName: account.displayName,
      email: account.email,
      sourceKind: account.sourceKind,
      sourceRunId,
      sourceChecksum,
      applicable: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      baseline,
      actions: namespace.actions,
    });
  }
  const actionCount = accounts.reduce(
    (count, account) => count + account.actions.length,
    0,
  );
  return sealProductionPlan({
    version: PRODUCTION_AUDIT_VERSION,
    runId: input.runId,
    createdAt: new Date().toISOString(),
    target: {
      projectRef: PRODUCTION_PROJECT_REF,
      confirmDb: PRODUCTION_CONFIRM_DB,
    },
    backupId: PRODUCTION_BACKUP_ID,
    foundingSourceRunId: input.foundingSourceRunId,
    adminUserId,
    actionCount,
    accounts,
  });
}
