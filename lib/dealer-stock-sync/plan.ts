import { foundingManagedSlug, oceanManagedSlug } from "./legacy-identity";
import { ownedImagesOrNull } from "./images";
import {
  UNPUBLISH_AFTER_ABSENCES,
  type IdentityPatch,
  type InventoryVehicle,
  type PlanAction,
  type StockSyncPlan,
  type SyncIdentity,
  type SyncListing,
} from "./types";

export interface BuildPlanInput {
  scrapeRunId: string;
  registryKey: string;
  regionId: string | null;
  vehicles: InventoryVehicle[];
  identities: SyncIdentity[];
  listings: SyncListing[];
}

function listingById(listings: SyncListing[], id: string | null) {
  if (!id) return null;
  return listings.find((listing) => listing.id === id) ?? null;
}

export function resolveManagedListing(input: {
  registryKey: string;
  sourceIdentityKey: string;
  identity: SyncIdentity | null;
  listings: SyncListing[];
}) {
  const slugs = new Set([
    foundingManagedSlug(input.registryKey, input.sourceIdentityKey),
    oceanManagedSlug(input.sourceIdentityKey),
  ]);
  const matches = input.listings.filter(
    (listing) =>
      listing.id === input.identity?.listingId ||
      listing.reviewSourceIdentity === input.sourceIdentityKey ||
      (listing.slug != null && slugs.has(listing.slug)),
  );
  const ids = [...new Set(matches.map((listing) => listing.id))];
  if (ids.length > 1) {
    return { kind: "conflict" as const, listingId: ids[0] ?? null };
  }
  if (ids.length === 1) {
    return { kind: "listing" as const, listing: matches.find((listing) => listing.id === ids[0]) ?? null };
  }
  return { kind: "none" as const, listing: null };
}

function absencePatch(identity: SyncIdentity, scrapeRunId: string, seen: boolean): IdentityPatch {
  if (seen) {
    return {
      sourceIdentityKey: identity.sourceIdentityKey,
      listingId: identity.listingId,
      absenceCount: 0,
      lastAbsenceRunId: null,
      lastSeenRunId: scrapeRunId,
      baselinePricePence: identity.baselinePricePence,
      baselineMileage: identity.baselineMileage,
    };
  }
  const alreadyCounted = identity.lastAbsenceRunId === scrapeRunId;
  return {
    sourceIdentityKey: identity.sourceIdentityKey,
    listingId: identity.listingId,
    absenceCount: alreadyCounted ? identity.absenceCount : identity.absenceCount + 1,
    lastAbsenceRunId: scrapeRunId,
    lastSeenRunId: identity.lastSeenRunId,
    baselinePricePence: identity.baselinePricePence,
    baselineMileage: identity.baselineMileage,
  };
}

function unpublishBlock(listing: SyncListing | null) {
  if (!listing) return "unmapped";
  if (listing.previewPackId) return "preview-listing";
  if (listing.status === "SOLD" || listing.soldAt) return "sold-preserved";
  if (listing.status === "TAKEN_DOWN") return "manual-taken-down";
  if (listing.openRevision) return "pending-revision";
  if (listing.featured) return "paid-feature";
  if (listing.status !== "LIVE") return "status-preserved";
  return null;
}

function absentAction(identity: SyncIdentity, patch: IdentityPatch, listings: SyncListing[]): PlanAction {
  const listing = listingById(listings, identity.listingId);
  const block = unpublishBlock(listing);
  if (block) {
    return {
      kind: "blocked",
      sourceIdentityKey: identity.sourceIdentityKey,
      listingId: listing?.id ?? null,
      reason: block,
      section: "missing",
    };
  }
  if (patch.absenceCount >= UNPUBLISH_AFTER_ABSENCES && listing) {
    return {
      kind: "unpublish",
      sourceIdentityKey: identity.sourceIdentityKey,
      listingId: listing.id,
      absenceCount: patch.absenceCount,
      lifecycleRevision: listing.lifecycleRevision,
    };
  }
  return {
    kind: "missing_once",
    sourceIdentityKey: identity.sourceIdentityKey,
    listingId: listing?.id ?? null,
    absenceCount: patch.absenceCount,
  };
}

