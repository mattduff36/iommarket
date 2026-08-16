import type { Prisma } from "@prisma/client";
import {
  buildBundleVersion,
  policyVersionsForBundle,
} from "../../lib/policies/registry";
import type { PolicyAcceptanceType } from "../../lib/policies/types";
import { upsertCatalog } from "./catalog-upsert";
import type { MarketplacePlan, PlannedDealer, PlannedSeller } from "./dataset";
import {
  buildGrantEntitlementDates,
  buildPaidEntitlementDates,
} from "./entitlement";
import {
  seedPaymentId,
  seedPaymentIdempotencyKey,
  seedPaymentReference,
  seedPlanId,
  seedSubscriptionId,
} from "./payments";
import { comparePreservedIdentities, type PreservedIdentity } from "./preserve";
import { wipeMarketplace } from "./wipe";

type TransactionClient = Prisma.TransactionClient;

async function recordPlaceholderAcceptances(
  tx: TransactionClient,
  userId: string,
  types: PolicyAcceptanceType[],
) {
  for (const acceptanceType of types) {
    await tx.policyAcceptance.upsert({
      where: {
        userId_acceptanceType_bundleVersion: {
          userId,
          acceptanceType,
          bundleVersion: buildBundleVersion(acceptanceType),
        },
      },
      update: {},
      create: {
        userId,
        acceptanceType,
        bundleVersion: buildBundleVersion(acceptanceType),
        policyVersions: policyVersionsForBundle(acceptanceType),
        source: "SIGNUP",
      },
    });
  }
}

async function upsertDealerUser(
  tx: TransactionClient,
  dealer: PlannedDealer,
  regionId: string,
) {
  if (dealer.preservedUserId && dealer.preservedDealerId) {
    return { userId: dealer.preservedUserId, dealerId: dealer.preservedDealerId };
  }

  const user = await tx.user.create({
    data: {
      authUserId: dealer.authUserId,
      email: dealer.email,
      name: dealer.userName,
      role: "DEALER",
      regionId,
    },
  });
  const profile = await tx.dealerProfile.create({
    data: {
      userId: user.id,
      name: dealer.name,
      slug: dealer.slug,
      bio: dealer.bio,
      phone: dealer.phone,
      website: dealer.website,
      verified: dealer.verified,
      tier: dealer.tier,
    },
  });
  await recordPlaceholderAcceptances(tx, user.id, [
    "AGE_18",
    "ACCOUNT_BUNDLE",
    "DEALER_BUNDLE",
    "PRIVACY_NOTICE",
  ]);
  return { userId: user.id, dealerId: profile.id };
}

async function upsertSellerUser(
  tx: TransactionClient,
  seller: PlannedSeller,
  regionId: string,
) {
  if (seller.preservedUserId) return seller.preservedUserId;
  const user = await tx.user.create({
    data: {
      authUserId: seller.authUserId,
      email: seller.email,
      name: seller.name,
      role: "USER",
      regionId,
    },
  });
  await recordPlaceholderAcceptances(tx, user.id, [
    "AGE_18",
    "ACCOUNT_BUNDLE",
    "LISTING_BUNDLE",
    "PRIVACY_NOTICE",
  ]);
  return user.id;
}

async function writeEntitlement(
  tx: TransactionClient,
  dealer: PlannedDealer,
  dealerId: string,
  now: Date,
) {
  const paidDates = buildPaidEntitlementDates(now);
  const grantDates = buildGrantEntitlementDates(now);
  await tx.subscription.upsert({
    where: { providerSubscriptionId: seedSubscriptionId(dealer.slug) },
    update:
      dealer.entitlement === "ADMIN_GRANT"
        ? {
            source: "ADMIN_GRANT",
            status: "ACTIVE",
            paymentProvider: "DEV",
            providerPlanId: seedPlanId(dealer.tier),
            revokedAt: null,
            ...grantDates,
          }
        : {
            source: "PAYMENT",
            status: "ACTIVE",
            paymentProvider: "DEV",
            providerPlanId: seedPlanId(dealer.tier),
            ...paidDates,
          },
    create: {
      dealerId,
      paymentProvider: "DEV",
      providerSubscriptionId: seedSubscriptionId(dealer.slug),
      providerPlanId: seedPlanId(dealer.tier),
      source: dealer.entitlement === "ADMIN_GRANT" ? "ADMIN_GRANT" : "PAYMENT",
      status: "ACTIVE",
      customerEmailNorm: null,
      ...(dealer.entitlement === "ADMIN_GRANT" ? grantDates : paidDates),
    },
  });
}

