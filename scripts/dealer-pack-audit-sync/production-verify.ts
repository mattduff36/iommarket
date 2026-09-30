import type { PrismaClient } from "@prisma/client";
import {
  isAllowedListingImageFormat,
  validateListingImageBounds,
} from "../../lib/images/constraints";
import {
  classifyProductionListingProvenance,
  captureProductionAccountBaseline,
} from "./production-baseline";
import {
  PRODUCTION_ACCOUNTS,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  isTemporaryExcludedProductionAccount,
  type ProductionAccount,
  type ProductionApplyReport,
  type ProductionAuditPlan,
  type ProductionListingBaseline,
  type ProductionSourceListing,
  type ProductionVerifyReport,
} from "./production-types";
import { identitiesMatch } from "./finalize-live";
import { productionCleanupPublicIds } from "./production-apply";
import { assertProductionPlanIntegrity, canonicalJson } from "./plan-file";

function compareSourceListing(input: {
  source: ProductionSourceListing;
  live: ProductionListingBaseline;
  publicIds: string[];
  assetIds: string[];
  finalImages: ProductionApplyReport["listings"][number]["finalImages"];
}) {
  const errors: string[] = [];
  const { source, live } = input;
  const expected = source.listing;
  if (live.status !== "LIVE") errors.push("status");
  if (live.slug !== source.slug) errors.push("slug");
  if (live.previewPackId !== null) errors.push("preview-pack");
  if (live.title !== expected.title) errors.push("title");
  if (live.description !== expected.description) errors.push("description");
  if (live.price !== expected.pricePence) errors.push("price");
  if (live.featured) errors.push("featured");
  if (live.categorySlug !== expected.categorySlug) errors.push("category");
  if (live.regionSlug !== expected.regionSlug) errors.push("region");
  if (!live.trustDeclarationAccepted || !live.trustDeclarationAcceptedAt) {
    errors.push("trust-declaration");
  }
  const actualAttributes = live.attributes
    .map((attribute) => [attribute.slug, attribute.value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const expectedAttributes = Object.entries(expected.attributes)
    .sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(actualAttributes) !== JSON.stringify(expectedAttributes)) {
    errors.push("attributes");
  }
  const ordered = [...live.images].sort((a, b) => a.order - b.order);
  if (
    ordered.length !== input.publicIds.length ||
    ordered.some((image, index) =>
      image.order !== index ||
      image.publicId !== input.publicIds[index] ||
      image.assetId !== input.assetIds[index] ||
      image.width !== input.finalImages[index]?.width ||
      image.height !== input.finalImages[index]?.height ||
      image.format !== input.finalImages[index]?.format ||
      image.bytes !== input.finalImages[index]?.bytes ||
      !isAllowedListingImageFormat(image.format) ||
      validateListingImageBounds({
        width: image.width ?? 0,
        height: image.height ?? 0,
        bytes: image.bytes ?? 0,
      }) !== null)
  ) {
    errors.push("images");
  }
  return errors;
}

function verifyUnmanagedUntouched(input: {
  account: ProductionAccount;
  before: ProductionAuditPlan["accounts"][number]["baseline"];
  after: Awaited<ReturnType<typeof captureProductionAccountBaseline>>;
}) {
  const afterById = new Map(input.after.listings.map((listing) => [listing.id, listing]));
  const errors: string[] = [];
  for (const listing of input.before.listings) {
    const provenance = classifyProductionListingProvenance({
      account: input.account,
      baseline: input.before,
      listing,
    });
    if (provenance.kind !== "unmanaged") continue;
    const current = afterById.get(listing.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(listing)) {
      errors.push(`unmanaged-listing-changed:${listing.id}`);
    }
  }
  return errors;
}

function verifyAccount(input: {
  account: ProductionAccount;
  accountPlan: ProductionAuditPlan["accounts"][number];
  current: Awaited<ReturnType<typeof captureProductionAccountBaseline>>;
  applyReport: ProductionApplyReport;
}) {
  const errors = verifyUnmanagedUntouched({
    account: input.account,
    before: input.accountPlan.baseline,
    after: input.current,
  });
  if (
    JSON.stringify(input.current.user) !== JSON.stringify(input.accountPlan.baseline.user) ||
    JSON.stringify(input.current.dealer) !== JSON.stringify(input.accountPlan.baseline.dealer)
  ) {
    errors.push("account-baseline-changed");
  }

  const managed = new Map<string, ProductionListingBaseline>();
  for (const listing of input.current.listings) {
    const provenance = classifyProductionListingProvenance({
      account: input.account,
      baseline: input.current,
      listing,
    });
    if (provenance.kind === "ambiguous") errors.push(provenance.reason);
    if (provenance.kind === "managed") {
      if (managed.has(provenance.managedKey)) {
        errors.push(`duplicate-managed-key:${provenance.managedKey}`);
      } else {
        managed.set(provenance.managedKey, listing);
      }
    }
  }

  const expectedManagedIds = new Set(
    input.accountPlan.baseline.listings.flatMap((listing) => {
      const provenance = classifyProductionListingProvenance({
        account: input.account,
        baseline: input.accountPlan.baseline,
        listing,
      });
      return provenance.kind === "managed" ? [listing.id] : [];
    }),
  );
  const evidenceByIdentity = new Map(
    input.applyReport.listings
      .filter((evidence) => evidence.dealerKey === input.account.dealerKey)
      .map((evidence) => [evidence.identityKey, evidence]),
  );
  if (isTemporaryExcludedProductionAccount(input.accountPlan.dealerKey)) {
    errors.push(`excluded-production-account:${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY}`);
  }
  for (const excluded of input.accountPlan.excludedListings ?? []) {
    const stillLive = [...managed.values()].some((listing) =>
      listing.status === "LIVE" &&
      (listing.slug === excluded.managedKey ||
        managed.get(excluded.managedKey) === listing ||
        identitiesMatch(excluded.identityKey, listing.slug ?? "")));
    if (stillLive) {
      errors.push(`${excluded.identityKey}:excluded-listing-still-live`);
    }
  }
  for (const action of input.accountPlan.actions) {
    if (action.kind !== "take_down" && action.source.images.length === 0) {
      errors.push(`${action.identityKey}:empty-source-images`);
    }
    if (
      action.kind !== "take_down" &&
      (input.accountPlan.excludedListings ?? []).some((excluded) =>
        identitiesMatch(excluded.identityKey, action.identityKey) ||
        excluded.managedKey === action.source.managedKey)
    ) {
      errors.push(`${action.identityKey}:excluded-listing-mutated`);
    }
    if (action.kind === "take_down") {
      const listing = input.current.listings.find((item) => item.id === action.listingId);
      expectedManagedIds.add(action.listingId);
      if (!listing || listing.status !== "TAKEN_DOWN") {
        errors.push(`${action.identityKey}:stale-status`);
      } else if (!listing.statusEvents.some((event) =>
        event.fromStatus === "LIVE" &&
        event.toStatus === "TAKEN_DOWN" &&
        event.source === "ADMIN" &&
        event.action === "TAKE_DOWN" &&
        event.notes ===
          `Dealer pack production sync stale source (${input.accountPlan.dealerKey})`)) {
        errors.push(`${action.identityKey}:stale-event`);
      }
      continue;
    }
    const evidence = evidenceByIdentity.get(action.identityKey);
    if (!evidence) {
      errors.push(`${action.identityKey}:apply-evidence`);
      continue;
    }
    expectedManagedIds.add(evidence.listingId);
    const listing = input.current.listings.find((item) => item.id === evidence.listingId);
    if (!listing) {
      errors.push(`${action.identityKey}:listing-missing`);
      continue;
    }
    if (managed.get(action.source.managedKey)?.id !== listing.id) {
      errors.push(`${action.identityKey}:managed-key`);
    }
    if (
      listing.userId !== input.accountPlan.baseline.user.id ||
      listing.dealerId !== input.accountPlan.baseline.dealer.id
    ) {
      errors.push(`${action.identityKey}:owner`);
    }
    if (
      evidence.publicIds.length !== action.source.images.length ||
      evidence.assetIds.length !== action.source.images.length ||
      evidence.sourceChecksums.length !== action.source.images.length ||
      evidence.finalImages.length !== action.source.images.length ||
      evidence.sourceChecksums.some(
        (checksum, index) => checksum !== action.source.images[index]?.checksum,
      )
    ) {
      errors.push(`${action.identityKey}:source-checksums`);
    }
    errors.push(...compareSourceListing({
      source: action.source,
      live: listing,
      publicIds: evidence.publicIds,
      assetIds: evidence.assetIds,
      finalImages: evidence.finalImages,
    }).map((error) => `${action.identityKey}:${error}`));
  }

  const managedIds = new Set([...managed.values()].map((listing) => listing.id));
  if (
    managedIds.size !== expectedManagedIds.size ||
    [...managedIds].some((id) => !expectedManagedIds.has(id))
  ) {
    errors.push("managed-namespace-count");
  }
  return [...new Set(errors)].sort();
}

export async function verifyProductionAuditPlan(input: {
  prisma: PrismaClient;
  plan: ProductionAuditPlan;
  applyReport: ProductionApplyReport | null;
}): Promise<ProductionVerifyReport> {
  assertProductionPlanIntegrity(input.plan);
  if (
    !input.applyReport ||
    input.applyReport.runId !== input.plan.runId ||
    input.applyReport.planFingerprint !== input.plan.fingerprint ||
    input.applyReport.actionsApplied !== input.plan.actionCount
  ) {
    throw new Error("Refusing production audit verification: apply report mismatch.");
  }
  const durable = await input.prisma.adminAuditLog.findFirst({
    where: {
      adminId: input.plan.adminUserId,
      action: "DEALER_PACK_PRODUCTION_APPLY",
      entityType: "DealerProductionAudit",
      entityId: `${input.plan.runId}:${input.plan.fingerprint}`,
    },
    orderBy: { createdAt: "desc" },
    select: { details: true },
  });
  if (
    !durable?.details ||
    canonicalJson(durable.details) !== canonicalJson(input.applyReport)
  ) {
    throw new Error("Refusing production audit verification: durable apply evidence mismatch.");
  }
  const expectedEvidenceCount = input.plan.accounts.reduce(
    (count, account) =>
      count + account.actions.filter((action) => action.kind !== "take_down").length,
    0,
  );
  const evidenceKeys = new Set<string>();
  const publicIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const evidence of input.applyReport.listings) {
    const key = `${evidence.dealerKey}\0${evidence.identityKey}`;
    if (evidenceKeys.has(key)) {
      throw new Error("Refusing production audit verification: duplicate apply evidence.");
    }
    evidenceKeys.add(key);
    if (
      evidence.publicIds.length !== evidence.assetIds.length ||
      evidence.publicIds.some((publicId) => {
        const duplicate = publicIds.has(publicId);
        publicIds.add(publicId);
        return duplicate;
      }) ||
      evidence.assetIds.some((assetId) => {
        const duplicate = assetIds.has(assetId);
        assetIds.add(assetId);
        return duplicate;
      })
    ) {
      throw new Error("Refusing production audit verification: media evidence is not unique.");
    }
  }
  if (
    input.applyReport.listings.length !== expectedEvidenceCount ||
    evidenceKeys.size !== expectedEvidenceCount
  ) {
    throw new Error("Refusing production audit verification: apply evidence count mismatch.");
  }
  const accounts = [];
  for (const accountPlan of input.plan.accounts) {
    const account = PRODUCTION_ACCOUNTS.find(
      (item) => item.dealerKey === accountPlan.dealerKey,
    );
    if (!account || isTemporaryExcludedProductionAccount(accountPlan.dealerKey)) {
      throw new Error(
        accountPlan.dealerKey === TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY
          ? `Refusing production audit verification: ${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY} is excluded.`
          : `Production account is not allowlisted: ${accountPlan.dealerKey}`,
      );
    }
    const current = await captureProductionAccountBaseline(input.prisma, account);
    const errors = verifyAccount({
      account,
      accountPlan,
      current,
      applyReport: input.applyReport,
    });
    const expectedCleanup = [...new Set(
      accountPlan.actions.flatMap((action) => {
        if (action.kind !== "update") return [];
        const previous = accountPlan.baseline.listings.find(
          (listing) => listing.id === action.listingId,
        );
        return previous ? productionCleanupPublicIds(previous.images) : [];
      }),
    )];
    if (expectedCleanup.length > 0) {
      const queued = await input.prisma.listingImageCleanupJob.findMany({
        where: {
          publicId: { in: expectedCleanup },
          reason: `dealer-pack-production-sync:${account.dealerKey}`,
        },
        select: { publicId: true },
      });
      const queuedIds = new Set(queued.map((job) => job.publicId));
      if (expectedCleanup.some((publicId) => !queuedIds.has(publicId))) {
        errors.push("owned-image-cleanup-not-queued");
      }
    }
    let liveManaged = 0;
    let takenDownManaged = 0;
    let unmanaged = 0;
    for (const listing of current.listings) {
      const provenance = classifyProductionListingProvenance({
        account,
        baseline: current,
        listing,
      });
      if (provenance.kind === "managed" && listing.status === "LIVE") liveManaged += 1;
      else if (provenance.kind === "managed" && listing.status === "TAKEN_DOWN") {
        takenDownManaged += 1;
      } else if (provenance.kind === "unmanaged") unmanaged += 1;
    }
    accounts.push({
      dealerKey: account.dealerKey,
      ok: errors.length === 0,
      errors,
      liveManaged,
      takenDownManaged,
      unmanaged,
      imageCount: current.listings.reduce(
        (count, listing) => count + listing.images.length,
        0,
      ),
    });
  }
  return {
    runId: input.plan.runId,
    planFingerprint: input.plan.fingerprint,
    createdAt: new Date().toISOString(),
    ok: accounts.every((account) => account.ok),
    accounts,
  };
}
