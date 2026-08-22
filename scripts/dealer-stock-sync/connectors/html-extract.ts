import { asNumber, asRecord, asString, nested, resolveMaybeUrl } from "../json";
import { extractNamedHtml } from "./named-html";
import { extractExtraNamedHtml } from "./named-html-more";

export function collectJsonVehicles(payload: unknown, depth = 0): unknown[] {
  if (depth > 6) return [];
  if (Array.isArray(payload)) {
    if (
      payload.some((item) => {
        const record = asRecord(item);
        return Boolean(
          record &&
            (asString(record.make) ||
              asString(record.Make) ||
              asString(record.manufacturer) ||
              asString(record.model) ||
              asString(record.Model)),
        );
      })
    ) {
      return payload;
    }
    return payload.flatMap((item) => collectJsonVehicles(item, depth + 1));
  }
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["vehicles", "results", "items", "stock", "listings", "cars", "data"]) {
    if (record[key] != null) {
      const found = collectJsonVehicles(record[key], depth + 1);
      if (found.length > 0) return found;
    }
  }
  return [];
}

export function extractJsonLdVehicles(html: string) {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  const vehicles: unknown[] = [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(json) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        const graph = asRecord(record)?.["@graph"];
        const items = Array.isArray(graph) ? graph : [record];
        for (const item of items) {
          const type = asString(asRecord(item)?.["@type"]) ?? "";
          if (/car|vehicle|product/i.test(type)) vehicles.push(item);
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return vehicles.map((item) => {
    const record = asRecord(item);
    if (!record) return null;
    return {
      make: asString(nested(record, ["brand", "name"])) ?? asString(record.brand) ?? asString(record.manufacturer),
      model: asString(record.model) ?? asString(record.name),
      year: asNumber(record.vehicleModelDate) ?? asNumber(record.productionDate),
      mileage: asNumber(nested(record, ["mileageFromOdometer", "value"])),
      price: asNumber(nested(record, ["offers", "price"])),
      url: asString(record.url),
      image: Array.isArray(record.image) ? record.image[0] : record.image,
      description: asString(record.description),
      fuel: asString(record.fuelType),
      transmission: asString(record.vehicleTransmission),
      colour: asString(record.color),
    };
  });
}

export function extractNextDataVehicles(html: string) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return [];
  try {
    return collectJsonVehicles(JSON.parse(match[1]));
  } catch {
    return [];
  }
}

export function extractHtmlVehicleCards(html: string, origin: string) {
  const cards: unknown[] = [];
  const titled =
    /(\d{4})\s+([A-Za-z][A-Za-z0-9\-]+)\s+([^<£]{2,80}?)(?:<\/h\d>|\n).*?(?:£|&pound;)([\d,]+)/gis;
  let titledMatch = titled.exec(html);
  while (titledMatch) {
    cards.push({
      year: Number(titledMatch[1]),
      make: titledMatch[2],
      model: titledMatch[3]?.trim(),
      price: Number(titledMatch[4]?.replace(/,/g, "")),
    });
    titledMatch = titled.exec(html);
  }
  const pattern =
    /href="([^"]+)"[^>]*>[\s\S]{0,240}?(?:£|&pound;)([\d,]+)[\s\S]{0,160}?(?:<h\d[^>]*>|<strong>)([^<]{3,80})/gi;
  let match = pattern.exec(html);
  while (match) {
    const title = match[3]?.trim() ?? "";
    const [make, ...modelParts] = title.split(/\s+/);
    const model = modelParts.join(" ").replace(/<[^>]+>/g, "").trim();
    if (make && model && !/[<>"]/.test(make) && !/[<>"]/.test(model) && make.length < 40) {
      cards.push({
        url: resolveMaybeUrl(match[1], origin),
        price: Number(match[2]?.replace(/,/g, "")),
        make,
        model,
      });
    }
    match = pattern.exec(html);
  }
  return cards;
}

function specValue(card: string, label: string) {
  const match = card.match(new RegExp(`${label}:[\\s\\S]*?<strong>([^<]+)</strong>`, "i"));
  return match?.[1]?.replace(/\s+/g, " ").trim() ?? null;
}

