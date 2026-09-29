import type { Prisma, PrismaClient } from "@prisma/client";
import { IMAGE_CONSTRAINTS } from "../../lib/images/constraints";
import type {
  ProductionAccount,
  ProductionAccountBaseline,
  ProductionListingAction,
  ProductionListingBaseline,
  ProductionSourceListing,
} from "./production-types";

export const FOUNDING_IMPORT_NOTES =
  "Founding dealer archive import by admin@mpdee.co.uk (administrative, not dealer acceptance).";
export const OCEAN_IMPORT_NOTES = "Ocean inventory import";

const LISTING_SELECT = {
  id: true,
  userId: true,
  dealerId: true,
  slug: true,
  previewPackId: true,
  title: true,
  description: true,
  price: true,
  status: true,
  featured: true,
  expiresAt: true,
  trustDeclarationAccepted: true,
  trustDeclarationAcceptedAt: true,
  photoRevision: true,
  lifecycleRevision: true,
  updatedAt: true,
  category: { select: { slug: true } },
  region: { select: { slug: true } },
  attributeValues: {
    select: {
      id: true,
      value: true,
      attributeDefinition: { select: { slug: true } },
    },
  },
  images: {
    select: {
      id: true,
      url: true,
      publicId: true,
      provider: true,
      assetId: true,
      version: true,
      width: true,
      height: true,
      format: true,
      bytes: true,
      order: true,
    },
  },
  statusEvents: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      changedByUserId: true,
      source: true,
      action: true,
      notes: true,
      createdAt: true,
    },
  },
  revisions: {
    select: { id: true, status: true, updatedAt: true },
  },
} satisfies Prisma.ListingSelect;

type SelectedListing = Prisma.ListingGetPayload<{ select: typeof LISTING_SELECT }>;

function iso(value: Date | string | null) {
  return value == null ? null : new Date(value).toISOString();
}

