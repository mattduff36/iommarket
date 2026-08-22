import { emptyVehicle, validateCanonicalVehicle, type StockConnector } from "../contract";
import { applyDetailEnrichment } from "./enrich";
import { parseNetDirectorVehicle, vehicleIdentityToken } from "./normalize";
import {
  detectNetDirector,
  isClassicListRequest,
  isVueListRequest,
  paginateClassicListing,
  paginateVehicleSearch,
  type CapturedSearchRequest,
} from "./pagination";
import type { CanonicalVehicle } from "../../types";

export { applyDetailEnrichment } from "./enrich";
export {
  extractHasMoreResults,
  extractSearchVehicles,
  extractTotalPages,
  parseNetDirectorVehicle,
  vehicleIdentityToken,
} from "./normalize";
export {
  buildSearchUrl,
  detectNetDirector,
  fetchSearchPage,
  isClassicListRequest,
  isVueListRequest,
  paginateClassicListing,
  paginateVehicleSearch,
  sanitizeHeaders,
  withPageNumber,
  withPageQuery,
} from "./pagination";

export const netdirectorConnector: StockConnector = {
  key: "netdirector",
  detect: detectNetDirector,
  async probe(context) {
    return {
      dealerKey: context.dealer.key,
      displayName: context.dealer.displayName,
      website: context.dealer.website,
      stockUrls: context.dealer.stockUrls,
      detectedPlatform: "netdirector",
      selectedConnector: "netdirector",
      status: context.source.startUrl ? "ok" : "no_public_stock",
      evidence: ["NetDirector list APIs: stock-listing/get-items or vehicle-search"],
    };
  },
  async fetchList(context) {
    const startUrl = context.source.startUrl;
    if (!startUrl) {
      return {
        dealerKey: context.dealer.key,
        sourceKey: context.source.key,
        platform: "netdirector",
        status: "no_public_stock",
        error: "Missing stock URL",
        startUrl: null,
        pagesFetched: 0,
        advertisedCount: null,
        rawCount: null,
        vehicles: [],
      };
    }

    try {
      const { capturePublicListRequest } = await import("../../browse");
      const captured =
        (await capturePublicListRequest(startUrl, (request) =>
          isClassicListRequest(request.url) || isVueListRequest(request.url, request.body),
        )) ??
        (await capturePublicListRequest(new URL("/transit-centre/used-vans/", startUrl).toString(), (request) =>
          isClassicListRequest(request.url) || isVueListRequest(request.url, request.body),
        ));
      if (!captured) {
        return {
          dealerKey: context.dealer.key,
          sourceKey: context.source.key,
          platform: "netdirector",
          status: "failed",
          error: "No vehicle-search or stock-listing/get-items request was captured",
          startUrl,
          pagesFetched: 0,
          advertisedCount: null,
          rawCount: null,
          vehicles: [],
        };
      }
      const paged = isVueListRequest(captured.url, captured.body)
        ? await paginateVehicleSearch({
            context: {
              kind: "vue",
              apiUrl: new URL(captured.url).origin,
              uuid: new URL(captured.url).searchParams.get("uuid") ?? "",
              authorizationHeader: captured.headers.authorization,
            },
            captured,
            fetchImpl: context.fetchImpl,
          })
        : await paginateClassicListing({ captured, fetchImpl: context.fetchImpl });
      const vehicles = paged.vehicles
        .map((raw) => netdirectorConnector.normalize(raw, context))
        .filter((item): item is CanonicalVehicle => item != null)
        .map((vehicle) => ({
          ...vehicle,
          provenance: {
            ...vehicle.provenance,
            startUrl,
          },
        }));
      return {
        dealerKey: context.dealer.key,
        sourceKey: context.source.key,
        platform: "netdirector",
        status: "ok",
        error: null,
        startUrl,
        pagesFetched: paged.pagesFetched,
        advertisedCount: null,
        rawCount: vehicles.length,
        vehicles,
        rawRecords: paged.vehicles,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /403|401|cloudflare|captcha|blocked/i.test(message);
      return {
        dealerKey: context.dealer.key,
        sourceKey: context.source.key,
        platform: "netdirector",
        status: blocked ? "blocked_requires_feed" : "failed",
        error: message,
        startUrl,
        pagesFetched: 0,
        advertisedCount: null,
        rawCount: null,
        vehicles: [],
      };
    }
  },
  async fetchDetails(context, frozen) {
    const details = new Map<string, CanonicalVehicle>();
    for (const vehicle of frozen) {
      if (!vehicle.detailUrl) continue;
      try {
        const { fetchClassicVehicleDetail } = await import("../../browse");
        const detail = await fetchClassicVehicleDetail(vehicle.detailUrl, context.fetchImpl);
        if (!detail) continue;
        details.set(vehicleIdentityToken({ ...vehicle, stockId: vehicle.sourceVehicleId }), {
          ...vehicle,
          description: detail.description || vehicle.description,
          imageUrls: [...vehicle.imageUrls, ...detail.imageUrls],
        });
      } catch {
        // keep the frozen list card
      }
    }
    return applyDetailEnrichment(
      frozen,
      details,
      (item) => vehicleIdentityToken({ ...item, stockId: item.sourceVehicleId }),
    );
  },
  normalize(raw, context) {
    const origin = context.source.startUrl ? new URL(context.source.startUrl).origin : null;
    const parsed = parseNetDirectorVehicle(raw, origin);
    if (!parsed) return null;
    return emptyVehicle(context, {
      sourceVehicleId: parsed.sourceVehicleId,
      registration: parsed.registration,
      stockReference: parsed.stockReference,
      detailUrl: parsed.detailUrl,
      make: parsed.make,
      model: parsed.model,
      derivative: parsed.derivative,
      year: parsed.year,
      mileage: parsed.mileage,
      pricePence: parsed.pricePence,
      isPoa: parsed.isPoa,
      fuel: parsed.fuel,
      transmission: parsed.transmission,
      bodyType: parsed.bodyType,
      colour: parsed.colour,
      doors: parsed.doors,
      seats: parsed.seats,
      engineSize: parsed.engineSize,
      enginePower: parsed.enginePower,
      vehicleType: parsed.vehicleType,
      description: parsed.description,
      locationName: parsed.locationName || null,
      imageUrls: parsed.imageUrls,
      availability: "available",
      provenance: {
        startUrl: context.source.startUrl,
        sourceKeys: [context.source.key],
        rawIdentityHints: [parsed.sourceVehicleId, parsed.registration, parsed.stockReference].filter(
          (item): item is string => Boolean(item),
        ),
      },
    });
  },
  validate: validateCanonicalVehicle,
};

export function capturedRequest(request: CapturedSearchRequest) {
  return request;
}
