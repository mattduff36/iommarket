import { identityFor, reconcileVehicles } from "./reconcile";
import { REQUIRED_SOURCE_KEYS } from "./sources";
import type { EnrichListing, ListingMatch, MatchVehicleCandidate } from "./enrich-types";
import { maskRegistration, uniqueUsableRegistrations, usableRegistration } from "./enrich-vrm";
import type { SourceListResult } from "./types";

export function requiredSourcesUnhealthy(sourceResults: SourceListResult[]) {
  const missingOrFailed: string[] = [];
  for (const key of REQUIRED_SOURCE_KEYS) {
    const result = sourceResults.find((item) => item.sourceKey === key);
    if (!result || result.status !== "ok") {
      missingOrFailed.push(`${key} (${result?.error ?? (result ? result.status : "missing")})`);
    }
  }
  if (missingOrFailed.length === 0) return null;
  return `Required source failed: ${missingOrFailed.join("; ")}`;
}

function identityPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function primaryMatchKey(item: {
  year: string | number | null;
  make: string;
  model: string;
  mileage: string | number | null;
  pricePence: number | null;
}) {
  if (
    !item.make.trim() ||
    !item.model.trim() ||
    item.year == null ||
    item.year === "" ||
    item.mileage == null ||
    item.mileage === "" ||
    item.pricePence == null
  ) {
    return null;
  }
  return [
    "p",
    identityPart(item.make),
    identityPart(item.model),
    String(item.year),
    String(item.mileage),
    String(item.pricePence),
  ].join("|");
}

export function secondaryMatchKey(item: {
  year: string | number | null;
  make: string;
  model: string;
  mileage: string | number | null;
}) {
  if (
    !item.make.trim() ||
    !item.model.trim() ||
    item.year == null ||
    item.year === "" ||
    item.mileage == null ||
    item.mileage === ""
  ) {
    return null;
  }
  return [
    "s",
    identityPart(item.make),
    identityPart(item.model),
    String(item.year),
    String(item.mileage),
  ].join("|");
}

export function buildMatchCandidates(sourceResults: SourceListResult[]): MatchVehicleCandidate[] {
  const reconciled = reconcileVehicles(sourceResults);
  const registrationsByIdentity = new Map<string, string[]>();
  for (const result of sourceResults) {
    if (result.status !== "ok") continue;
    for (const vehicle of result.vehicles) {
      const identity = identityFor(vehicle);
      if (!identity) continue;
      const current = registrationsByIdentity.get(identity.key) ?? [];
      if (vehicle.registration) current.push(vehicle.registration);
      registrationsByIdentity.set(identity.key, current);
    }
  }

  return reconciled.map((item) => ({
    id: item.identityKey,
    year: item.vehicle.year,
    make: item.vehicle.make,
    model: item.vehicle.model,
    mileage: item.vehicle.mileage,
    pricePence: item.vehicle.pricePence,
    registration: item.vehicle.registration,
    registrations: registrationsByIdentity.get(item.identityKey) ?? [],
    identityConflict: item.identityConflict,
  }));
}

function groupBy<T>(items: T[], keyFor: (item: T) => string | null) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) continue;
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function listingIdentity(listing: EnrichListing) {
  return {
    year: listing.year,
    make: listing.make,
    model: listing.model,
    mileage: listing.mileage,
    pricePence: listing.pricePence,
  };
}

function vehicleUsableVrm(vehicle: MatchVehicleCandidate) {
  const unique = uniqueUsableRegistrations([vehicle.registration, ...vehicle.registrations]);
  if (unique.length > 1) return { kind: "conflict" as const, vrm: null };
  if (unique.length === 1) return { kind: "ok" as const, vrm: unique[0] };
  return { kind: "none" as const, vrm: null };
}