function presentListingAction(
  vehicle: InventoryVehicle,
  listing: SyncListing,
  identity: SyncIdentity | null,
  scrapeRunId: string,
): { action: PlanAction; patch: IdentityPatch } {
  const base = identity ?? {
    sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
    listingId: listing.id,
    absenceCount: 0,
    lastAbsenceRunId: null,
    lastSeenRunId: null,
    baselinePricePence: null,
    baselineMileage: null,
  };
  const patch = absencePatch({ ...base, listingId: listing.id }, scrapeRunId, true);
  const hold = (reason: string, section: "change" | "other"): PlanAction => ({
    kind: "blocked",
    sourceIdentityKey: vehicle.sourceIdentityKey,
    listingId: listing.id,
    reason,
    section,
  });
  if (listing.status === "SOLD" || listing.soldAt) {
    return { action: hold("sold-preserved", "other"), patch };
  }
  if (listing.status === "TAKEN_DOWN") {
    return { action: hold("manual-taken-down", "other"), patch };
  }
  if (listing.openRevision) {
    return { action: hold("pending-revision", "change"), patch };
  }
  if (listing.previewPackId || listing.status !== "LIVE") {
    return { action: hold(listing.previewPackId ? "preview-listing" : "status-preserved", "change"), patch };
  }
  if (vehicle.availability === "sold") return { action: hold("source-sold", "change"), patch };
  if (vehicle.availability === "reserved" || vehicle.isPoa) {
    return {
      action: {
        kind: "unchanged",
        sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
        listingId: listing.id,
      },
      patch,
    };
  }
  if (!vehicle.importable) return { action: hold(vehicle.skipReason ?? "not-importable", "change"), patch };
  if (patch.baselinePricePence == null) {
    return {
      action: {
        kind: "conflict",
        sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
        listingId: listing.id,
        reason: "absent-baseline",
        changes: [],
      },
      patch: {
        ...patch,
        baselinePricePence: listing.price,
        baselineMileage: listing.mileage,
      },
    };
  }
  if (patch.baselinePricePence !== listing.price || patch.baselineMileage !== listing.mileage) {
    return {
      action: {
        kind: "conflict",
        sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
        listingId: listing.id,
        reason: "dealer-edited",
        changes: [],
      },
      patch,
    };
  }
  const changes = [
    vehicle.pricePence != null && vehicle.pricePence !== listing.price
      ? { field: "price" as const, before: listing.price, after: vehicle.pricePence }
      : null,
    vehicle.mileage != null &&
    listing.mileage != null &&
    vehicle.mileage !== listing.mileage
      ? { field: "mileage" as const, before: listing.mileage, after: vehicle.mileage }
      : null,
  ].filter((change) => change != null);
  if (changes.length === 0) {
    return {
      action: {
        kind: "unchanged",
        sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
        listingId: listing.id,
      },
      patch,
    };
  }
  return {
    action: {
      kind: "update",
      sourceIdentityKey: vehicle.sourceIdentityKey ?? "",
      listingId: listing.id,
      changes,
      lifecycleRevision: listing.lifecycleRevision,
      photoRevision: listing.photoRevision,
      featured: listing.featured,
    },
    patch,
  };
}

