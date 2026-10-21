import { Prisma } from "@prisma/client";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import { db } from "@/lib/db";
import type { FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { SyncIdentity, SyncListing } from "@/lib/dealer-stock-sync/types";

const CAP_STATUSES = ["DRAFT", "PENDING", "APPROVED", "LIVE"] as const;

export function mileageOf(values: Array<{ value: string; attributeDefinition: { slug: string } }>) {
  const raw = values.find((value) => value.attributeDefinition.slug === "mileage")?.value;
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function loadStockSyncSnapshot(
  dealerId: string,
  actions: FingerprintSnapshot["actions"],
  client: Prisma.TransactionClient = db,
): Promise<FingerprintSnapshot | null> {
  const dealer = await client.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      id: true,
      tier: true,
      isAdminPreview: true,
      userId: true,
      stockSourceBinding: {
        select: {
          id: true,
          registryKey: true,
          enabled: true,
          verifiedAt: true,
          identities: true,
        },
      },
      user: { select: { role: true, disabledAt: true, deletedAt: true, regionId: true } },
    },
  });
  if (!dealer?.stockSourceBinding) return null;
  const [listings, activeListingCount] = await Promise.all([
    client.listing.findMany({
      where: { dealerId, retentionPurgedAt: null, previewPackId: null },
      select: {
        id: true,
        updatedAt: true,
        userId: true,
        title: true,
        description: true,
        status: true,
        price: true,
        featured: true,
        expiresAt: true,
        soldAt: true,
        lifecycleRevision: true,
        photoRevision: true,
        reviewSourceIdentity: true,
        slug: true,
        previewPackId: true,
        attributeValues: { select: { value: true, attributeDefinition: { select: { slug: true } } } },
        revisions: { where: { status: { in: ["DRAFT", "PENDING"] } }, select: { id: true } },
      },
    }),
    client.listing.count({
      where: { dealerId, retentionPurgedAt: null, status: { in: [...CAP_STATUSES] } },
    }),
  ]);
  const syncListings: SyncListing[] = listings.map((listing) => ({
    id: listing.id,
    updatedAt: listing.updatedAt.toISOString(),
    userId: listing.userId,
    title: listing.title,
    description: listing.description,
    status: listing.status,
    price: listing.price,
    mileage: mileageOf(listing.attributeValues),
    featured: listing.featured,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
    soldAt: listing.soldAt?.toISOString() ?? null,
    lifecycleRevision: listing.lifecycleRevision,
    photoRevision: listing.photoRevision,
    reviewSourceIdentity: listing.reviewSourceIdentity,
    slug: listing.slug,
    previewPackId: listing.previewPackId,
    openRevision: listing.revisions.length > 0,
  }));
  const identities: SyncIdentity[] = dealer.stockSourceBinding.identities.map((identity) => ({
    sourceIdentityKey: identity.sourceIdentityKey,
    listingId: identity.listingId,
    absenceCount: identity.absenceCount,
    lastAbsenceRunId: identity.lastAbsenceRunId,
    lastSeenRunId: identity.lastSeenRunId,
    baselinePricePence: identity.baselinePricePence,
    baselineMileage: identity.baselineMileage,
  }));
  return {
    dealer: {
      id: dealer.id,
      userId: dealer.userId,
      regionId: dealer.user.regionId,
      tier: dealer.tier,
      isAdminPreview: dealer.isAdminPreview,
      role: dealer.user.role,
      disabledAt: dealer.user.disabledAt?.toISOString() ?? null,
      deletedAt: dealer.user.deletedAt?.toISOString() ?? null,
    },
    binding: {
      id: dealer.stockSourceBinding.id,
      registryKey: dealer.stockSourceBinding.registryKey,
      enabled: dealer.stockSourceBinding.enabled,
      verifiedAt: dealer.stockSourceBinding.verifiedAt?.toISOString() ?? null,
    },
    activeListingCount,
    listingCap: getDealerListingCap(dealer.tier),
    listings: syncListings,
    identities,
    actions,
  };
}
