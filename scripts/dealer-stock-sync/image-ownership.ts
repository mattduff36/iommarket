import { imageIdentityKey } from "./image-urls";
import type { ArchivedVehicle, CanonicalVehicle, ImageArchiveRecord } from "./types";

const MIN_OWNER_TOKEN = 4;
const YEAR_TOKEN = /^(?:19|20)\d{2}$/;
const SHORT_NUMERIC_TOKEN = /^\d{1,7}$/;
const HASH_LIKE_TOKEN = /^(?:[a-f0-9]{12,}|[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
const GENERIC_PATH_SEGMENTS = new Set([
  "inventory",
  "used-cars",
  "used-vehicles",
  "vehicles",
  "vehicle",
  "stock",
  "cars",
  "images",
  "image",
  "photos",
  "photo",
  "gallery",
]);

function isIgnoredOwnerToken(token: string) {
  return YEAR_TOKEN.test(token) || SHORT_NUMERIC_TOKEN.test(token) || HASH_LIKE_TOKEN.test(token);
}

function escapeOwnerToken(token: string) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ownerTokenMatches(haystack: string, token: string) {
  return new RegExp(`(^|[^a-z0-9])${escapeOwnerToken(token)}([^a-z0-9]|$)`, "i").test(haystack);
}

export interface ImageOwnerIdentity {
  identityKey: string;
  sourceVehicleId?: string | null;
  stockReference?: string | null;
  registration?: string | null;
  vin?: string | null;
  detailUrl?: string | null;
  sourceUrl?: string | null;
  managedKey?: string | null;
  slug?: string | null;
}

export function imageOwnerIdentityFromVehicle(
  identityKey: string,
  vehicle: Pick<
    CanonicalVehicle,
    "sourceVehicleId" | "stockReference" | "registration" | "vin" | "detailUrl"
  >,
): ImageOwnerIdentity {
  return {
    identityKey,
    sourceVehicleId: vehicle.sourceVehicleId,
    stockReference: vehicle.stockReference,
    registration: vehicle.registration,
    vin: vehicle.vin,
    detailUrl: vehicle.detailUrl,
  };
}

function addUrlPathTokens(add: (value?: string | null, min?: number) => void, url?: string | null) {
  if (!url) return;
  try {
    const path = new URL(url).pathname;
    for (const segment of path.split("/").filter(Boolean)) {
      const decoded = decodeURIComponent(segment).toLowerCase();
      if (!GENERIC_PATH_SEGMENTS.has(decoded) && decoded.length >= 6) add(decoded, 6);
    }
  } catch {
    add(url, 6);
  }
}

export function imageOwnerTokens(identity: ImageOwnerIdentity) {
  const tokens = new Set<string>();
  const add = (value?: string | null, min = MIN_OWNER_TOKEN) => {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized.length < min || isIgnoredOwnerToken(normalized)) return;
    tokens.add(normalized);
  };
  add(identity.sourceVehicleId);
  add(identity.stockReference);
  add(identity.registration);
  add(identity.vin);
  add(identity.identityKey);
  add(identity.identityKey.split(":").pop());
  add(identity.managedKey, 6);
  add(identity.slug, 6);
  addUrlPathTokens(add, identity.detailUrl);
  addUrlPathTokens(add, identity.sourceUrl);
  return [...tokens];
}

const IDENTITY_KIND = /^(sourceVehicleId|vin|registration|stockReference|detailUrl):(.+)$/;

export function imageOwnerIdentityFromProductionListing(listing: {
  identityKey: string;
  managedKey: string;
  sourceUrl: string | null;
  slug: string | null;
}): ImageOwnerIdentity {
  const identity: ImageOwnerIdentity = {
    identityKey: listing.identityKey,
    detailUrl: listing.sourceUrl,
    sourceUrl: listing.sourceUrl,
    managedKey: listing.managedKey,
    slug: listing.slug,
  };
  const parsed = listing.identityKey.match(IDENTITY_KIND);
  if (!parsed) return identity;
  const [, kind, value] = parsed;
  if (kind === "sourceVehicleId") identity.sourceVehicleId = value;
  if (kind === "stockReference") identity.stockReference = value;
  if (kind === "registration") identity.registration = value;
  if (kind === "vin") identity.vin = value;
  if (kind === "detailUrl") identity.detailUrl = identity.detailUrl ?? value;
  return identity;
}

function uniqueOwnerTokens(
  claimants: Array<{ identity: ImageOwnerIdentity }>,
) {
  const ownersByToken = new Map<string, Set<string>>();
  for (const claimant of claimants) {
    for (const token of imageOwnerTokens(claimant.identity)) {
      const owners = ownersByToken.get(token) ?? new Set<string>();
      owners.add(claimant.identity.identityKey);
      ownersByToken.set(token, owners);
    }
  }
  const unique = new Map<string, string[]>();
  for (const [token, owners] of ownersByToken) {
    if (owners.size !== 1) continue;
    const ownerKey = [...owners][0]!;
    unique.set(ownerKey, [...(unique.get(ownerKey) ?? []), token]);
  }
  return unique;
}

export function isProvableImageOwner(
  url: string,
  identity: ImageOwnerIdentity,
  allowedTokens = imageOwnerTokens(identity),
) {
  const haystack = `${url} ${imageIdentityKey(url)}`.toLowerCase();
  return allowedTokens.some((token) => ownerTokenMatches(haystack, token));
}

export function resolveSharedChecksumOwner(
  claimants: Array<{ identity: ImageOwnerIdentity; url: string }>,
) {
  const uniqueTokens = uniqueOwnerTokens(claimants);
  const owners = [
    ...new Set(
      claimants
        .filter((claimant) =>
          isProvableImageOwner(
            claimant.url,
            claimant.identity,
            uniqueTokens.get(claimant.identity.identityKey) ?? [],
          ),
        )
        .map((claimant) => claimant.identity.identityKey),
    ),
  ];
  return owners.length === 1 ? owners[0]! : null;
}

function shouldResolveChecksum(image: ImageArchiveRecord) {
  if (!image.checksum || image.status === "failed") return false;
  if (image.status === "skipped" && image.error === "ignored asset") return false;
  if (image.status === "skipped" && image.error === "image mirroring disabled") return false;
  return true;
}

export function applySharedChecksumOwnership(vehicles: ArchivedVehicle[]): ArchivedVehicle[] {
  const cloned = vehicles.map((vehicle) => ({
    ...vehicle,
    images: vehicle.images.map((image) => ({ ...image })),
    vehicle: { ...vehicle.vehicle, imageUrls: [...vehicle.vehicle.imageUrls] },
  }));

  const groups = new Map<string, Array<{ vehicleIndex: number; imageIndex: number }>>();
  cloned.forEach((vehicle, vehicleIndex) => {
    vehicle.images.forEach((image, imageIndex) => {
      if (!shouldResolveChecksum(image) || !image.checksum) return;
      const refs = groups.get(image.checksum) ?? [];
      refs.push({ vehicleIndex, imageIndex });
      groups.set(image.checksum, refs);
    });
  });

  for (const [checksum, refs] of groups) {
    const identityKeys = new Set(refs.map((ref) => cloned[ref.vehicleIndex]!.identityKey));
    if (identityKeys.size < 2) continue;

    const ownerKey = resolveSharedChecksumOwner(
      refs.map((ref) => {
        const vehicle = cloned[ref.vehicleIndex]!;
        return {
          identity: imageOwnerIdentityFromVehicle(vehicle.identityKey, vehicle.vehicle),
          url: vehicle.images[ref.imageIndex]!.originalUrl,
        };
      }),
    );
    const fileSource = refs
      .map((ref) => cloned[ref.vehicleIndex]!.images[ref.imageIndex]!)
      .find((image) => image.status === "ok" && image.localPath);
    let keptOwner = false;

    for (const ref of refs) {
      const vehicle = cloned[ref.vehicleIndex]!;
      const image = vehicle.images[ref.imageIndex]!;
      const keep = ownerKey != null && vehicle.identityKey === ownerKey && !keptOwner;
      if (keep) {
        keptOwner = true;
        vehicle.images[ref.imageIndex] = {
          ...image,
          status: "ok",
          error: null,
          localPath: image.localPath ?? fileSource?.localPath ?? null,
          contentType: image.contentType ?? fileSource?.contentType ?? null,
          bytes: image.bytes ?? fileSource?.bytes ?? null,
          checksum,
        };
        continue;
      }
      vehicle.images[ref.imageIndex] = {
        ...image,
        localPath: null,
        status: "skipped",
        error: ownerKey
          ? `duplicate image content owned by ${ownerKey}`
          : "duplicate image content shared across listings",
      };
    }
  }

  return cloned.map((vehicle) => ({
    ...vehicle,
    vehicle: {
      ...vehicle.vehicle,
      imageUrls: vehicle.images
        .filter((image) => image.status === "ok")
        .map((image) => image.originalUrl),
    },
  }));
}
