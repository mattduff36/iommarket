import { resolveMaybeUrl } from "../json";

const MULTI_MAKES = [
  "land rover",
  "mercedes-benz",
  "mercedes benz",
  "mercedes amg",
  "alfa romeo",
  "aston martin",
  "range rover",
  "rolls royce",
];

export function decodeListingText(value: string) {
  return value
    .replace(/<!--\s*-->/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&pound;/gi, "£")
    .replace(/&#163;/g, "£")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseYearMakeModel(title: string) {
  const cleaned = decodeListingText(title);
  const yearMatch = cleaned.match(/^(20\d{2}|19\d{2})\s+(.+)$/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const rest = yearMatch?.[2] ?? cleaned;
  const lower = rest.toLowerCase();
  const multi = MULTI_MAKES.find((name) => lower.startsWith(name));
  if (multi) {
    return { year, make: rest.slice(0, multi.length), model: rest.slice(multi.length).trim() };
  }
  const [make, ...modelParts] = rest.split(/\s+/);
  return { year, make: make ?? "", model: modelParts.join(" ").trim() };
}

function priceFrom(chunk: string) {
  const match = decodeListingText(chunk).match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!match?.[1]) return null;
  return Number(match[1].replace(/,/g, ""));
}

function milesFrom(chunk: string) {
  const match = decodeListingText(chunk).match(/([\d,]+)\s*(?:miles|mls)/i);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
}

function yearFrom(chunk: string) {
  const match = decodeListingText(chunk).match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function spanYear(chunk: string) {
  const match = chunk.match(/<span>(20\d{2}|19\d{2})<\/span>/);
  return match ? Number(match[1]) : null;
}

export function extractCdinvCards(html: string, origin: string) {
  const chunks = html.split(/<a class="cdinv-card"/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="([^"]+)"/i)?.[1];
    const title = chunk.match(/cdinv-card__title">([^<]+)/i)?.[1];
    if (!title) return [];
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) return [];
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        ...parsed,
        year: parsed.year ?? yearFrom(chunk.match(/cdinv-badge">(\d{4})</i)?.[1] ?? ""),
        price: priceFrom(chunk),
        mileage: milesFrom(chunk),
        fuel: decodeListingText(chunk.match(/cdinv-badge">([^<]*(?:Diesel|Petrol|Hybrid|Electric)[^<]*)</i)?.[1] ?? ""),
        transmission: decodeListingText(chunk.match(/cdinv-badge">([^<]*(?:Manual|Automatic)[^<]*)</i)?.[1] ?? ""),
      },
    ];
  });
}

export function extractSelectPropertyListings(html: string, origin: string) {
  if (!html.includes("property-listing") || !html.includes("isle-of-man-used-cars")) return [];
  const chunks = html.split(/class="[^"]*property-listing/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="(\/isle-of-man-used-cars\/[^"]+)"/i)?.[1];
    const heading = chunk.match(/media-heading[\s\S]{0,240}?<a[^>]*>([\s\S]*?)<small/i)?.[1];
    if (!heading) return [];
    const parsed = parseYearMakeModel(heading);
    if (!parsed.make || !parsed.model) return [];
    const id = href?.match(/\/isle-of-man-used-cars\/(\d+)\//)?.[1];
    return [
      {
        id,
        sourceVehicleId: id,
        url: resolveMaybeUrl(href ?? null, origin),
        ...parsed,
        price: priceFrom(chunk),
        mileage: milesFrom(chunk),
      },
    ];
  });
}

