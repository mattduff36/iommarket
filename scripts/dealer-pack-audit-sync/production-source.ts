import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { downloadSafeRemoteImage } from "../../lib/images/safe-remote-image";
import { dealerSnapshotPath } from "../../lib/preview-packs/archive";
import { detectRasterType } from "../onboard-founding-dealers/media";
import { foundingListingSlug } from "../onboard-founding-dealers/identity";
import { fetchClassicVehicleDetail } from "../import-ocean-inventory/classic";
import { isOceanEligibleLocation } from "../import-ocean-inventory/locations";
import { mapReconciledVehicle as mapOceanVehicle } from "../import-ocean-inventory/map-vehicle";
import { normalizeNetDirectorVehicle } from "../import-ocean-inventory/normalize";
import { reconcileVehicles } from "../import-ocean-inventory/reconcile";
import {
  enrichFrozenDetails,
  fetchVehicleDetail,
  scrapeAllOceanSources,
} from "../import-ocean-inventory/scrape";
import type { NormalizedVehicle } from "../import-ocean-inventory/types";
import {
  imageOwnerIdentityFromProductionListing,
  resolveSharedChecksumOwner,
} from "../dealer-stock-sync/image-ownership";
import type { ArchivedVehicle } from "../dealer-stock-sync/types";
import {
  classifySnapshot,
  hasValidSourceImages,
  NO_VALID_SOURCE_IMAGE_REASON,
  type AuditSnapshotManifest,
} from "./classify";
import { auditRunDir } from "./plan-file";
import type {
  ProductionAccount,
  ProductionExcludedListing,
  ProductionSourceImage,
  ProductionSourceListing,
  ProductionSourceLoad,
} from "./production-types";
import {
  frozenImageQualityError,
  inspectFrozenImage,
} from "./image-quality";

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceChecksum(listings: ProductionSourceListing[]) {
  return sha256(JSON.stringify(listings));
}

