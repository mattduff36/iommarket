import type { CatalogueIdentityLookup } from "../../lib/vehicle-catalogue/identity";
import { evaluateLookupIdentity } from "./enrich-identity";
import {
  applyPlateVrms,
  buildMatchCandidates,
  matchListingsToVehicles,
  requiredSourcesUnhealthy,
} from "./enrich-match";
import { lookupValuesBySlug, mergeEmptyAttributes } from "./enrich-merge";
import { lookupWithPacing } from "./enrich-lookup";
import { PlateOverrideError, validatePlateOverrides } from "./enrich-plates";
import { buildSnapshot } from "./enrich-snapshot";
import {
  ENRICH_APPROVED_SLUGS,
  type EnrichListing,
  type EnrichReasonCode,
  type EnrichSnapshot,
  type ListingMatch,
  type LookupFn,
  type PlateOverride,
  type SnapshotListing,
} from "./enrich-types";
import type { SourceListResult } from "./types";

export interface LeftoverManifestListing {
  listingId: string;
  title: string;
  reason: EnrichReasonCode;
  photoUrls: string[];
}

export interface EnrichReportRow {
  listingId: string;
  title: string;
  reason: EnrichReasonCode;
  matchMethod: ListingMatch["matchMethod"];
  vrmMasked: string | null;
  filledSlugs: string[];
}

export interface EnrichPipelineReport {
  runId: string;
  dealerId: string;
  snapshotDigest: string | null;
  counts: Record<string, number>;
  rows: EnrichReportRow[];
  leftovers: LeftoverManifestListing[];
  skipped: Array<{
    listingId: string;
    title: string;
    reason: EnrichReasonCode;
    vrmMasked: string | null;
  }>;
}

export interface EnrichPipelineResult {
  report: EnrichPipelineReport;
  snapshot: EnrichSnapshot | null;
  applied: boolean;
}

function countBy(rows: EnrichReportRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  }
  return counts;
}

function lookupIdentity(result: {
  vehicle?: { make: string | null; model: string | null; yearOfManufacture: number | null } | null;
  motHistory?: { make: string | null; model: string | null } | null;
}) {
  return {
    make: result.vehicle?.make ?? result.motHistory?.make ?? null,
    model: result.vehicle?.model ?? result.motHistory?.model ?? null,
    year: result.vehicle?.yearOfManufacture ?? null,
  };
}

function operationsForFills(listing: EnrichListing, fills: Record<string, string>): SnapshotListing | null {
  const operations = [];
  for (const slug of ENRICH_APPROVED_SLUGS) {
    const afterValue = fills[slug];
    if (!afterValue) continue;
    const definition = listing.definitions.find((item) => item.slug === slug);
    if (!definition) continue;
    const row = listing.attributeRows.find((item) => item.slug === slug);
    operations.push({
      attributeDefinitionId: definition.id,
      slug,
      existed: Boolean(row),
      beforeValue: row ? row.value : null,
      afterValue,
    });
  }
  if (operations.length === 0) return null;
  return { listingId: listing.id, categoryId: listing.categoryId, operations };
}