export function extractDwCarViews(html: string, origin: string) {
  if (!html.includes("car-view1-wrapper")) return [];
  const chunks = html.split(/class="car-view1-wrapper"/i).slice(1);
  return chunks.flatMap((chunk) => {
    const title = chunk.match(/class="txt1">([^<]+)/i)?.[1];
    if (!title) return [];
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) return [];
    const spec = decodeListingText(chunk.match(/class="txt6">([\s\S]*?)<\/div>/gi)?.[1] ?? "");
    const specBits = decodeListingText(chunk.match(/11000 Miles|[\d,]+ Miles[\s\S]{0,80}?20\d{2}/i)?.[0] ?? chunk);
    return [
      {
        url: resolveMaybeUrl(chunk.match(/href="(details_[^"]+)"/i)?.[1] ?? null, origin),
        ...parsed,
        year: parsed.year ?? yearFrom(chunk),
        price: priceFrom(chunk) ?? priceFrom(spec),
        mileage: milesFrom(chunk) ?? milesFrom(specBits),
        transmission: chunk.match(/\b(Manual|Automatic)\b/i)?.[1] ?? null,
        fuel: chunk.match(/\b(Petrol|Diesel|Hybrid|Electric)\b/i)?.[1] ?? null,
      },
    ];
  });
}

export function extractTdInventoryCards(html: string, origin: string) {
  const chunks = html.split(/href="(\/inventory\/(?:20\d{2}|19\d{2})-[^"]+)"/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    if (!href || seen.has(href)) continue;
    const heading = decodeListingText(chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    if (!heading) continue;
    seen.add(href);
    const parsed = parseYearMakeModel(heading);
    if (!parsed.make || !parsed.model) continue;
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.replace(/^\//, ""),
      ...parsed,
      derivative: decodeListingText(chunk.match(/line-clamp-2">([^<]+)/i)?.[1] ?? ""),
      year: parsed.year ?? spanYear(chunk),
      price: priceFrom(chunk),
      mileage: milesFrom(chunk),
    });
  }
  const loose = html.split(/href="(\/inventory\/[^"?#]+)"/i);
  for (let index = 1; index < loose.length; index += 2) {
    const href = loose[index];
    const chunk = loose[index + 1] ?? "";
    if (!href || href.replace(/\/$/, "") === "/inventory" || seen.has(href)) continue;
    const heading =
      decodeListingText(chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "") ||
      decodeListingText(chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
    if (!heading) continue;
    const parsed = parseYearMakeModel(heading);
    if (!parsed.make || !parsed.model) continue;
    seen.add(href);
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.replace(/^\//, ""),
      ...parsed,
      year: parsed.year ?? spanYear(chunk),
      price: priceFrom(chunk),
      mileage: milesFrom(chunk),
    });
  }
  return cards;
}

export function extractBudgetInventoryCards(html: string, origin: string) {
  if (!html.includes("bg-brand-magenta") && !html.includes("HYUNDAI")) {
    if (!/href="\/inventory\/[0-9a-f-]{16,}/i.test(html)) return [];
  }
  const chunks = html.split(/href="(\/inventory\/[0-9a-f-]+)"/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const heading =
      decodeListingText(chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "") ||
      decodeListingText(chunk.match(/alt="([^"]+)"/i)?.[1] ?? "");
    if (!heading) continue;
    const parsed = parseYearMakeModel(heading);
    if (!parsed.make || !parsed.model) continue;
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.split("/").pop(),
      ...parsed,
      year: parsed.year ?? spanYear(chunk),
      price: priceFrom(chunk),
      mileage: milesFrom(chunk),
    });
  }
  return cards;
}

export function extractSnccCarItems(html: string, origin: string) {
  if (!html.includes("new-price") || !html.includes("/cars/")) return [];
  const chunks = html.split(/href="([^"]*\/cars\/(?:20|19)\d{2}-[^"]+)"/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    if (!href || seen.has(href) || !/new-price/i.test(chunk.slice(0, 500))) continue;
    seen.add(href);
    const title = decodeListingText(chunk.match(/^[^>]*>\s*([^<]+)/)?.[1] ?? "");
    const parsed = parseYearMakeModel(title);
    const price = priceFrom(chunk.slice(0, 500));
    if (!parsed.make || !parsed.model || price == null) continue;
    const before = chunks[index - 1] ?? "";
    const specMiles = before.match(/flaticon-gas-station"><\/i>\s*([\d,]+)/i)?.[1];
    const specYear = before.match(/fa-calendar-alt"><\/i>\s*(\d{4})/i)?.[1];
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.split("/").filter(Boolean).at(-1),
      ...parsed,
      year: parsed.year ?? (specYear ? Number(specYear) : yearFrom(href)),
      price,
      mileage: specMiles ? Number(specMiles.replace(/,/g, "")) : milesFrom(chunk.slice(0, 900)),
    });
  }
  return cards;
}

