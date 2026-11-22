import { asNumber, asRecord, asString, nested } from "../json";
import { fetchPageHtml } from "../browse";
import { emptyVehicle, validateCanonicalVehicle, type ConnectorContext, type StockConnector } from "./contract";
import type { CanonicalVehicle, SourceListResult } from "../types";
import { nuxtRecords } from "./nuxt-data";

const ADVERTISERS: Record<string, string> = {
  "van-mossel-jacksons": "VMV0490",
  "van-mossel-motor-mall": "VMV0495",
  "isle-of-man-motorcycles": "VMV0847",
};

function imageUrls(raw: Record<string, unknown>): string[] {
  return [...new Set((Array.isArray(raw.images) ? raw.images : []).flatMap((item) => {
    const image = asRecord(item);
    const srcset = asString(image?.srcset)?.split(",").at(-1)?.trim().split(/\s+/)[0];
    const url = srcset || asString(image?.src);
    return url && new URL(url).hostname === "vanmossel.images.ilsa.cloud" ? [url] : [];
  }))];
}

export function normalizeVanMossel(raw: unknown, context: ConnectorContext): CanonicalVehicle | null {
  const row = asRecord(raw);
  if (!row || nested(row, ["advertiser", "id"]) !== ADVERTISERS[context.dealer.key]) return null;
  const id = asString(row.id), make = asString(row.brand), model = asString(row.model) ?? asString(row.type);
  const condition = nested(row, ["condition", "formatted", "key"]) ?? row.category;
  if (!id || !make || !model || (condition !== "new" && condition !== "used")) return null;
  const specs = Array.isArray(row.specs) ? row.specs.map(asRecord) : [];
  const spec = (key: string) => asString(specs.find((item) => item?.type === key)?.value);
  const price = asString(nested(row, ["price", "purchase", "formatted"]));
  const amount = price?.match(/[\d,]+(?:\.\d{2})?/)?.[0];
  const structured = asRecord(nested(row, ["structuredData", "schema"]));
  return emptyVehicle(context, {
    sourceVehicleId: id, make, model, derivative: asString(row.model) ? asString(row.type) : null,
    condition: condition === "new" ? "NEW" : "USED",
    year: asNumber(row.year) ?? asNumber(spec("construction_year")) ?? asNumber(nested(row, ["tracking", "build_year"])),
    mileage: asNumber(nested(row, ["condition", "odometer", "value"])) ?? asNumber(nested(structured ?? {}, ["mileageFromOdometer", "value"])),
    pricePence: amount ? Math.round(Number(amount.replaceAll(",", "")) * 100) : null,
    isPoa: !amount, fuel: spec("fuel") ?? asString(structured?.fuelType),
    transmission: spec("transmission_type"), colour: asString(structured?.color)?.slice(0, 40) ?? null,
    bodyType: asString(structured?.bodyType),
    vin: asString(structured?.vehicleIdentificationNumber), registration: asString(nested(row, ["identification", "licensePlate"])),
    description: asString(nested(row, ["description", "description"])) ?? asString(structured?.description) ?? "",
    vehicleType: context.dealer.key === "isle-of-man-motorcycles" ? "Motorcycle" : asString(row.vehicleType) ?? "Car",
    detailUrl: `${context.source.startUrl}/${id}-${asString(row.slug) ?? ""}`,
    imageUrls: imageUrls(row), availability: row.deleted ? "sold" : "available",
    locationName: asString(nested(row, ["advertiser", "name"])),
  });
}

export function vanMosselStockPage(html: string) {
  const collection = nuxtRecords(html).find((row) => Array.isArray(row.vehicles) && typeof row.amount === "number");
  if (!collection) throw new Error("Public stock collection is missing");
  return { records: collection.vehicles as unknown[], count: collection.amount as number };
}

async function fetchList(context: ConnectorContext): Promise<SourceListResult> {
  const startUrl = context.source.startUrl!;
  const vehicles = new Map<string, CanonicalVehicle>();
  const sourceIds = new Set<string>();
  let pagesFetched = 0, advertisedCount: number | null = null, uncertain = false;
  for (let page = 1; page <= (context.source.maxPages ?? 30); page++) {
    const html = await fetchPageHtml(`${startUrl}${page === 1 ? "" : `?page=${page}`}`, context.fetchImpl);
    const batch = vanMosselStockPage(html);
    advertisedCount ??= batch.count;
    if (batch.count !== advertisedCount) uncertain = true;
    const before = sourceIds.size;
    for (const record of batch.records) {
      const row = asRecord(record);
      if (asString(row?.id)) sourceIds.add(asString(row?.id)!);
      // The Jacksons hub also advertises the separate Porsche Centre. Do not
      // silently assign those cars to Jacksons' preview account.
      if (context.dealer.key === "van-mossel-jacksons" && nested(row ?? {}, ["advertiser", "id"]) === "VMV0844") continue;
      const vehicle = normalizeVanMossel(record, context);
      if (!vehicle) throw new Error("Stock contains an unknown condition or different dealership");
      vehicles.set(vehicle.sourceVehicleId!, vehicle);
    }
    pagesFetched++;
    if (sourceIds.size >= advertisedCount) break;
    if (sourceIds.size === before) { uncertain = true; break; }
  }
  return { dealerKey: context.dealer.key, sourceKey: context.source.key, platform: "van-mossel",
    status: "ok", error: null, startUrl, pagesFetched, advertisedCount: vehicles.size, rawCount: vehicles.size,
    vehicles: [...vehicles.values()], paginationUncertain: uncertain || sourceIds.size !== advertisedCount };
}

export const vanMosselConnector: StockConnector = {
  key: "van-mossel", detect: ({ url }) => Boolean(url?.includes("vanmossel.im")), fetchList,
  normalize: normalizeVanMossel, validate: validateCanonicalVehicle,
  async probe(context) {
    const result = await fetchList(context);
    return { dealerKey: context.dealer.key, displayName: context.dealer.displayName,
      website: context.dealer.website, stockUrls: context.dealer.stockUrls, detectedPlatform: "van-mossel",
      selectedConnector: "van-mossel", status: result.status, evidence: [`${result.vehicles.length}/${result.advertisedCount} vehicles`] };
  },
  async fetchDetails(context, frozen) {
    let detailMissing = 0;
    const vehicles: CanonicalVehicle[] = [];
    // Bounded concurrency keeps large stock sources inside the pipeline timeout.
    for (let offset = 0; offset < frozen.length; offset += 4) {
      vehicles.push(...await Promise.all(frozen.slice(offset, offset + 4).map(async (vehicle) => {
        try {
          const html = await fetchPageHtml(vehicle.detailUrl!, context.fetchImpl);
          const raw = nuxtRecords(html).find((row) => row.id === vehicle.sourceVehicleId && "structuredData" in row);
          const detail = normalizeVanMossel(raw, context);
          if (!detail) throw new Error("Vehicle detail identity is missing");
          return { ...vehicle, ...detail, detailUrl: vehicle.detailUrl, year: detail.year ?? vehicle.year,
            transmission: detail.transmission ?? vehicle.transmission };
        } catch { detailMissing++; return vehicle; }
      })));
    }
    return { vehicles, detailMissing };
  },
};
