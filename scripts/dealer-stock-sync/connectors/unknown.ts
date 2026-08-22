import type { StockConnector } from "./contract";
import { emptyVehicle, validateCanonicalVehicle } from "./contract";

export const unknownConnector: StockConnector = {
  key: "unknown",
  detect() {
    return false;
  },
  async probe(context) {
    return {
      dealerKey: context.dealer.key,
      displayName: context.dealer.displayName,
      website: context.dealer.website,
      stockUrls: context.dealer.stockUrls,
      detectedPlatform: null,
      selectedConnector: "unknown",
      status: context.dealer.status === "no_public_site" ? "no_public_stock" : "skipped",
      evidence: [context.dealer.notes],
    };
  },
  async fetchList(context) {
    return {
      dealerKey: context.dealer.key,
      sourceKey: context.source.key,
      platform: "unknown",
      status: context.dealer.status === "no_public_site" ? "no_public_stock" : "skipped",
      error:
        context.dealer.status === "no_public_site"
          ? "No standalone public stock website"
          : "No connector selected",
      startUrl: context.source.startUrl,
      pagesFetched: 0,
      advertisedCount: null,
      rawCount: null,
      vehicles: [],
    };
  },
  async fetchDetails(_context, frozen) {
    return { vehicles: frozen, detailMissing: 0 };
  },
  normalize() {
    return null;
  },
  validate(vehicle) {
    return validateCanonicalVehicle(vehicle);
  },
};

export { emptyVehicle };