export async function runEnrichPipeline(input: {
  dealerId: string;
  listings: EnrichListing[];
  sourceResults: SourceListResult[];
  overrides?: PlateOverride[];
  lookup: LookupFn;
  sleep: (ms: number) => Promise<void>;
  delayMs: number;
  apply: boolean;
  runId: string;
  createdAt: string;
  catalogueLookup?: CatalogueIdentityLookup;
  persistSnapshot?: (snapshot: EnrichSnapshot) => Promise<void>;
  applySnapshot?: (snapshot: EnrichSnapshot) => Promise<void>;
}): Promise<EnrichPipelineResult> {
  const unhealthy = requiredSourcesUnhealthy(input.sourceResults);
  if (input.apply && unhealthy) {
    throw new Error(unhealthy);
  }

  const validatedOverrides = input.overrides
    ? validatePlateOverrides({ overrides: input.overrides, listings: input.listings })
    : [];
  const overrideByListing = new Map(validatedOverrides.map((item) => [item.listingId, item]));

  const scrapedMatches = matchListingsToVehicles({
    listings: input.listings,
    vehicles: buildMatchCandidates(input.sourceResults),
  });
  for (const override of validatedOverrides) {
    const existing = scrapedMatches.find((match) => match.listingId === override.listingId);
    if (existing?.vrm) {
      throw new PlateOverrideError(`Override for already-matched listing ${override.listingId}`);
    }
  }
  const matches = applyPlateVrms({
    matches: scrapedMatches,
    assignments: validatedOverrides.map((item) => ({ listingId: item.listingId, vrm: item.vrm })),
  });
  const listingsById = new Map(input.listings.map((listing) => [listing.id, listing]));
  const rows: EnrichReportRow[] = [];
  const snapshotListings: SnapshotListing[] = [];

  const lookupItems = matches.filter((match) => match.vrm);
  const lookupOutcomes = await lookupWithPacing({
    items: lookupItems,
    delayMs: input.delayMs,
    sleep: input.sleep,
    lookup: (match) => input.lookup(match.vrm!),
  });
  const lookupByListing = new Map(lookupOutcomes.map((outcome) => [outcome.item.listingId, outcome]));

  for (const match of matches) {
    const listing = listingsById.get(match.listingId);
    if (!listing) continue;
    const baseRow = {
      listingId: listing.id,
      title: listing.title,
      matchMethod: match.matchMethod,
      vrmMasked: match.vrmMasked,
      filledSlugs: [] as string[],
    };
    if (!match.vrm) {
      rows.push({ ...baseRow, reason: match.reason });
      continue;
    }

    const outcome = lookupByListing.get(listing.id);
    if (!outcome || !outcome.ok) {
      rows.push({ ...baseRow, reason: "skip-lookup-failed" });
      continue;
    }

    const override = overrideByListing.get(listing.id);
    const identity = lookupIdentity(outcome.result);
    const agreed = await evaluateLookupIdentity({
      listingMake: listing.make.trim() || override?.expectedMake || "",
      listingModel: listing.model.trim() || override?.expectedModel || "",
      listingYear: listing.year.trim() || override?.expectedYear || "",
      lookupMake: identity.make,
      lookupModel: identity.model,
      lookupYear: identity.year,
      catalogueLookup: input.catalogueLookup,
    });
    if (!agreed.ok) {
      rows.push({ ...baseRow, reason: agreed.reason });
      continue;
    }

    const merged = mergeEmptyAttributes({
      current: listing.attributes,
      lookupBySlug: lookupValuesBySlug({
        definitions: listing.definitions,
        result: outcome.result,
      }),
    });
    const fills = Object.fromEntries(
      Object.entries(merged.fills).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    if (Object.keys(fills).length === 0) {
      rows.push({ ...baseRow, reason: "skip-no-empty-fields" });
      continue;
    }
    const snapshotListing = operationsForFills(listing, fills);
    if (!snapshotListing) {
      rows.push({ ...baseRow, reason: "skip-no-empty-fields" });
      continue;
    }
    snapshotListings.push(snapshotListing);
    rows.push({
      ...baseRow,
      reason: "applied",
      filledSlugs: snapshotListing.operations.map((operation) => operation.slug),
    });
  }

  const snapshot =
    snapshotListings.length > 0
      ? buildSnapshot({
          runId: input.runId,
          dealerId: input.dealerId,
          createdAt: input.createdAt,
          listings: snapshotListings,
        })
      : null;

  let applied = false;
  if (input.apply && snapshot) {
    if (!input.persistSnapshot) {
      throw new Error("Apply was requested without a persistSnapshot implementation.");
    }
    await input.persistSnapshot(snapshot);
    if (!input.applySnapshot) {
      throw new Error("Apply was requested without an applySnapshot implementation.");
    }
    await input.applySnapshot(snapshot);
    applied = true;
  }

  const leftovers = matches
    .filter((match) => !match.vrm)
    .map((match) => {
      const listing = listingsById.get(match.listingId)!;
      return {
        listingId: listing.id,
        title: listing.title,
        reason: match.reason,
        photoUrls: listing.photoUrls,
      };
    });
  const skipped = rows
    .filter((row) => row.reason.startsWith("skip-") || row.reason.startsWith("leftover-"))
    .map((row) => ({
      listingId: row.listingId,
      title: row.title,
      reason: row.reason,
      vrmMasked: row.vrmMasked,
    }));

  return {
    snapshot,
    applied,
    report: {
      runId: input.runId,
      dealerId: input.dealerId,
      snapshotDigest: snapshot?.digest ?? null,
      counts: countBy(rows),
      rows,
      leftovers,
      skipped,
    },
  };
}
