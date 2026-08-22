import { asNumber, asString, poundsToPence } from "../json";
import { emptyVehicle, validateCanonicalVehicle, type StockConnector } from "./contract";

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((item) => item.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""]));
  });
}

export const csvConnector: StockConnector = {
  key: "csv",
  detect({ url, html }) {
    return Boolean(url?.toLowerCase().endsWith(".csv") || html?.includes("text/csv"));
  },
  async probe(context) {
    return {
      dealerKey: context.dealer.key,
      displayName: context.dealer.displayName,
      website: context.dealer.website,
      stockUrls: context.dealer.stockUrls,
      detectedPlatform: "csv",
      selectedConnector: "csv",
      status: "no_public_stock",
      evidence: ["CSV/XLSX is the first-class fallback when no public stock website exists."],
    };
  },
  async fetchList(context) {
    return {
      dealerKey: context.dealer.key,
      sourceKey: context.source.key,
      platform: "csv",
      status: "no_public_stock",
      error: "No public website. Provide a CSV/XLSX feed for this dealer.",
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
  normalize(raw, context) {
    const rows = typeof raw === "string" ? parseCsv(raw) : [raw as Record<string, string>];
    const row = rows[0];
    if (!row) return null;
    const make = asString(row.make) ?? "";
    const model = asString(row.model) ?? "";
    if (!make && !model) return null;
    const price = asNumber(row.price);
    return emptyVehicle(context, {
      sourceVehicleId: asString(row.id) ?? asString(row.stockid),
      registration: asString(row.registration) ?? asString(row.reg),
      vin: asString(row.vin),
      stockReference: asString(row.stock) ?? asString(row.reference),
      make,
      model,
      derivative: asString(row.derivative) ?? asString(row.variant),
      year: asNumber(row.year),
      mileage: asNumber(row.mileage),
      pricePence: price == null ? null : poundsToPence(price),
      isPoa: asString(row.price)?.toLowerCase() === "poa",
      fuel: asString(row.fuel),
      transmission: asString(row.transmission),
      description: asString(row.description) ?? "",
    });
  },
  validate: validateCanonicalVehicle,
};

export function parseCsvRows(text: string) {
  return parseCsv(text);
}
