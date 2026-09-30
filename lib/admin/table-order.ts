import type { Prisma } from "@prisma/client";
import type { PreviewPackListRow } from "@/lib/preview-packs/archive";
import type { AdminSortDirection, AdminSortState } from "@/lib/admin/table-state";

function tieBreak<T>(order: readonly T[]) {
  return [...order, { id: "asc" as const }];
}

export function listingOrderBy(
  sort: AdminSortState,
): Prisma.ListingOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "title":
      return tieBreak([{ title: direction }]);
    case "seller":
      return tieBreak([{ user: { name: direction } }, { user: { email: direction } }]);
    case "category":
      return tieBreak([{ category: { name: direction } }]);
    case "price":
      return tieBreak([{ price: direction }]);
    case "status":
      return tieBreak([{ status: direction }]);
    case "reports":
      return tieBreak([{ reports: { _count: direction } }]);
    case "approved":
      return tieBreak([{ approvedAt: direction }]);
    case "region":
      return tieBreak([{ region: { name: direction } }]);
    case "featured":
      return tieBreak([{ featured: direction }]);
    case "views":
      return tieBreak([{ viewCount: direction }]);
    case "expires":
      return tieBreak([{ expiresAt: direction }]);
    case "created":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function userOrderBy(sort: AdminSortState): Prisma.UserOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "user":
      return tieBreak([{ name: direction }, { email: direction }]);
    case "access":
      return tieBreak([{ role: direction }]);
    case "region":
      return tieBreak([{ region: { name: direction } }]);
    case "dealer":
      return tieBreak([{ dealerProfile: { name: direction } }]);
    case "listings":
      return tieBreak([{ listings: { _count: direction } }]);
    case "phone":
      return tieBreak([{ phone: direction }]);
    case "updated":
      return tieBreak([{ updatedAt: direction }]);
    case "joined":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function dealerOrderBy(
  sort: AdminSortState,
): Prisma.DealerProfileOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "dealer":
      return tieBreak([{ name: direction }]);
    case "owner":
      return tieBreak([{ user: { name: direction } }, { user: { email: direction } }]);
    case "verified":
      return tieBreak([{ verified: direction }]);
    case "listings":
      return tieBreak([{ listings: { _count: direction } }]);
    case "tier":
      return tieBreak([{ tier: direction }]);
    case "updated":
      return tieBreak([{ updatedAt: direction }]);
    case "joined":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function paymentOrderBy(
  sort: AdminSortState,
): Prisma.PaymentOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "listing":
      return tieBreak([{ listing: { title: direction } }]);
    case "type":
      return tieBreak([{ type: direction }]);
    case "amount":
      return tieBreak([{ amount: direction }]);
    case "status":
      return tieBreak([{ status: direction }]);
    case "provider":
      return tieBreak([{ paymentProvider: direction }]);
    case "currency":
      return tieBreak([{ currency: direction }]);
    case "refunded":
      return tieBreak([{ refundedAt: direction }]);
    case "date":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function subscriptionOrderBy(
  sort: AdminSortState,
): Prisma.SubscriptionOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "dealer":
      return tieBreak([{ dealer: { name: direction } }]);
    case "status":
      return tieBreak([{ status: direction }]);
    case "source":
      return tieBreak([{ source: direction }]);
    case "provider":
      return tieBreak([{ paymentProvider: direction }]);
    case "tier":
      return tieBreak([{ dealer: { tier: direction } }]);
    case "cancel":
      return tieBreak([{ cancelAtPeriodEnd: direction }]);
    case "created":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function waitlistOrderBy(
  sort: AdminSortState,
): Prisma.WaitlistUserOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "email":
      return tieBreak([{ email: direction }]);
    case "source":
      return tieBreak([{ source: direction }]);
    case "consent":
      return tieBreak([{ marketingConsentAt: direction }]);
    case "deleted":
      return tieBreak([{ deletedAt: direction }]);
    case "joined":
    default:
      return tieBreak([{ createdAt: direction }]);
  }
}

export function contentPageOrderBy(
  sort: AdminSortState,
): Prisma.ContentPageOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "title":
      return tieBreak([{ title: direction }]);
    case "slug":
      return tieBreak([{ slug: direction }]);
    case "status":
      return tieBreak([{ status: direction }]);
    case "created":
      return tieBreak([{ createdAt: direction }]);
    case "published":
      return tieBreak([{ publishedAt: direction }]);
    case "updated":
    default:
      return tieBreak([{ updatedAt: direction }]);
  }
}

export function cancellationOrderBy(
  sort: AdminSortState,
): Prisma.DealerCancellationRequestOrderByWithRelationInput[] {
  const direction = sort.direction;
  switch (sort.column) {
    case "dealer":
      return tieBreak([{ dealer: { name: direction } }]);
    case "status":
      return tieBreak([{ status: direction }]);
    case "period":
      return tieBreak([{ periodEndAt: direction }]);
    case "processed":
      return tieBreak([{ processedAt: direction }]);
    case "requested":
    default:
      return tieBreak([{ requestedAt: direction }]);
  }
}

function compareText(left: string, right: string, direction: AdminSortDirection) {
  const compared = left.localeCompare(right, "en-GB", { sensitivity: "base" });
  return direction === "asc" ? compared : -compared;
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: AdminSortDirection,
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function compareNullableText(
  left: string | null,
  right: string | null,
  direction: AdminSortDirection,
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareText(left, right, direction);
}

function comparePreviewPack(
  left: PreviewPackListRow,
  right: PreviewPackListRow,
  sort: AdminSortState,
) {
  switch (sort.column) {
    case "snapshot":
      return compareNullableText(left.runId, right.runId, sort.direction);
    case "importable":
      return compareNullableNumber(left.importable, right.importable, sort.direction);
    case "database":
      return compareNullableNumber(left.listingCount, right.listingCount, sort.direction);
    case "vehicles":
      return compareNullableNumber(left.uniqueVehicles, right.uniqueVehicles, sort.direction);
    case "dealer":
    default:
      return compareText(left.displayName, right.displayName, sort.direction);
  }
}

export function sortPreviewPackRows(
  rows: readonly PreviewPackListRow[],
  sort: AdminSortState,
) {
  return [...rows].sort((left, right) => {
    const compared = comparePreviewPack(left, right, sort);
    return compared === 0
      ? left.dealerKey.localeCompare(right.dealerKey, "en-GB")
      : compared;
  });
}
