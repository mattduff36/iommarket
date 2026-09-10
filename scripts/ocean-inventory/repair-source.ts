import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { uniqueImageUrls } from "../dealer-stock-sync/image-urls";
import { fetchClassicVehicleDetail } from "../import-ocean-inventory/classic";
import { isOceanEligibleLocation } from "../import-ocean-inventory/locations";
import { mapReconciledVehicle } from "../import-ocean-inventory/map-vehicle";
import { normalizeNetDirectorVehicle } from "../import-ocean-inventory/normalize";
import { reconcileVehicles } from "../import-ocean-inventory/reconcile";
import {
  enrichFrozenDetails,
  fetchVehicleDetail,
  scrapeAllOceanSources,
} from "../import-ocean-inventory/scrape";
import type {
  MappingOutcome,
  NormalizedVehicle,
} from "../import-ocean-inventory/types";

export interface RepairVehicle {
  year: string | number;
  make: string;
  model: string;
  mileage: string | number;
  pricePence: number;
  registration: string | null;
  title: string;
  imageUrls: string[];
}

export function repairVehiclesFromOutcomes(outcomes: MappingOutcome[]): RepairVehicle[] {
  return outcomes.flatMap((outcome) => {
    if (!outcome.listing) return [];
    return [{
      year: outcome.listing.identity.year,
      make: outcome.listing.identity.make,
      model: outcome.listing.identity.model,
      mileage: outcome.listing.identity.mileage,
      pricePence: outcome.listing.identity.pricePence,
      registration: outcome.reconciled.vehicle.registration,
      title: outcome.listing.title,
      imageUrls: uniqueImageUrls(
        outcome.listing.imageUrls,
        FEATURED_LISTING_PHOTO_LIMIT,
      ),
    }];
  });
}

export async function scrapeOceanRepairVehicles(): Promise<RepairVehicle[]> {
  const listed = await scrapeAllOceanSources();
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
  return repairVehiclesFromOutcomes(
    reconcileVehicles(enriched.sourceResults).map(mapReconciledVehicle),
  );
}