export function extractBespokeCarsForSale(html: string, origin: string) {
  if (!html.includes("car-for-sale-peel-isle-of-man") && !html.includes("JUST ARRIVED")) return [];
  const chunks = html.split(/<h3><a href="(\/car-for-sale-[^"]+)"/i);
  const cards: Record<string, unknown>[] = [];
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    const title = decodeListingText(chunk.match(/^>([^<]+)</)?.[1] ?? "");
    if (!title || !href) continue;
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) continue;
    cards.push({
      url: resolveMaybeUrl(href, origin),
      ...parsed,
      year: parsed.year ?? yearFrom(chunk),
      price: priceFrom(chunk),
      mileage: milesFrom(chunk),
      description: decodeListingText(chunk.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""),
    });
  }
  return cards;
}

export function extractVanMosselStockCards(html: string, origin: string) {
  const found = [...html.matchAll(/href="((?:\/jacksons|\/motormall)\/stock\/(\d+)[^"]*)"/gi)];
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const match of found) {
    const href = match[1] ?? "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const start = match.index ?? 0;
    const window = html.slice(Math.max(0, start - 200), start + 12_000);
    const alt = window.match(/alt="([^"]+)"/i)?.[1] ?? "";
    const parsed = parseYearMakeModel(alt);
    const price = priceFrom(window);
    if (!parsed.make || !parsed.model || price == null) continue;
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: match[2],
      ...parsed,
      price,
      mileage: milesFrom(window),
      year: parsed.year ?? yearFrom(window),
    });
  }
  return cards;
}

export function extractDragon2000Stocklist(html: string, origin: string) {
  if (!html.includes("stocklist-vehicle vehicle_card")) return [];
  const chunks = html.split(/class="stocklist-vehicle vehicle_card/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="([^"]*vehicle-details[^"]+)"/i)?.[1];
    const title =
      chunk.match(/alt="((?:20|19)\d{2} [^"]+?)(?: Image \d+)?"/i)?.[1] ??
      decodeListingText(chunk.match(/title="View ([^"]+)"/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) return [];
    const stock = chunk.match(/data-stock-nr="([^"]+)"/i)?.[1];
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        sourceVehicleId: stock,
        stockNumber: stock,
        ...parsed,
        derivative: decodeListingText(chunk.match(/class="[^"]*variant[^"]*">([^<]+)/i)?.[1] ?? ""),
        year: parsed.year ?? yearFrom(chunk.match(/class="modelYear"[^>]*>([^<]+)/i)?.[1] ?? ""),
        mileage: milesFrom(chunk.match(/class="mileageText"[^>]*>([^<]+)/i)?.[1] ?? ""),
        transmission: decodeListingText(chunk.match(/class="baseTransmission"[^>]*>([^<]+)/i)?.[1] ?? ""),
        fuel: decodeListingText(chunk.match(/class="vehicleFuelType"[^>]*>([^<]+)/i)?.[1] ?? ""),
        engineSize: decodeListingText(chunk.match(/class="engineSize"[^>]*>([^<]+)/i)?.[1] ?? ""),
        price: priceFrom(chunk),
        image: chunk.match(/src="(https:\/\/img\.cdn\.dragon2000\.net[^"]+)"/i)?.[1],
      },
    ];
  });
}

export function extractNamedHtml(html: string, origin: string) {
  return [
    ...extractCdinvCards(html, origin),
    ...extractSelectPropertyListings(html, origin),
    ...extractDwCarViews(html, origin),
    ...extractTdInventoryCards(html, origin),
    ...extractBudgetInventoryCards(html, origin),
    ...extractSnccCarItems(html, origin),
    ...extractBespokeCarsForSale(html, origin),
    ...extractVanMosselStockCards(html, origin),
    ...extractDragon2000Stocklist(html, origin),
  ];
}
