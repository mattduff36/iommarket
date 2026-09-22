import type { Prisma } from "@prisma/client";
import { liveListingWhere, liveOrSoldListingWhere } from "@/lib/listings/expiry";
import {
  applySampleListingVisibility,
  DEFAULT_SAMPLE_VISIBILITY,
  getSampleVisibility,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";

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
  sampleVisibility?: SampleVisibility;
}): Prisma.ListingWhereInput {
  const publicWhere = input.includeSold
    ? liveOrSoldListingWhere(true, input.now)
    : liveListingWhere(input.now);
  const visible = isMarketplaceAdmin(input.viewer)
    ? { OR: [publicWhere, adminPreviewListingWhere()] }
    : publicWhere;
  return applySampleListingVisibility(
    visible,
    input.sampleVisibility ?? DEFAULT_SAMPLE_VISIBILITY,
  );
}

export async function marketplaceListingWhereWithSettings(input: {
  viewer?: MarketplaceViewer | null;
  includeSold?: boolean;
  now?: Date;
}): Promise<Prisma.ListingWhereInput> {
  return marketplaceListingWhere({
    ...input,
    sampleVisibility: await getSampleVisibility(),
  });
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