function statusEvents(status: MarketplacePlan["listings"][number]["status"]) {
  if (status === "DRAFT") return [{ toStatus: "DRAFT" as const, action: "RETURN_TO_DRAFT" as const }];
  if (status === "PENDING") return [{ toStatus: "PENDING" as const, action: "SUBMIT" as const }];
  if (status === "REJECTED") {
    return [
      { toStatus: "PENDING" as const, action: "SUBMIT" as const },
      { toStatus: "REJECTED" as const, action: "REJECT" as const },
    ];
  }
  if (status === "TAKEN_DOWN") {
    return [
      { toStatus: "PENDING" as const, action: "SUBMIT" as const },
      { toStatus: "LIVE" as const, action: "APPROVE" as const },
      { toStatus: "TAKEN_DOWN" as const, action: "TAKE_DOWN" as const },
    ];
  }
  if (status === "EXPIRED") {
    return [
      { toStatus: "PENDING" as const, action: "SUBMIT" as const },
      { toStatus: "LIVE" as const, action: "APPROVE" as const },
      { toStatus: "EXPIRED" as const, action: "EXPIRE" as const },
    ];
  }
  if (status === "SOLD") {
    return [
      { toStatus: "PENDING" as const, action: "SUBMIT" as const },
      { toStatus: "LIVE" as const, action: "APPROVE" as const },
      { toStatus: "SOLD" as const, action: "MARK_SOLD" as const },
    ];
  }
  return [
    { toStatus: "PENDING" as const, action: "SUBMIT" as const },
    { toStatus: "LIVE" as const, action: "APPROVE" as const },
  ];
}

