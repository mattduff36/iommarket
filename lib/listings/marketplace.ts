import type { Prisma } from "@prisma/client";
import { liveListingWhere, liveOrSoldListingWhere } from "@/lib/listings/expiry";
import { publicListingSellerWhere } from "./dealer-visibility";
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

export function adminPreviewListingWhere(input?: {
  includeDisabled?: boolean;
}): Prisma.ListingWhereInput {
  return {
    status: "ADMIN_PREVIEW",
    ...(input?.includeDisabled ? {} : { previewPack: { enabled: true } }),
  };
}

export function marketplaceListingWhere(input: {
  viewer?: MarketplaceViewer | null;
  includeSold?: boolean;
  now?: Date;
  sampleVisibility?: SampleVisibility;
  includeDisabledPreviewPacks?: boolean;
}): Prisma.ListingWhereInput {
  const statusWhere = input.includeSold
    ? liveOrSoldListingWhere(true, input.now)
    : liveListingWhere(input.now);
  const publicWhere = { AND: [statusWhere, publicListingSellerWhere(input.now, input.sampleVisibility)] };
  const visible = isMarketplaceAdmin(input.viewer)
    ? {
        OR: [
          publicWhere,
          adminPreviewListingWhere({
            includeDisabled: input.includeDisabledPreviewPacks,
          }),
        ],
      }
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
  includeDisabledPreviewPacks?: boolean;
}): Promise<Prisma.ListingWhereInput> {
  return marketplaceListingWhere({
    ...input,
    sampleVisibility: await getSampleVisibility(),
  });
}

export function combineMarketplaceListingWhere(input: {
  visibility: Prisma.ListingWhereInput;
  filters?: Prisma.ListingWhereInput;
  clauses?: Prisma.ListingWhereInput[];
}): Prisma.ListingWhereInput {
  return {
    ...(input.filters ?? {}),
    AND: [input.visibility, ...(input.clauses ?? [])],
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