function newVehicleAction(
  vehicle: InventoryVehicle,
  regionId: string | null,
  scrapeRunId: string,
): { action: PlanAction; patch: IdentityPatch } {
  const key = vehicle.sourceIdentityKey ?? "";
  const patch: IdentityPatch = {
    sourceIdentityKey: key,
    listingId: null,
    absenceCount: 0,
    lastAbsenceRunId: null,
    lastSeenRunId: scrapeRunId,
    baselinePricePence: null,
    baselineMileage: null,
  };
  const blocked = (reason: string): PlanAction => ({
    kind: "blocked",
    sourceIdentityKey: key,
    listingId: null,
    reason,
    section: "new",
  });
  if (!vehicle.importable || !vehicle.title || !vehicle.description || !vehicle.categorySlug) {
    return { action: blocked(vehicle.skipReason ?? "not-importable"), patch };
  }
  if (vehicle.pricePence == null) return { action: blocked("missing-price"), patch };
  if (!regionId) return { action: blocked("missing-region"), patch };
  const ownedImages = ownedImagesOrNull(vehicle.ownedImages);
  if (!ownedImages && !vehicle.sourceImageUrls?.length) return { action: blocked("images-not-owned"), patch };
  return {
    action: {
      kind: "create",
      sourceIdentityKey: key,
      listingId: null,
      title: vehicle.title,
      description: vehicle.description,
      pricePence: vehicle.pricePence,
      categorySlug: vehicle.categorySlug,
      attributes: vehicle.attributes ?? {},
      ownedImages: ownedImages ?? [],
      sourceImageUrls: vehicle.sourceImageUrls ?? [],
      sourceUrl: vehicle.sourceUrl ?? null,
      changes: [{ field: "price", before: null, after: vehicle.pricePence }],
    },
    patch,
  };
}

export function buildStockSyncPlan(input: BuildPlanInput): StockSyncPlan {
  const grouped = new Map<string, InventoryVehicle[]>();
  const actions: PlanAction[] = [];
  const patches: IdentityPatch[] = [];
  for (const vehicle of input.vehicles) {
    if (!vehicle.sourceIdentityKey) {
      actions.push({
        kind: "blocked",
        sourceIdentityKey: null,
        listingId: null,
        reason: "unstable-identity",
        section: "new",
      });
      continue;
    }
    grouped.set(vehicle.sourceIdentityKey, [...(grouped.get(vehicle.sourceIdentityKey) ?? []), vehicle]);
  }

  for (const [key, group] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (group.length > 1) {
      actions.push({
        kind: "blocked",
        sourceIdentityKey: key,
        listingId: null,
        reason: "duplicate-source",
        section: "other",
      });
      continue;
    }
    const vehicle = group[0];
    if (!vehicle) continue;
    const identity = input.identities.find((item) => item.sourceIdentityKey === key) ?? null;
    const resolved = resolveManagedListing({
      registryKey: input.registryKey,
      sourceIdentityKey: key,
      identity,
      listings: input.listings,
    });
    if (resolved.kind === "conflict") {
      actions.push({
        kind: "conflict",
        sourceIdentityKey: key,
        listingId: resolved.listingId ?? "",
        reason: "duplicate-managed-listing",
        changes: [],
      });
      continue;
    }
    if (resolved.listing) {
      const present = presentListingAction(vehicle, resolved.listing, identity, input.scrapeRunId);
      actions.push(present.action);
      patches.push(present.patch);
      continue;
    }
    const created = newVehicleAction(vehicle, input.regionId, input.scrapeRunId);
    const unmatched = input.listings.some(listing => ["LIVE", "APPROVED", "PENDING", "DRAFT"].includes(listing.status) &&
      !listing.reviewSourceIdentity && !input.identities.some(identity => identity.listingId === listing.id) &&
      !listing.slug?.startsWith(`fd-${input.registryKey}-`) && !(input.registryKey === "ocean-motor-village" && listing.slug?.startsWith("omv-")));
    actions.push(unmatched && created.action.kind === "create" ? {
      kind: "blocked", sourceIdentityKey: key, listingId: null, section: "new", reason: "unmapped-existing-stock",
    } : created.action);
    patches.push(created.patch);
  }

  for (const identity of input.identities) {
    if (grouped.has(identity.sourceIdentityKey)) continue;
    const patch = absencePatch(identity, input.scrapeRunId, false);
    patches.push(patch);
    actions.push(absentAction(identity, patch, input.listings));
  }

  return { actions, patches, inventoryCount: input.vehicles.length };
}
