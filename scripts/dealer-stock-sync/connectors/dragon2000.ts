import { createWebsiteConnector } from "./website-source";
import type { CanonicalVehicle } from "../types";
import type { StockConnector } from "./contract";

const baseConnector = createWebsiteConnector({
  key: "dragon2000",
  detect({ url, html, requestUrls }) {
    const haystack = [url, html, ...(requestUrls ?? [])].join("\n").toLowerCase();
    return haystack.includes("dragon2000") || haystack.includes("dragon-2000");
  },
  requestMatch: (requestUrl) => /\/api\/(?:v2\/)?vehicles\/(?:instock|search-data)/i.test(requestUrl),
  preferBrowser: true,
  settleMs: 2_000,
  waitForSelector: ".stocklist-vehicle",
});

export function cleanDragonVehicle(vehicle: CanonicalVehicle): CanonicalVehicle {
  const condition = vehicle.detailUrl?.match(/\/vehicle-details\/(new|used)-/i)?.[1]?.toLowerCase();
  return { ...vehicle,
    ...(condition ? { condition: condition === "new" ? "NEW" as const : "USED" as const } : {}),
    imageUrls: vehicle.imageUrls.filter((url) => !/\/WebAssets\//i.test(new URL(url).pathname)),
  };
}

export const dragon2000Connector: StockConnector = {
  ...baseConnector,
  async fetchList(context) {
    const result = await baseConnector.fetchList(context);
    return { ...result, vehicles: result.vehicles.map(cleanDragonVehicle) };
  },
  async fetchDetails(context, frozen) {
    const result = await baseConnector.fetchDetails(context, frozen);
    return { ...result, vehicles: result.vehicles.map(cleanDragonVehicle) };
  },
};
