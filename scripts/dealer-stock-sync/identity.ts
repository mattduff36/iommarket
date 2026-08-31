import { createHash } from "crypto";
import type { CanonicalVehicle, IdentityKind } from "./types";

function normalizeKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function canonicalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase().replace(/\/$/, "");
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

export function identityFor(vehicle: CanonicalVehicle): {
  key: string;
  kind: IdentityKind;
} | null {
  if (vehicle.sourceVehicleId?.trim()) {
    return {
      key: `sourceVehicleId:${normalizeKeyPart(vehicle.sourceVehicleId)}`,
      kind: "sourceVehicleId",
    };
  }
  if (vehicle.vin?.trim()) {
    return { key: `vin:${normalizeKeyPart(vehicle.vin)}`, kind: "vin" };
  }
  if (vehicle.registration?.trim()) {
    return {
      key: `registration:${normalizeKeyPart(vehicle.registration)}`,
      kind: "registration",
    };
  }
  if (vehicle.stockReference?.trim()) {
    return {
      key: `stockReference:${normalizeKeyPart(vehicle.stockReference)}`,
      kind: "stockReference",
    };
  }
  if (vehicle.detailUrl?.trim()) {
    return { key: `detailUrl:${canonicalizeUrl(vehicle.detailUrl)}`, kind: "detailUrl" };
  }
  if (vehicle.make.trim() && vehicle.model.trim() && vehicle.year != null) {
    return {
      key: [
        "composite",
        vehicle.make.toLowerCase().trim(),
        vehicle.model.toLowerCase().trim(),
        (vehicle.derivative ?? "").toLowerCase().trim(),
        vehicle.year,
      ].join(":"),
      kind: "composite",
    };
  }
  return null;
}

export function vehicleContentHash(vehicle: CanonicalVehicle) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        make: vehicle.make,
        model: vehicle.model,
        derivative: vehicle.derivative,
        year: vehicle.year,
        mileage: vehicle.mileage,
        pricePence: vehicle.pricePence,
        registration: vehicle.registration,
        vin: vehicle.vin,
        sourceVehicleId: vehicle.sourceVehicleId,
        detailUrl: vehicle.detailUrl,
        imageUrls: vehicle.imageUrls,
        description: vehicle.description,
      }),
    )
    .digest("hex");
}

export function compareSnapshot(
  previous: { identityKey: string; contentHash: string }[] | null,
  current: { identityKey: string; contentHash: string },
  sourceFailed: boolean,
): "new" | "unchanged" | "modified" | "missing_after_success" | "source_failed" {
  if (sourceFailed) return "source_failed";
  if (!previous) return "new";
  const match = previous.find((item) => item.identityKey === current.identityKey);
  if (!match) return "new";
  return match.contentHash === current.contentHash ? "unchanged" : "modified";
}

export function missingAfterSuccess(
  previous: { identityKey: string }[] | null,
  currentKeys: Set<string>,
  sourceFailed: boolean,
) {
  if (sourceFailed || !previous) return [];
  return previous
    .filter((item) => !currentKeys.has(item.identityKey))
    .map((item) => item.identityKey);
}