export function oceanManagedKey(identityKey: string) {
  return `omv-${sha256(`ocean-managed:${identityKey}`).slice(0, 32)}`;
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function assertUniqueSource(listings: ProductionSourceListing[], dealerKey: string) {
  const identities = new Set<string>();
  const managedKeys = new Set<string>();
  const checksums = new Set<string>();
  for (const listing of listings) {
    if (identities.has(listing.identityKey) || managedKeys.has(listing.managedKey)) {
      throw new Error(`source-identity-ambiguous:${dealerKey}:${listing.identityKey}`);
    }
    identities.add(listing.identityKey);
    managedKeys.add(listing.managedKey);
    for (const image of listing.images) {
      if (checksums.has(image.checksum)) {
        throw new Error(`source-image-not-unique:${dealerKey}:${image.checksum}`);
      }
      checksums.add(image.checksum);
    }
  }
}

function dropWithinListingDuplicates(listing: ProductionSourceListing) {
  const seen = new Set<string>();
  listing.images = listing.images.filter((image) => {
    if (seen.has(image.checksum)) {
      listing.findings.push(`image-rejected:${image.order}:duplicate-content`);
      return false;
    }
    seen.add(image.checksum);
    return true;
  });
}

function sharedChecksumGroups(listings: ProductionSourceListing[]) {
  const groups = new Map<string, Array<{ listing: ProductionSourceListing; imageIndex: number }>>();
  for (const listing of listings) {
    listing.images.forEach((image, imageIndex) => {
      const refs = groups.get(image.checksum) ?? [];
      refs.push({ listing, imageIndex });
      groups.set(image.checksum, refs);
    });
  }
  return groups;
}

function applySharedChecksumToGroup(
  refs: Array<{ listing: ProductionSourceListing; imageIndex: number }>,
) {
  const identityKeys = new Set(refs.map((ref) => ref.listing.identityKey));
  if (identityKeys.size < 2) return;

  const ownerKey = resolveSharedChecksumOwner(
    refs.map((ref) => ({
      identity: imageOwnerIdentityFromProductionListing(ref.listing),
      url: ref.listing.images[ref.imageIndex]!.sourceUrl,
    })),
  );
  const drop = new Set<ProductionSourceImage>();
  let keptOwner = false;
  for (const ref of refs) {
    const image = ref.listing.images[ref.imageIndex]!;
    const keep = ownerKey != null && ref.listing.identityKey === ownerKey && !keptOwner;
    if (keep) {
      keptOwner = true;
      ref.listing.findings.push(`image-kept:${image.order}:owned`);
      continue;
    }
    drop.add(image);
    ref.listing.findings.push(
      ownerKey
        ? `image-rejected:${image.order}:owned-by:${ownerKey}`
        : `image-rejected:${image.order}:shared-across-listings`,
    );
  }
  const affected = new Set(refs.map((ref) => ref.listing));
  for (const listing of affected) {
    listing.images = listing.images.filter((image) => !drop.has(image));
  }
}

export function removeDuplicateSourceImages(listings: ProductionSourceListing[]) {
  for (const listing of listings) dropWithinListingDuplicates(listing);
  for (const refs of sharedChecksumGroups(listings).values()) {
    applySharedChecksumToGroup(refs);
  }
  for (const listing of listings) {
    listing.images = listing.images.map((image, order) => ({ ...image, order }));
    if (!hasValidSourceImages(listing.images)) {
      listing.findings.push(NO_VALID_SOURCE_IMAGE_REASON);
    }
    listing.findings = [...new Set(listing.findings)].sort();
  }
}

export function productionExcludedFromSource(
  listing: ProductionSourceListing,
): ProductionExcludedListing {
  return {
    identityKey: listing.identityKey,
    managedKey: listing.managedKey,
    sourceUrl: listing.sourceUrl,
    title: listing.listing.title,
    reasons: [NO_VALID_SOURCE_IMAGE_REASON],
    findings: [...new Set(listing.findings)].sort(),
  };
}

export function partitionProductionSourceListings(
  listings: ProductionSourceListing[],
) {
  const included: ProductionSourceListing[] = [];
  const excluded: ProductionExcludedListing[] = [];
  for (const listing of listings) {
    if (hasValidSourceImages(listing.images)) included.push(listing);
    else excluded.push(productionExcludedFromSource(listing));
  }
  return { included, excluded };
}

function foundingExcluded(
  account: ProductionAccount,
  classified: ReturnType<typeof classifySnapshot>,
): ProductionExcludedListing[] {
  const fromEvidence = (classified.excludedListings ?? []).map((listing) => ({
    identityKey: listing.identityKey,
    managedKey: foundingListingSlug(account.dealerKey, listing.identityKey),
    sourceUrl: listing.sourceUrl,
    title: listing.title,
    reasons: listing.reasons,
    findings: listing.findings,
  }));
  const leftover = classified.listings
    .filter((listing) => !hasValidSourceImages(listing.images))
    .map((listing) => productionExcludedFromSource({
      identityKey: listing.identityKey,
      managedKey: foundingListingSlug(account.dealerKey, listing.identityKey),
      sourceUrl: listing.sourceUrl,
      slug: foundingListingSlug(account.dealerKey, listing.identityKey),
      listing: { ...listing.listing, regionSlug: account.regionSlug },
      images: [],
      findings: listing.findings,
    }));
  const seen = new Set<string>();
  return [...fromEvidence, ...leftover].filter((listing) => {
    if (seen.has(listing.identityKey)) return false;
    seen.add(listing.identityKey);
    return true;
  });
}

async function loadFoundingSource(account: ProductionAccount, runId: string) {
  const dir = dealerSnapshotPath(account.dealerKey, runId);
  const [manifestBytes, vehiclesBytes] = await Promise.all([
    readFile(join(dir, "manifest.json")),
    readFile(join(dir, "vehicles.json")),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as AuditSnapshotManifest;
  const vehicles = JSON.parse(vehiclesBytes.toString("utf8")) as ArchivedVehicle[];
  if (
    manifest.dealerKey !== account.dealerKey ||
    manifest.displayName.trim() !== account.displayName
  ) {
    throw new Error(`source-archive-account-mismatch:${account.dealerKey}`);
  }
  const classified = classifySnapshot({ manifest, vehicles });
  const explicitNoStock =
    classified.noPublicStock &&
    classified.reasons.every((reason) => reason === "no-public-stock");
  if (!classified.safe && !explicitNoStock) {
    throw new Error(
      `source-archive-incomplete:${account.dealerKey}:${classified.reasons.join(",")}`,
    );
  }
  const byIdentity = new Map(vehicles.map((vehicle) => [vehicle.identityKey, vehicle]));
  const listings: ProductionSourceListing[] = classified.listings
    .filter((planned) => hasValidSourceImages(planned.images))
    .map((planned) => {
      const vehicle = byIdentity.get(planned.identityKey);
      if (!vehicle) throw new Error(`source-vehicle-missing:${planned.identityKey}`);
      const slug = foundingListingSlug(account.dealerKey, planned.identityKey);
      const images: ProductionSourceImage[] = planned.images
        .slice(0, FEATURED_LISTING_PHOTO_LIMIT)
        .map((image, order) => {
          const archived = vehicle.images.find((candidate) =>
            candidate.checksum === image.checksum &&
            candidate.originalUrl === image.sourceUrl);
          if (!archived?.localPath) {
            throw new Error(`source-image-archive-missing:${planned.identityKey}:${order}`);
          }
          return {
            sourceUrl: image.sourceUrl,
            localPath: resolve(archived.localPath),
            checksum: image.checksum,
            contentType: archived.contentType ?? "application/octet-stream",
            width: image.width,
            height: image.height,
            format: image.format,
            bytes: image.bytes,
            order,
          };
        });
      return {
        identityKey: planned.identityKey,
        managedKey: slug,
        sourceUrl: planned.sourceUrl,
        slug,
        listing: { ...planned.listing, regionSlug: account.regionSlug },
        images,
        findings: planned.findings,
      };
    });
  assertUniqueSource(listings, account.dealerKey);
  return {
    runId,
    checksum: sha256(Buffer.concat([manifestBytes, vehiclesBytes])),
    listings,
    excludedListings: foundingExcluded(account, classified),
  };
}

async function scrapeDedicatedOcean() {
  const listed = await scrapeAllOceanSources();
  if (listed.sourceResults.some((source) => source.status !== "ok")) {
    throw new Error("ocean-source-incomplete");
  }
  const enriched = await enrichFrozenDetails(listed.sourceResults, async (sourceKey, vehicle) => {
    if (!isOceanEligibleLocation(vehicle.locationName)) return null;
    const result = listed.sourceResults.find((item) => item.sourceKey === sourceKey);
    const origin = result ? new URL(result.startUrl).origin : null;
    let fromApi: NormalizedVehicle | null = null;
    if (result?.searchContext?.kind !== "classic" && result?.searchContext && vehicle.stockId) {
      const payload = await fetchVehicleDetail({
        context: result.searchContext,
        stockId: vehicle.stockId,
      });
      fromApi = payload ? normalizeNetDirectorVehicle(payload, sourceKey, origin) : null;
    }
    if (!vehicle.detailUrl) return fromApi;
    const fromHtml = await fetchClassicVehicleDetail({ detailUrl: vehicle.detailUrl });
    if (!fromHtml) return fromApi;
    return {
      ...(fromApi ?? vehicle),
      sourceKey,
      description: fromHtml.description || fromApi?.description || vehicle.description,
      imageUrls: [...(fromApi?.imageUrls ?? vehicle.imageUrls), ...fromHtml.imageUrls],
    };
  });
  const outcomes = reconcileVehicles(enriched.sourceResults).map(mapOceanVehicle);
  const unacceptable = outcomes.filter((outcome) =>
    !outcome.listing && outcome.skipReason !== "poa");
  if (unacceptable.length > 0 || enriched.detailMissing > 0) {
    throw new Error(
      `ocean-source-ambiguous:${unacceptable.map((item) =>
        `${item.reconciled.identityKey}:${item.skipReason}`).join(",")}`,
    );
  }
  return {
    startedAt: listed.scrapeStartedAt,
    outcomes: outcomes.filter((outcome) => outcome.listing),
  };
}

async function loadOceanSource(account: ProductionAccount, runId: string) {
  const scraped = await scrapeDedicatedOcean();
  const root = resolve(auditRunDir(runId), "production-source", "ocean");
  await mkdir(root, { recursive: true });
  const listings: ProductionSourceListing[] = [];
  for (const outcome of scraped.outcomes) {
    const mapped = outcome.listing!;
    const managedKey = oceanManagedKey(outcome.reconciled.identityKey);
    const images: ProductionSourceImage[] = [];
    const findings: string[] = [];
    for (const [order, sourceUrl] of mapped.imageUrls
      .slice(0, FEATURED_LISTING_PHOTO_LIMIT)
      .entries()) {
      let downloaded;
      try {
        downloaded = await downloadSafeRemoteImage({ url: sourceUrl });
      } catch (error) {
        findings.push(
          `image-rejected:${order}:download-failed:${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      const bytes = Buffer.from(downloaded.bytes);
      const checksum = sha256(bytes);
      const metadata = inspectFrozenImage(bytes);
      const qualityError = frozenImageQualityError(metadata);
      if (!metadata || qualityError) {
        findings.push(`image-rejected:${order}:${qualityError ?? "invalid-metadata"}`);
        continue;
      }
      const localPath = join(root, `${sanitize(outcome.reconciled.identityKey)}-${order}-${checksum.slice(0, 12)}.img`);
      await writeFile(localPath, bytes, { flag: "wx" });
      images.push({
        sourceUrl,
        localPath,
        checksum,
        contentType: downloaded.contentType ?? detectRasterType(bytes),
        ...metadata,
        order: images.length,
      });
    }
    listings.push({
      identityKey: outcome.reconciled.identityKey,
      managedKey,
      sourceUrl: outcome.reconciled.vehicle.detailUrl,
      slug: managedKey,
      listing: {
        title: mapped.title,
        description: mapped.description,
        pricePence: mapped.pricePence,
        categorySlug: mapped.categorySlug,
        regionSlug: mapped.regionSlug,
        attributes: mapped.attributes,
        imageUrls: mapped.imageUrls,
      },
      images,
      findings:
        hasValidSourceImages(images)
          ? findings
          : [...findings, NO_VALID_SOURCE_IMAGE_REASON],
    });
  }
  removeDuplicateSourceImages(listings);
  assertUniqueSource(listings, account.dealerKey);
  const sorted = listings.sort((a, b) => a.managedKey.localeCompare(b.managedKey));
  const partitioned = partitionProductionSourceListings(sorted);
  return {
    runId: `ocean-${scraped.startedAt.toISOString()}`,
    checksum: sourceChecksum(sorted),
    listings: partitioned.included,
    excludedListings: partitioned.excluded,
  };
}

export async function loadProductionSource(
  account: ProductionAccount,
  planRunId: string,
  foundingSourceRunId = planRunId,
): Promise<ProductionSourceLoad> {
  return account.sourceKind === "founding"
    ? loadFoundingSource(account, foundingSourceRunId)
    : loadOceanSource(account, planRunId);
}