function captureListing(listing: SelectedListing): ProductionListingBaseline {
  return {
    id: listing.id,
    userId: listing.userId,
    dealerId: listing.dealerId,
    slug: listing.slug,
    previewPackId: listing.previewPackId,
    title: listing.title,
    description: listing.description,
    price: listing.price,
    status: listing.status,
    featured: listing.featured,
    categorySlug: listing.category.slug,
    regionSlug: listing.region.slug,
    expiresAt: iso(listing.expiresAt),
    trustDeclarationAccepted: listing.trustDeclarationAccepted,
    trustDeclarationAcceptedAt: iso(listing.trustDeclarationAcceptedAt),
    photoRevision: listing.photoRevision,
    lifecycleRevision: listing.lifecycleRevision,
    updatedAt: iso(listing.updatedAt)!,
    attributes: listing.attributeValues
      .map((item) => ({
        id: item.id,
        slug: item.attributeDefinition.slug,
        value: item.value,
      }))
      .sort((left, right) => left.slug.localeCompare(right.slug) || left.id.localeCompare(right.id)),
    images: listing.images
      .map((image) => ({ ...image, provider: String(image.provider) }))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    statusEvents: listing.statusEvents
      .map((event) => ({
        ...event,
        fromStatus: event.fromStatus ? String(event.fromStatus) : null,
        toStatus: String(event.toStatus),
        source: String(event.source),
        action: event.action ? String(event.action) : null,
        createdAt: event.createdAt.toISOString(),
      }))
      .sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    revisions: listing.revisions
      .map((revision) => ({
        id: revision.id,
        status: String(revision.status),
        updatedAt: revision.updatedAt.toISOString(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export async function captureProductionAccountBaseline(
  prisma: PrismaClient | Prisma.TransactionClient,
  account: ProductionAccount,
): Promise<ProductionAccountBaseline> {
  const users = await prisma.user.findMany({
    where: { email: { equals: account.email, mode: "insensitive" } },
    take: 2,
    select: {
      id: true,
      authUserId: true,
      email: true,
      role: true,
      updatedAt: true,
      dealerProfile: {
        select: {
          id: true,
          userId: true,
          name: true,
          slug: true,
          tier: true,
          verified: true,
          isAdminPreview: true,
          updatedAt: true,
          listings: { select: LISTING_SELECT },
        },
      },
    },
  });
  if (users.length !== 1 || !users[0]?.dealerProfile) {
    throw new Error(`production-account-not-unique:${account.dealerKey}`);
  }
  const user = users[0]!;
  const dealer = user.dealerProfile!;
  const identityMismatches = [
    user.email.toLowerCase() !== account.email ? "email" : null,
    !["USER", "DEALER"].includes(user.role) ? "role" : null,
    dealer.name.trim() !== account.displayName ? "dealer-name" : null,
    dealer.userId !== user.id ? "dealer-owner" : null,
    dealer.tier !== "PRO" ? "tier" : null,
    dealer.isAdminPreview ? "admin-preview" : null,
  ].filter((value): value is string => value !== null);
  if (identityMismatches.length > 0) {
    throw new Error(
      `production-account-identity-mismatch:${account.dealerKey}:${identityMismatches.join(",")}`,
    );
  }
  return {
    user: {
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      role: user.role,
      updatedAt: user.updatedAt.toISOString(),
    },
    dealer: {
      id: dealer.id,
      userId: dealer.userId,
      name: dealer.name,
      slug: dealer.slug,
      tier: dealer.tier,
      verified: dealer.verified,
      isAdminPreview: dealer.isAdminPreview,
      updatedAt: dealer.updatedAt.toISOString(),
    },
    listings: dealer.listings
      .map(captureListing)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function hasLifecycleEvidence(
  listing: ProductionListingBaseline,
  notes: string,
  requireActor = false,
) {
  const expected = [
    [null, "DRAFT", "SYSTEM_BACKFILL"],
    ["DRAFT", "PENDING", "SUBMIT"],
    ["PENDING", "LIVE", "APPROVE"],
  ];
  return expected.every(([fromStatus, toStatus, action]) =>
    listing.statusEvents.some((event) =>
      event.fromStatus === fromStatus &&
      event.toStatus === toStatus &&
      event.action === action &&
      event.source === "ADMIN" &&
      (!requireActor || Boolean(event.changedByUserId)) &&
      event.notes === notes),
  );
}

const FOUNDING_SLUG = /^fd-([a-z0-9-]+)-[a-f0-9]{32}$/;
const OCEAN_GENERIC_PREFIXES = [
  `${IMAGE_CONSTRAINTS.folder}/import/`,
  `${IMAGE_CONSTRAINTS.folder}/repair/`,
] as const;

export type ProvenanceResult =
  | { kind: "managed"; managedKey: string }
  | { kind: "unmanaged" }
  | { kind: "ambiguous"; reason: string };

function extractOceanManagedKey(
  listing: ProductionListingBaseline,
  userId: string,
  dealerKey: string,
) {
  const importPrefix = `${IMAGE_CONSTRAINTS.folder}/import/${userId}/`;
  const keys = new Set<string>();
  for (const image of listing.images) {
    if (!image.publicId.startsWith(importPrefix)) continue;
    const key = image.publicId.slice(importPrefix.length).split("/")[0];
    if (key) keys.add(key);
  }
  const repairMarker = `${IMAGE_CONSTRAINTS.folder}/repair/dealer-pack-audit/`;
  for (const image of listing.images) {
    if (!image.publicId.startsWith(repairMarker)) continue;
    const parts = image.publicId.slice(repairMarker.length).split("/");
    const dealerIndex = parts.indexOf(dealerKey);
    const key = dealerIndex >= 0 ? parts[dealerIndex + 1] : null;
    if (key) keys.add(key);
  }
  if (keys.size > 1) return null;
  return [...keys][0] ?? null;
}

function isExactOceanOwnedImage(
  publicId: string,
  userId: string,
  dealerKey: string,
  listingId: string,
) {
  if (publicId.startsWith(`${IMAGE_CONSTRAINTS.folder}/import/${userId}/`)) {
    return true;
  }
  const legacyRepairPrefix = `${IMAGE_CONSTRAINTS.folder}/repair/`;
  if (
    publicId.startsWith(legacyRepairPrefix) &&
    !publicId.startsWith(`${legacyRepairPrefix}dealer-pack-audit/`)
  ) {
    const parts = publicId.slice(legacyRepairPrefix.length).split("/");
    return (
      parts.length >= 3 &&
      parts[1] === listingId &&
      /^\d+$/.test(parts.at(-1) ?? "")
    );
  }
  const repairPrefix = `${IMAGE_CONSTRAINTS.folder}/repair/dealer-pack-audit/`;
  if (!publicId.startsWith(repairPrefix)) return false;
  const parts = publicId.slice(repairPrefix.length).split("/");
  return parts.length >= 4 && parts[1] === dealerKey;
}

export function classifyProductionListingProvenance(input: {
  account: ProductionAccount;
  baseline: ProductionAccountBaseline;
  listing: ProductionListingBaseline;
}): ProvenanceResult {
  const { account, baseline, listing } = input;
  const exactOwner =
    listing.userId === baseline.user.id &&
    listing.dealerId === baseline.dealer.id &&
    listing.previewPackId === null;

  if (account.sourceKind === "founding") {
    const match = listing.slug ? FOUNDING_SLUG.exec(listing.slug) : null;
    const candidate = Boolean(listing.slug?.startsWith(`fd-${account.dealerKey}-`));
    if (!candidate) return { kind: "unmanaged" };
    if (
      !match ||
      match[1] !== account.dealerKey ||
      !exactOwner ||
      !hasLifecycleEvidence(listing, FOUNDING_IMPORT_NOTES, true)
    ) {
      return { kind: "ambiguous", reason: `founding-provenance:${listing.id}` };
    }
    return { kind: "managed", managedKey: listing.slug! };
  }

  const hasOceanEvidence = hasLifecycleEvidence(listing, OCEAN_IMPORT_NOTES);
  const oceanSlug = listing.slug && /^omv-[a-f0-9]{32}$/.test(listing.slug)
    ? listing.slug
    : null;
  const hasImportLikeImage = listing.images.some((image) =>
    image.provider === "CLOUDINARY" &&
    OCEAN_GENERIC_PREFIXES.some((prefix) => image.publicId.startsWith(prefix)),
  );
  if (!hasOceanEvidence && !hasImportLikeImage && !oceanSlug) {
    return { kind: "unmanaged" };
  }
  const allImagesOwned =
    listing.images.every((image) =>
      image.provider === "CLOUDINARY" &&
      isExactOceanOwnedImage(
        image.publicId,
        baseline.user.id,
        account.dealerKey,
        listing.id,
      ),
    );
  if (!exactOwner || !hasOceanEvidence || !allImagesOwned) {
    return { kind: "ambiguous", reason: `ocean-provenance:${listing.id}` };
  }
  const managedKey =
    oceanSlug ??
    extractOceanManagedKey(listing, baseline.user.id, account.dealerKey) ??
    `legacy-ocean-${listing.id}`;
  return { kind: "managed", managedKey };
}

export function planManagedNamespace(input: {
  account: ProductionAccount;
  baseline: ProductionAccountBaseline;
  source: ProductionSourceListing[];
}) {
  const blockers: string[] = [];
  const current = new Map<string, ProductionListingBaseline>();
  for (const listing of input.baseline.listings) {
    const provenance = classifyProductionListingProvenance({
      account: input.account,
      baseline: input.baseline,
      listing,
    });
    if (provenance.kind === "ambiguous") {
      blockers.push(provenance.reason);
      continue;
    }
    if (provenance.kind === "managed") {
      if (
        listing.revisions.some((revision) =>
          revision.status === "DRAFT" || revision.status === "PENDING")
      ) {
        blockers.push(`open-listing-revision:${listing.id}`);
      }
      if (current.has(provenance.managedKey)) {
        blockers.push(`duplicate-managed-key:${provenance.managedKey}`);
      } else {
        current.set(provenance.managedKey, listing);
      }
    }
  }

  const sourceByKey = new Map<string, ProductionSourceListing>();
  for (const listing of input.source) {
    if (sourceByKey.has(listing.managedKey)) {
      blockers.push(`duplicate-source-key:${listing.managedKey}`);
    } else {
      sourceByKey.set(listing.managedKey, listing);
    }
  }

  const actions: ProductionListingAction[] = [];
  for (const source of [...sourceByKey.values()].sort((a, b) =>
    a.managedKey.localeCompare(b.managedKey))) {
    const existing = current.get(source.managedKey);
    if (existing && existing.status !== "LIVE" && existing.status !== "TAKEN_DOWN") {
      blockers.push(`managed-status-ambiguous:${existing.id}:${existing.status}`);
    }
    actions.push(existing
      ? {
          kind: "update",
          identityKey: source.identityKey,
          listingId: existing.id,
          source,
        }
      : { kind: "create", identityKey: source.identityKey, source });
    current.delete(source.managedKey);
  }
  for (const [managedKey, listing] of [...current.entries()].sort(([a], [b]) =>
    a.localeCompare(b))) {
    if (listing.status !== "TAKEN_DOWN" && listing.status !== "LIVE") {
      blockers.push(`stale-status-ambiguous:${listing.id}:${listing.status}`);
    } else if (listing.status !== "TAKEN_DOWN") {
      actions.push({
        kind: "take_down",
        identityKey: managedKey,
        listingId: listing.id,
        fromStatus: listing.status,
      });
    }
  }
  return { actions, blockers: [...new Set(blockers)].sort() };
}

export function assertProductionBaselineMatches(
  expected: ProductionAccountBaseline,
  current: ProductionAccountBaseline,
) {
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new Error("Refusing production audit sync: full account baseline changed.");
  }
}
