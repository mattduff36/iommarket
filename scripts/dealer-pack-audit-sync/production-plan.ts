import type { PrismaClient } from "@prisma/client";
import {
  applyProductionLiveGate,
  assertFinalizedPreviewPlan,
  LIVE_PREVIEW_DEALER_MISSING_REASON,
  productionLiveGateFromFinalPreviewPlan,
  type ProductionLiveBaselineRef,
} from "./finalize-live";
import { sealProductionPlan } from "./plan-file";
import {
  captureProductionAccountBaseline,
  classifyProductionListingProvenance,
  planManagedNamespace,
} from "./production-baseline";
import {
  loadProductionSource,
  partitionProductionSourceListings,
} from "./production-source";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_AUDIT_VERSION,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  isTemporaryExcludedProductionAccount,
  type ProductionAccount,
  type ProductionAccountBaseline,
  type ProductionAccountPlan,
  type ProductionAuditPlan,
  type ProductionExcludedListing,
  type ProductionSourceListing,
} from "./production-types";
import type { PreviewPackAuditPlan } from "./types";

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

export function assertProductionSourceRunBinding(
  foundingSourceRunId: string,
  finalPreviewPlan: PreviewPackAuditPlan,
) {
  if (foundingSourceRunId !== finalPreviewPlan.sourceRunId) {
    throw new Error(
      "Refusing production plan: founding source run does not match finalized preview plan sourceRunId.",
    );
  }
}

export function productionLiveBaselineRefs(
  account: ProductionAccount,
  baseline: ProductionAccountBaseline,
): ProductionLiveBaselineRef[] {
  return baseline.listings.flatMap((listing) => {
    const provenance = classifyProductionListingProvenance({
      account,
      baseline,
      listing,
    });
    if (provenance.kind !== "managed") return [];
    return [{
      listingId: listing.id,
      managedKey: provenance.managedKey,
      slug: listing.slug,
      status: listing.status,
      title: listing.title,
    }];
  });
}

export async function buildProductionAuditPlan(input: {
  prisma: PrismaClient;
  runId: string;
  foundingSourceRunId: string;
  backupId: string;
  finalPreviewPlan: PreviewPackAuditPlan;
  dealerKey?: string;
}): Promise<ProductionAuditPlan> {
  const backupId = input.backupId.trim();
  if (!backupId) throw new Error("production-backup-id-required");
  if (!input.finalPreviewPlan) {
    throw new Error("production-live-preview-plan-required");
  }
  assertFinalizedPreviewPlan(input.finalPreviewPlan);
  assertProductionSourceRunBinding(
    input.foundingSourceRunId,
    input.finalPreviewPlan,
  );
  if (PRODUCTION_ACCOUNTS.length !== 4) {
    throw new Error("Production dealer account allowlist must contain exactly four accounts.");
  }
  if (input.dealerKey && isTemporaryExcludedProductionAccount(input.dealerKey)) {
    throw new Error(`production-account-excluded:${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY}`);
  }
  const gate = productionLiveGateFromFinalPreviewPlan(input.finalPreviewPlan);
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
    const disabled = gate.disabledDealerKeys.includes(account.dealerKey);
    if (!gate.coveredDealerKeys.includes(account.dealerKey)) {
      blockers.push(`${LIVE_PREVIEW_DEALER_MISSING_REASON}:${account.dealerKey}`);
    }
    let sourceRunId = "unavailable";
    let sourceChecksum = "unavailable";
    let source: ProductionSourceListing[] = [];
    let excludedListings: ProductionExcludedListing[] = [];
    try {
      if (disabled && account.sourceKind === "ocean") {
        sourceRunId = `disabled:${input.finalPreviewPlan.runId}`;
        sourceChecksum = "disabled";
      } else {
        const loaded = await loadProductionSource(
          account,
          input.runId,
          input.foundingSourceRunId,
        );
        sourceRunId = loaded.runId;
        sourceChecksum = loaded.checksum;
        const partitioned = partitionProductionSourceListings(loaded.listings);
        source = partitioned.included;
        excludedListings = [...loaded.excludedListings, ...partitioned.excluded]
          .filter((listing, index, all) =>
            all.findIndex((item) => item.identityKey === listing.identityKey) === index);
      }
      const gated = applyProductionLiveGate({
        dealerKey: account.dealerKey,
        sourceKind: account.sourceKind,
        source,
        excludedListings,
        exclusions: gate.exclusions,
        allowlist: gate.allowlist,
        disabled,
        baseline: productionLiveBaselineRefs(account, baseline),
      });
      source = gated.source;
      excludedListings = gated.excludedListings;
      blockers.push(...gated.blockers);
    } catch (error) {
      if (!disabled) blockers.push(errorMessage(error));
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
      excludedListings,
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
    backupId,
    foundingSourceRunId: input.foundingSourceRunId,
    adminUserId,
    finalPreviewRunId: input.finalPreviewPlan.runId,
    finalPreviewFingerprint: input.finalPreviewPlan.fingerprint,
    actionCount,
    accounts,
  });
}
