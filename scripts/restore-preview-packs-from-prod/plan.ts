import {
  assertPreviewDealerAllowed,
  isExcludedPreviewDealerKey,
  isPreviewSystemAuthUserId,
  isPreviewSystemEmail,
  previewDealerSlug,
  previewSystemAuthUserId,
  previewSystemEmail,
} from "../../lib/preview-packs/safety";
import { registryGroupKey } from "../../lib/preview-packs/archive";

export interface CatalogRow {
  id: string;
  slug: string;
}

export interface AttributeRow extends CatalogRow {
  categoryId: string;
}

export interface CatalogMaps {
  categoryId: Map<string, string>;
  regionId: Map<string, string>;
  attributeId: Map<string, string>;
}

export interface SourceImage {
  publicId: string;
  url: string;
  order: number;
  provider: "CLOUDINARY";
  assetId: string | null;
  version: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  focalX: number | null;
  focalY: number | null;
}

export interface SourceListing {
  id: string;
  status: string;
  title: string;
  description: string;
  price: number;
  categorySlug: string;
  regionSlug: string;
  slug: string | null;
  trustDeclarationAccepted: boolean;
  trustDeclarationAcceptedAt: Date | null;
  images: SourceImage[];
  attributes: Array<{ slug: string; value: string }>;
}

export interface SourcePack {
  dealerKey: string;
  displayName: string;
  sourceRunId: string;
  enabled: boolean;
  website: string | null;
  ownerEmail: string;
  ownerAuthUserId: string;
  listings: SourceListing[];
}

export interface RestoreSource {
  packs: SourcePack[];
  extraListings?: Array<{ id: string; status: string; previewPackId: string | null; title: string }>;
  extraUsers?: Array<{ email: string; authUserId: string }>;
}

export interface DestCatalog {
  categories: CatalogRow[];
  regions: CatalogRow[];
  attributes: AttributeRow[];
}

export type RestoreOpKind =
  | "upsertUser"
  | "upsertDealer"
  | "createPack"
  | "createListing"
  | "createAuthUser"
  | "delete";

export interface RestoreOp {
  kind: RestoreOpKind;
}

export interface PlannedAccount {
  dealerKey: string;
  email: string;
  authUserId: string;
  name: string;
  website: string | null;
  slug: string;
}

export interface PlannedPack {
  dealerKey: string;
  displayName: string;
  sourceRunId: string;
  enabled: false;
}

export interface PlannedListing {
  sourceId: string;
  dealerKey: string;
  title: string;
  description: string;
  price: number;
  categoryId: string;
  regionId: string;
  slug: string | null;
  trustDeclarationAccepted: boolean;
  trustDeclarationAcceptedAt: Date | null;
  images: SourceImage[];
  attributes: Array<{ attributeDefinitionId: string; value: string }>;
}

export interface RestorePlan {
  accounts: PlannedAccount[];
  packs: PlannedPack[];
  listings: PlannedListing[];
  skippedOcean: string[];
  ops: RestoreOp[];
}

function bySlug(rows: CatalogRow[]) {
  return new Map(rows.map((row) => [row.slug, row.id]));
}

export function remapCatalogIds(input: {
  source: DestCatalog;
  dest: DestCatalog;
}): CatalogMaps {
  const destCategories = bySlug(input.dest.categories);
  const destRegions = bySlug(input.dest.regions);
  const destAttributes = new Map(
    input.dest.attributes.map((row) => [`${row.categoryId}:${row.slug}`, row.id]),
  );
  const sourceCategorySlug = new Map(input.source.categories.map((row) => [row.id, row.slug]));
  const categoryId = new Map<string, string>();
  for (const source of input.source.categories) {
    const destId = destCategories.get(source.slug);
    if (!destId) throw new Error(`Missing destination category ${source.slug}.`);
    categoryId.set(source.id, destId);
  }
  const regionId = new Map<string, string>();
  for (const source of input.source.regions) {
    const destId = destRegions.get(source.slug);
    if (!destId) throw new Error(`Missing destination region ${source.slug}.`);
    regionId.set(source.id, destId);
  }
  const attributeId = new Map<string, string>();
  for (const source of input.source.attributes) {
    const destCategoryId = categoryId.get(source.categoryId);
    const slug = sourceCategorySlug.get(source.categoryId);
    if (!destCategoryId || !slug) continue;
    const destId = destAttributes.get(`${destCategoryId}:${source.slug}`);
    if (destId) attributeId.set(source.id, destId);
  }
  return { categoryId, regionId, attributeId };
}