export function matchListingsToVehicles(input: {
  listings: EnrichListing[];
  vehicles: MatchVehicleCandidate[];
}): ListingMatch[] {
  const reusedVrms = new Set<string>();
  const vrmOwners = new Map<string, string[]>();
  for (const vehicle of input.vehicles) {
    if (vehicle.identityConflict) continue;
    const usable = vehicleUsableVrm(vehicle);
    if (usable.kind !== "ok" || !usable.vrm) continue;
    const owners = vrmOwners.get(usable.vrm) ?? [];
    owners.push(vehicle.id);
    vrmOwners.set(usable.vrm, owners);
  }
  for (const [vrm, owners] of vrmOwners) {
    if (owners.length > 1) reusedVrms.add(vrm);
  }

  const usedListingIds = new Set<string>();
  const usedVehicleIds = new Set<string>();
  const matches = new Map<string, ListingMatch>();

  const record = (match: ListingMatch) => {
    usedListingIds.add(match.listingId);
    matches.set(match.listingId, match);
  };

  const assignUniqueGroups = (
    listingGroups: Map<string, EnrichListing[]>,
    vehicleGroups: Map<string, MatchVehicleCandidate[]>,
    method: "primary" | "secondary",
  ) => {
    for (const [key, listings] of listingGroups) {
      const availableListings = listings.filter((listing) => !usedListingIds.has(listing.id));
      const availableVehicles = (vehicleGroups.get(key) ?? []).filter(
        (vehicle) => !usedVehicleIds.has(vehicle.id) && !vehicle.identityConflict,
      );
      if (availableListings.length === 0) continue;
      if (availableListings.length === 1 && availableVehicles.length === 1) {
        const listing = availableListings[0];
        const vehicle = availableVehicles[0];
        usedVehicleIds.add(vehicle.id);
        const usable = vehicleUsableVrm(vehicle);
        if (usable.kind === "conflict") {
          record({
            listingId: listing.id,
            vehicleId: vehicle.id,
            vrm: null,
            vrmMasked: null,
            matchMethod: method,
            reason: "leftover-identity-conflict",
          });
          continue;
        }
        if (usable.kind === "none" || !usable.vrm) {
          record({
            listingId: listing.id,
            vehicleId: vehicle.id,
            vrm: null,
            vrmMasked: null,
            matchMethod: method,
            reason: "leftover-no-vrm",
          });
          continue;
        }
        if (reusedVrms.has(usable.vrm)) {
          record({
            listingId: listing.id,
            vehicleId: vehicle.id,
            vrm: null,
            vrmMasked: null,
            matchMethod: method,
            reason: "leftover-vrm-reuse",
          });
          continue;
        }
        record({
          listingId: listing.id,
          vehicleId: vehicle.id,
          vrm: usable.vrm,
          vrmMasked: maskRegistration(usable.vrm),
          matchMethod: method,
          reason: method === "primary" ? "matched-primary" : "matched-secondary",
        });
        continue;
      }
      if (availableVehicles.length === 0) continue;
      for (const listing of availableListings) {
        record({
          listingId: listing.id,
          vehicleId: null,
          vrm: null,
          vrmMasked: null,
          matchMethod: method,
          reason: "leftover-ambiguous",
        });
      }
      for (const vehicle of availableVehicles) usedVehicleIds.add(vehicle.id);
    }
  };

  const matchableVehicles = input.vehicles.filter((vehicle) => !vehicle.identityConflict);
  assignUniqueGroups(
    groupBy(input.listings, (listing) => primaryMatchKey(listingIdentity(listing))),
    groupBy(matchableVehicles, (vehicle) => primaryMatchKey(vehicle)),
    "primary",
  );
  assignUniqueGroups(
    groupBy(
      input.listings.filter((listing) => !usedListingIds.has(listing.id)),
      (listing) => secondaryMatchKey(listingIdentity(listing)),
    ),
    groupBy(
      matchableVehicles.filter((vehicle) => !usedVehicleIds.has(vehicle.id)),
      (vehicle) => secondaryMatchKey(vehicle),
    ),
    "secondary",
  );

  for (const listing of input.listings) {
    if (matches.has(listing.id)) continue;
    record({
      listingId: listing.id,
      vehicleId: null,
      vrm: null,
      vrmMasked: null,
      matchMethod: null,
      reason: "leftover-unmatched",
    });
  }

  return input.listings.map((listing) => matches.get(listing.id)!);
}

export function applyPlateVrms(input: {
  matches: ListingMatch[];
  assignments: Array<{ listingId: string; vrm: string }>;
}): ListingMatch[] {
  const assigned = new Map(input.assignments.map((item) => [item.listingId, item.vrm]));
  const taken = new Set(
    input.matches.map((match) => match.vrm).filter((vrm): vrm is string => Boolean(vrm)),
  );
  return input.matches.map((match) => {
    const override = assigned.get(match.listingId);
    if (!override || match.vrm) return match;
    const usable = usableRegistration(override);
    if (!usable) {
      return {
        ...match,
        matchMethod: "override" as const,
        reason: "leftover-no-vrm" as const,
      };
    }
    if (taken.has(usable)) {
      return {
        ...match,
        matchMethod: "override" as const,
        vrm: null,
        vrmMasked: null,
        reason: "leftover-vrm-reuse" as const,
      };
    }
    taken.add(usable);
    return {
      ...match,
      vehicleId: match.vehicleId,
      vrm: usable,
      vrmMasked: maskRegistration(usable),
      matchMethod: "override" as const,
      reason: "matched-override" as const,
    };
  });
}