export function extractAutowebListings(html: string, origin: string) {
  const chunks = html.split(/<div class="us-result-grid/i).slice(1);
  const cards: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    const id = chunk.match(/data-vehicle-id="(\d+)"/i)?.[1];
    const title =
      chunk.match(/data-title="([^"]+)"/i)?.[1] ??
      chunk.match(/>(\d{4}\s+\(\d{2}\)\s+[^<]+)</)?.[1];
    const yearMatch = title?.match(/^(\d{4})\s+\(\d{2}\)\s+([A-Za-z0-9\-]+)\s+(.+)$/);
    const priceText = chunk.match(/class="Price"><strong>\s*£([\d,]+)/i)?.[1];
    const href = chunk.match(/href="(\/used\/[^"]+)"/i)?.[1];
    if (!yearMatch || !priceText) continue;
    cards.push({
      id,
      sourceVehicleId: id,
      year: Number(yearMatch[1]),
      make: yearMatch[2],
      model: yearMatch[3].trim(),
      price: Number(priceText.replace(/,/g, "")),
      url: resolveMaybeUrl(href ?? null, origin),
      transmission: specValue(chunk, "Gearbox"),
      bodyType: specValue(chunk, "Bodystyle"),
      fuel: specValue(chunk, "Fuel Type"),
      engineSize: specValue(chunk, "Engine Size"),
      mileage: specValue(chunk, "Mileage"),
    });
  }
  return cards;
}

export function nextAutowebPageUrl(html: string, origin: string, currentPage: number) {
  const href = html.match(new RegExp(`href="([^"]*used-cars/page/${currentPage + 1}[^"]*)"`, "i"))?.[1];
  return resolveMaybeUrl(href ?? null, origin);
}

export function discoverStockPageUrls(html: string, currentUrl: string) {
  const origin = new URL(currentUrl).origin;
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const absolute = resolveMaybeUrl(match[1], origin);
    if (!absolute) continue;
    try {
      const url = new URL(absolute);
      if (url.origin !== origin) continue;
      if (url.searchParams.get("page") === "1") continue;
      if (
        /\/used-cars\/\d+\/?$/i.test(url.pathname) ||
        /\/used-vans\/\d+\/?$/i.test(url.pathname) ||
        /\/used-bikes\/\d+\/?$/i.test(url.pathname) ||
        /\/used-cars\/page\/\d+/i.test(url.pathname) ||
        /\/page-\d+\//i.test(url.pathname) ||
        /[?&]page=\d+/i.test(url.search)
      ) {
        found.add(`${url.origin}${url.pathname}${url.search}`);
      }
    } catch {
      // ignore invalid hrefs
    }
  }
  return [...found];
}

export function sequentialStockPageUrls(startUrl: string, maxPages: number) {
  if (maxPages <= 1) return [];
  const url = new URL(startUrl);
  const pages: string[] = [];
  const used = url.pathname.match(/^(\/used-(?:cars|vans|bikes))\/?$/i);
  if (used?.[1]) {
    const base = used[1].replace(/\/$/, "");
    for (let page = 2; page <= maxPages; page += 1) {
      pages.push(`${url.origin}${base}/${page}`);
    }
    return pages;
  }
  return pages;
}

export function stockPageQueue(html: string, currentUrl: string, startUrl: string, maxPages: number) {
  const seen = new Set([startUrl.replace(/\/$/, ""), currentUrl.replace(/\/$/, "")]);
  const queue: string[] = [];
  for (const next of [...discoverStockPageUrls(html, currentUrl), ...sequentialStockPageUrls(startUrl, maxPages)]) {
    const key = next.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(next);
  }
  return queue;
}

export function extractStructuredHtml(html: string, origin: string, extra?: (html: string, origin: string) => unknown[]) {
  return [
    ...(extra?.(html, origin) ?? []),
    ...extractNamedHtml(html, origin),
    ...extractExtraNamedHtml(html, origin),
    ...extractNextDataVehicles(html),
    ...extractJsonLdVehicles(html),
    ...extractHtmlVehicleCards(html, origin),
  ].filter(Boolean);
}