export async function applyMarketplacePlan(
  tx: TransactionClient,
  input: {
    plan: MarketplacePlan;
    preservedIdentities: PreservedIdentity[];
    now: Date;
  },
) {
  const preservedUserIds = input.preservedIdentities.map((row) => row.id);
  await wipeMarketplace(tx, preservedUserIds);
  const catalog = await upsertCatalog(tx);
  const defaultRegionId = catalog.regions["iom-central"];

  const dealerIds = new Map<string, { userId: string; dealerId: string }>();
  for (const dealer of input.plan.dealers) {
    const ids = await upsertDealerUser(tx, dealer, defaultRegionId);
    dealerIds.set(dealer.key, ids);
    await writeEntitlement(tx, dealer, ids.dealerId, input.now);
  }

  const sellerIds = new Map<string, string>();
  for (const seller of input.plan.sellers) {
    sellerIds.set(seller.key, await upsertSellerUser(tx, seller, defaultRegionId));
  }
  for (const [key, ids] of dealerIds) {
    sellerIds.set(key, ids.userId);
  }

  const listingIds = new Map<string, string>();
  for (const listing of input.plan.listings) {
    const userId = sellerIds.get(listing.sellerKey);
    if (!userId) throw new Error(`Missing seller ${listing.sellerKey}`);
    const categoryId = catalog.categories[listing.category];
    const regionId = catalog.regions[listing.regionSlug];
    const createdAt = new Date(input.now.getTime() - listing.daysAgo * 86_400_000);
    const expiresAt =
      listing.status === "EXPIRED"
        ? new Date(input.now.getTime() - 5 * 86_400_000)
        : listing.status === "LIVE" || listing.status === "SOLD"
          ? new Date(input.now.getTime() + 45 * 86_400_000)
          : null;
    const created = await tx.listing.create({
      data: {
        userId,
        dealerId: listing.dealerKey
          ? dealerIds.get(listing.dealerKey)?.dealerId
          : null,
        categoryId,
        regionId,
        title: listing.title,
        description: listing.description,
        price: listing.pricePence,
        status: listing.status,
        featured: listing.featured,
        expiresAt,
        soldAt:
          listing.status === "SOLD"
            ? new Date(input.now.getTime() - 3 * 86_400_000)
            : null,
        trustDeclarationAccepted: listing.status !== "DRAFT",
        trustDeclarationAcceptedAt:
          listing.status !== "DRAFT" ? createdAt : null,
        createdAt,
        viewCount: 10 + (listing.daysAgo % 80),
      },
    });
    listingIds.set(listing.key, created.id);

    const attrIds = catalog.attributes[listing.category];
    await tx.listingAttributeValue.createMany({
      data: Object.entries(listing.attributes)
        .filter(([slug]) => attrIds[slug])
        .map(([slug, value]) => ({
          listingId: created.id,
          attributeDefinitionId: attrIds[slug],
          value,
        })),
    });

    await tx.listingImage.createMany({
      data: listing.imageUrls.map((url, order) => ({
        listingId: created.id,
        url,
        publicId: `seed/demo/${listing.key}/${order}`,
        order,
        provider: "EXTERNAL" as const,
        width: 800,
        height: 600,
        format: "jpg",
      })),
    });

    if (listing.status !== "DRAFT") {
      await tx.payment.create({
        data: {
          listingId: created.id,
          paymentProvider: "DEV",
          providerPaymentId: seedPaymentId(listing.key),
          providerReference: seedPaymentReference(listing.key),
          amount: listing.featured ? 999 : 499,
          currency: "gbp",
          type: listing.featured ? "FEATURED" : "LISTING",
          status: "SUCCEEDED",
          idempotencyKey: seedPaymentIdempotencyKey(listing.key),
        },
      });
    }

    let fromStatus: Prisma.ListingStatusEventCreateInput["fromStatus"] = null;
    for (const event of statusEvents(listing.status)) {
      await tx.listingStatusEvent.create({
        data: {
          listingId: created.id,
          fromStatus,
          toStatus: event.toStatus,
          source: event.toStatus === "EXPIRED" ? "SYSTEM" : "ADMIN",
          action: event.action,
          notes: "Demo seed lifecycle",
        },
      });
      fromStatus = event.toStatus;
    }
  }

  for (const review of input.plan.reviews) {
    const dealerId = dealerIds.get(review.dealerKey)?.dealerId;
    const reviewerUserId = sellerIds.get(review.reviewerKey);
    if (!dealerId || !reviewerUserId) continue;
    await tx.dealerReview.create({
      data: {
        dealerId,
        reviewerUserId,
        reviewerType: "REGISTERED",
        reviewerName: review.reviewerKey,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        moderatedAt: review.status === "PENDING" ? null : input.now,
      },
    });
  }

  const liveListingIds = input.plan.listings
    .filter((listing) => listing.status === "LIVE")
    .map((listing) => listingIds.get(listing.key))
    .filter((id): id is string => Boolean(id));
  const reportStatuses = ["OPEN", "OPEN", "DISMISSED", "ACTIONED"] as const;
  for (const [index, status] of reportStatuses.entries()) {
    const listingId = liveListingIds[index];
    if (!listingId) continue;
    await tx.report.create({
      data: {
        listingId,
        reporterEmail: "moderation@example.im",
        reason: "Demo moderation case",
        reasonCode: "MISLEADING",
        status,
        closedAt: status === "OPEN" ? null : input.now,
      },
    });
  }

  for (const identity of input.preservedIdentities) {
    for (const listingId of liveListingIds.slice(0, 3)) {
      await tx.favourite.create({
        data: { userId: identity.id, listingId },
      });
    }
    await tx.savedSearch.create({
      data: {
        userId: identity.id,
        name: "Island cars",
        queryParamsJson: { category: "car", region: "iom-east" },
      },
    });
  }

  const grantDealer = input.plan.dealers.find(
    (dealer) => dealer.entitlement === "PAYMENT" && dealer.tier === "PRO",
  );
  if (grantDealer) {
    const ids = dealerIds.get(grantDealer.key);
    const subscription = await tx.subscription.findUnique({
      where: { providerSubscriptionId: seedSubscriptionId(grantDealer.slug) },
    });
    if (ids && subscription) {
      await tx.dealerCancellationRequest.create({
        data: {
          dealerId: ids.dealerId,
          subscriptionId: subscription.id,
          requestedByUserId: ids.userId,
          status: "REQUESTED",
          idempotencyKey: `seed:demo:cancel:${grantDealer.slug}`,
          periodEndAt: buildPaidEntitlementDates(input.now).currentPeriodEnd,
          notes: "Demo cancellation queue example",
        },
      });
    }
  }

  const identities = await tx.user.findMany({
    where: { id: { in: preservedUserIds } },
    select: { id: true, authUserId: true, email: true, role: true },
  });
  comparePreservedIdentities(input.preservedIdentities, identities);
}
