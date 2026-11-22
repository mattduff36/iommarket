import { fetchPageHtml } from "../browse";
import { asRecord, asString } from "../json";
import type { CanonicalVehicle, SourceListResult } from "../types";
import { emptyVehicle, validateCanonicalVehicle, type ConnectorContext, type StockConnector } from "./contract";

function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&pound;/g, "£").replace(/&amp;/g, "&")
    .replace(/&apos;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function handhModels(html: string) {
  const data = html.match(/var models = (\[[\s\S]*?\]);/)?.[1];
  if (!data) throw new Error("H&H model catalogue missing");
  const models: unknown = JSON.parse(data);
  if (!Array.isArray(models)) throw new Error("Invalid H&H models");
  return models.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
}

export function handhCards(html: string, models: Record<string, unknown>[], context: ConnectorContext) {
  const condition = context.source.startUrl?.endsWith("/new-motorcycles") ? "NEW" : "USED";
  return [...html.matchAll(/<a href="(\/(?:new|used)-motorcycles\/[^"?]+)" class="card-body">([\s\S]*?)<\/a>/g)].map((match) => {
    const card = match[2]!;
    const title = text(card.match(/class="sectionTitle">([\s\S]*?)<\/div>/)?.[1] ?? "");
    const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const sourceModel = models.find((row) => compact(asString(row.title) ?? "") === compact(title)) ??
      models.find((row) => compact(`${row["brand:label"]} ${row.title}`) === compact(title));
    const brand = asString(sourceModel?.["brand:label"]) ?? models.map((row) => asString(row["brand:label"]))
      .find((label) => label && title.toLowerCase().startsWith(`${label.toLowerCase()} `));
    const price = text(card.match(/class="price[^\"]*">([\s\S]*?)<\/span>/)?.[1] ?? "");
    const amount = price.match(/£([\d,]+)/)?.[1];
    const image = card.match(/data-bg="([^\"]+)"/)?.[1];
    if (!brand) throw new Error(`H&H stock model cannot be matched: ${title}`);
    return emptyVehicle(context, {
      condition, sourceVehicleId: match[1]!.split("/").at(-1)!,
      make: brand, model: title.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i"), ""),
      year: Number(card.match(/<span>((?:19|20)\d{2})<\/span>/)?.[1]) || null,
      pricePence: amount ? Number(amount.replaceAll(",", "")) * 100 : null,
      isPoa: !amount, detailUrl: new URL(match[1]!, context.source.startUrl!).href,
      imageUrls: image ? [new URL(image, context.source.startUrl!).href] : [],
      availability: /sold/i.test(price) ? "sold" : "available", vehicleType: "Motorcycle",
    });
  });
}

export function handhDetail(html: string, vehicle: CanonicalVehicle) {
  const main = html.split('<div class="products-detail bike-detail">')[1]?.split('<h2>You may also like</h2>')[0];
  if (!main || !/<h1>/.test(main)) throw new Error("H&H bike detail missing");
  const labels = text(main.match(/class="labels-product[^\"]*">([\s\S]*?)<\/div>/)?.[1] ?? "");
  const miles = labels.match(/([\d,]+)\s*Miles/i)?.[1];
  const description = text(main.split("<h2>DESCRIPTION</h2>")[1] ?? "");
  const images = [...main.matchAll(/href="(\/uploads\/[^\"]+)"/g)].map((match) => new URL(match[1]!, vehicle.detailUrl!).href);
  return { ...vehicle, description, imageUrls: [...new Set(images)],
    mileage: miles ? Number(miles.replaceAll(",", "")) : null,
    engineSize: Number(text(main.match(/class="cc">([\s\S]*?)<\/div>/)?.[1] ?? "").match(/[\d.]+/)?.[0]) || null };
}

async function fetchList(context: ConnectorContext): Promise<SourceListResult> {
  const startUrl = context.source.startUrl!;
  const response = await (context.fetchImpl ?? fetch)(startUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`H&H stock HTTP ${response.status}`);
  const listHtml = await response.text();
  let models = handhModels(listHtml);
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  if (!cookie) throw new Error("H&H stock session missing");
  const vehicles = new Map<string, CanonicalVehicle>();
  let pagesFetched = 0, pageCount = 1;
  for (let page = 1; page <= pageCount && page <= (context.source.maxPages ?? 20); page++) {
    const result = await (context.fetchImpl ?? fetch)(new URL("/ajax/getMotorcycles.php", startUrl), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", referer: startUrl, cookie },
      body: new URLSearchParams({ brand: "", model: "", engine: "", sort_by: "", page: String(page) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error(`H&H stock feed HTTP ${result.status}`);
    const html = asString(asRecord(await result.json())?.html);
    if (!html) throw new Error("H&H stock feed missing");
    pageCount = Number(html.match(/Page \d+ of (\d+)/)?.[1] ?? 1);
    let cards: CanonicalVehicle[];
    try { cards = handhCards(html, models, context); }
    catch {
      // The site's model dropdown can lag behind new stock. Its brand filter
      // supplies an authoritative make for those records without guessing.
      const brands = listHtml.match(/<select name="brand"[\s\S]*?<\/select>/)?.[0] ?? "";
      for (const brand of brands.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)) {
        const filtered = await (context.fetchImpl ?? fetch)(new URL("/ajax/getMotorcycles.php", startUrl), {
          method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", referer: startUrl, cookie },
          body: new URLSearchParams({ brand: brand[1]!, model: "", engine: "", sort_by: "", page: "1" }),
          signal: AbortSignal.timeout(15000),
        });
        if (!filtered.ok) throw new Error("H&H brand lookup failed");
        const feed = asString(asRecord(await filtered.json())?.html) ?? "";
        const additions = [...feed.matchAll(/class="sectionTitle">([\s\S]*?)<\/div>/g)]
          .map((item) => ({ title: text(item[1]!), "brand:label": text(brand[2]!) }));
        models = [...models, ...additions];
      }
      cards = handhCards(html, models, context);
    }
    if (!cards.length) throw new Error("H&H stock feed contained no bike cards");
    for (const vehicle of cards) vehicles.set(vehicle.sourceVehicleId!, vehicle);
    pagesFetched++;
  }
  return { dealerKey: context.dealer.key, sourceKey: context.source.key, platform: "handh", status: "ok",
    error: null, startUrl, pagesFetched, advertisedCount: null, rawCount: vehicles.size,
    vehicles: [...vehicles.values()], paginationUncertain: pagesFetched !== pageCount };
}

export const handhConnector: StockConnector = {
  key: "handh", detect: ({ url }) => Boolean(url?.includes("handhmotorcycles.im")), fetchList,
  normalize: () => null, validate: validateCanonicalVehicle,
  async probe(context) {
    const result = await fetchList(context);
    return { dealerKey: context.dealer.key, displayName: context.dealer.displayName, website: context.dealer.website,
      stockUrls: context.dealer.stockUrls, detectedPlatform: "handh", selectedConnector: "handh", status: result.status,
      evidence: [`${result.vehicles.length} bikes across ${result.pagesFetched} pages`] };
  },
  async fetchDetails(context, frozen) {
    let detailMissing = 0;
    const vehicles: CanonicalVehicle[] = [];
    for (const vehicle of frozen) {
      try { vehicles.push(handhDetail(await fetchPageHtml(vehicle.detailUrl!, context.fetchImpl), vehicle)); }
      catch { detailMissing++; vehicles.push(vehicle); }
    }
    return { vehicles, detailMissing };
  },
};