function destIdBySlug(rows: CatalogRow[], slug: string, kind: string) {
  const id = bySlug(rows).get(slug);
  if (!id) throw new Error(`Missing destination ${kind} ${slug}.`);
  return id;
}

function isCopyableListing(listing: SourceListing) {
  return listing.status === "ADMIN_PREVIEW";
}

function isCopyableAccount(pack: SourcePack) {
  return isPreviewSystemEmail(pack.ownerEmail) || isPreviewSystemAuthUserId(pack.ownerAuthUserId);
}

export function planRestore(input: {
  source: RestoreSource;
  destCatalog: DestCatalog;
}): RestorePlan {
  const skippedOcean: string[] = [];
  const accounts: PlannedAccount[] = [];
  const packs: PlannedPack[] = [];
  const listings: PlannedListing[] = [];
  const destAttributesByCategory = new Map<string, Map<string, string>>();
  for (const attribute of input.destCatalog.attributes) {
    const byAttrSlug = destAttributesByCategory.get(attribute.categoryId) ?? new Map();
    byAttrSlug.set(attribute.slug, attribute.id);
    destAttributesByCategory.set(attribute.categoryId, byAttrSlug);
  }

  for (const pack of input.source.packs) {
    if (isExcludedPreviewDealerKey(pack.dealerKey, registryGroupKey(pack.dealerKey))) {
      skippedOcean.push(pack.dealerKey);
      continue;
    }
    assertPreviewDealerAllowed({
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      groupKey: registryGroupKey(pack.dealerKey),
      ownerEmail: pack.ownerEmail,
    });
    if (!isCopyableAccount(pack)) continue;

    const account: PlannedAccount = {
      dealerKey: pack.dealerKey,
      email: previewSystemEmail(pack.dealerKey),
      authUserId: previewSystemAuthUserId(pack.dealerKey),
      name: pack.displayName,
      website: pack.website,
      slug: previewDealerSlug(pack.dealerKey),
    };
    accounts.push(account);
    packs.push({
      dealerKey: pack.dealerKey,
      displayName: pack.displayName,
      sourceRunId: pack.sourceRunId,
      enabled: false,
    });

    for (const listing of pack.listings) {
      if (!isCopyableListing(listing)) continue;
      const categoryId = destIdBySlug(input.destCatalog.categories, listing.categorySlug, "category");
      const regionId = destIdBySlug(input.destCatalog.regions, listing.regionSlug, "region");
      const attrIds = destAttributesByCategory.get(categoryId) ?? new Map();
      listings.push({
        sourceId: listing.id,
        dealerKey: pack.dealerKey,
        title: listing.title,
        description: listing.description,
        price: listing.price,
        categoryId,
        regionId,
        slug: listing.slug,
        trustDeclarationAccepted: listing.trustDeclarationAccepted,
        trustDeclarationAcceptedAt: listing.trustDeclarationAcceptedAt,
        images: listing.images,
        attributes: listing.attributes
          .filter((item) => attrIds.has(item.slug))
          .map((item) => ({
            attributeDefinitionId: attrIds.get(item.slug)!,
            value: item.value,
          })),
      });
    }
  }

  const ops: RestoreOp[] = [
    ...accounts.map(() => ({ kind: "upsertUser" as const })),
    ...accounts.map(() => ({ kind: "upsertDealer" as const })),
    ...packs.map(() => ({ kind: "createPack" as const })),
    ...listings.map(() => ({ kind: "createListing" as const })),
  ];

  return { accounts, packs, listings, skippedOcean, ops };
}
