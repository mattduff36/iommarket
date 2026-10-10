import type { InventoryVehicle } from "../../lib/dealer-stock-sync/types";
import { identityFor } from "./identity";
import { mapReconciledVehicle } from "./map-listing";
import type { ReconciledVehicle } from "./types";

export function inventoryFromReconciled(reconciled: ReconciledVehicle[]): InventoryVehicle[] {
  return reconciled.map((item) => {
    const identity = identityFor(item.vehicle);
    const mapped = mapReconciledVehicle(item);
    return {
      sourceIdentityKey: identity && identity.kind !== "composite" ? identity.key : null,
      availability: item.vehicle.availability,
      isPoa: item.vehicle.isPoa,
      pricePence: item.vehicle.pricePence,
      mileage: item.vehicle.mileage,
      importable: mapped.listing != null,
      skipReason: mapped.skipReason,
      title: mapped.listing?.title ?? null,
      description: mapped.listing?.description ?? null,
      categorySlug: mapped.listing?.categorySlug ?? null,
      attributes: mapped.listing?.attributes ?? null,
      ownedImages: [],
      sourceImageUrls: [...new Set(item.vehicle.imageUrls)].slice(0, 20),
      sourceUrl: item.vehicle.detailUrl,
      remoteImageCount: item.vehicle.imageUrls.length,
    };
  });
}
