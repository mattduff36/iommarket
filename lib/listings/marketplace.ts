import type { Prisma } from "@prisma/client";
import { liveListingWhere, liveOrSoldListingWhere } from "@/lib/listings/expiry";

export interface MarketplaceViewer {
  id?: string;
  role: string;
}

export function isMarketplaceAdmin(viewer?: MarketplaceViewer | null) {
  return viewer?.role === "ADMIN";
}

export function adminPreviewListingWhere(): Prisma.ListingWhereInput {
  return {
    status: "ADMIN_PREVIEW",
    previewPack: { enabled: true },
  };
}

export function marketplaceListingWhere(input: {
  viewer?: MarketplaceViewer | null;
  includeSold?: boolean;
  now?: Date;
}): Prisma.ListingWhereInput {
  const publicWhere = input.includeSold
    ? liveOrSoldListingWhere(true, input.now)
    : liveListingWhere(input.now);
  if (!isMarketplaceAdmin(input.viewer)) return publicWhere;
  return {
    OR: [publicWhere, adminPreviewListingWhere()],
  };
}

export const ADMIN_PREVIEW_BADGE = "Preview — not public";

export function marketplaceListingBadge(input: {
  status: string;
  featured?: boolean;
}) {
  if (input.status === "ADMIN_PREVIEW") return ADMIN_PREVIEW_BADGE;
  if (input.featured) return "Featured";
  return undefined;
}
