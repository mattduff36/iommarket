import { resolveMaybeUrl } from "../json";
import { decodeListingText, parseYearMakeModel } from "./named-html";

function priceFrom(chunk: string) {
  if (/RESERVED/i.test(chunk) && !/£|&pound;/.test(chunk)) return null;
  const match = decodeListingText(chunk).match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!match?.[1]) return null;
  return Number(match[1].replace(/,/g, ""));
}

function milesFrom(chunk: string) {
  const match = decodeListingText(chunk).match(/([\d,]+)\s*(?:miles|mls)\b/i);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
}

function yearFrom(chunk: string) {
  const match = decodeListingText(chunk).match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function asVrm(value: string) {
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length < 5 || cleaned.length > 10 || !/\d/.test(cleaned) || !/[A-Z]/.test(cleaned)) return null;
  if (/FUEL|TYPE|MILE|YEAR|PRICE|AUTO|MANUAL|PETROL|DIESEL/.test(cleaned)) return null;
  return value.trim() || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstVehicleMiles(visible: string) {
  const matches = [...visible.matchAll(/([\d,]+)\s*(?:genuine\s+)?miles\b/gi)];
  if (matches.length > 3) return null;
  for (const match of matches) {
    const start = match.index ?? 0;
    const context = visible.slice(Math.max(0, start - 48), start + match[0].length + 48);
    if (/warranty|unlimited|service interval/i.test(context)) continue;
    const mileage = Number(match[1]?.replace(/,/g, ""));
    if (Number.isFinite(mileage) && mileage >= 0 && mileage <= 400_000) return mileage;
  }
  return null;
}

export function extractDetailSpecs(html: string, detailUrl?: string | null) {
  const visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const mileageStrong = html.match(/class="car_mileage"[\s\S]{0,160}?<strong[^>]*>\s*([\d,]+)/i)?.[1];
  const yearStrong = html.match(/class="car_year"[\s\S]{0,160}?<strong[^>]*>\s*(\d{4})/i)?.[1];
  const bettridgeMiles = html.match(/class=['"]detail mileage['"][\s\S]{0,80}?<\/i>\s*([\d,]+)/i)?.[1];
  const bettridgeYear = html.match(/class=['"]detail year['"][\s\S]{0,80}?<\/i>\s*(\d{4})/i)?.[1];
  let mileage = mileageStrong
    ? Number(mileageStrong.replace(/,/g, ""))
    : bettridgeMiles
      ? Number(bettridgeMiles.replace(/,/g, ""))
      : null;
  const slug = detailUrl?.split("/").filter(Boolean).at(-1);
  if (mileage == null && slug && slug.length > 8) {
    const near = html.match(new RegExp(`${escapeRegExp(slug)}[\\s\\S]{0,600}?"([\\d,]+) miles"`, "i"))?.[1];
    if (near) mileage = Number(near.replace(/,/g, ""));
  }
  if (mileage == null) {
    const covered = visible.match(/([\d,]+)\s*miles covered/i)?.[1];
    mileage = covered
      ? Number(covered.replace(/,/g, ""))
      : firstVehicleMiles(visible);
  }
  return {
    mileage,
    year: yearStrong
      ? Number(yearStrong)
      : bettridgeYear
        ? Number(bettridgeYear)
        : yearFrom(html.match(/Registered(?: in)?\s+(\d{4})/i)?.[1] ?? "") ??
          yearFrom(visible.match(/\b(?:exceptional|this outstanding)\s+(20\d{2}|19\d{2})\b/i)?.[1] ?? "") ??
          yearFrom(visible.match(/\bA (20\d{2}|19\d{2}) example\b/i)?.[1] ?? ""),
    registration: asVrm(
      decodeListingText(html.match(/\b(?:VRM|Reg(?:istration)?)\b[\s\S]{0,80}>([A-Z0-9 ]{5,10})</i)?.[1] ?? ""),
    ),
    fuel:
      decodeListingText(html.match(/class="car_engine"[\s\S]{0,200}?<strong[^>]*>([^<]+)/i)?.[1] ?? "") ||
      decodeListingText(html.match(/class=['"]detail fuel['"][\s\S]{0,80}?<\/i>\s*([^<]+)/i)?.[1] ?? "") ||
      null,
    transmission:
      decodeListingText(html.match(/class="car_transmission"[\s\S]{0,160}?<strong[^>]*>([^<]+)/i)?.[1] ?? "") ||
      decodeListingText(html.match(/class=['"]detail transmission['"][\s\S]{0,80}?<\/i>\s*([^<]+)/i)?.[1] ?? "") ||
      null,
  };
}

export function extractFranklinsListBoxes(html: string, origin: string) {
  if (!html.includes("list-box-wrapper") || !html.includes("view-car-details")) return [];
  const chunks = html.split(/class="list-box-wrapper/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="(https?:\/\/[^"]+\/cars\/[^"]+\/\d+\/)"/i)?.[1];
    const make = decodeListingText(chunk.match(/<h2>\s*<strong>([^<]+)<\/strong>\s*([^<]+)/i)?.[1] ?? "");
    const model = decodeListingText(chunk.match(/<h2>\s*<strong>[^<]+<\/strong>\s*([^<]+)/i)?.[1] ?? "");
    if (!make || !model) return [];
    const reserved = /RESERVED/i.test(chunk);
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        sourceVehicleId: href?.split("/").filter(Boolean).at(-1),
        make,
        model,
        derivative: decodeListingText(chunk.match(/<h3>([^<]+)<\/h3>/i)?.[1] ?? ""),
        year: yearFrom(chunk.match(/<h3>([^<]+)<\/h3>/i)?.[1] ?? ""),
        price: reserved ? null : priceFrom(chunk),
        isPoa: reserved,
        mileage: milesFrom(chunk),
        transmission: decodeListingText(chunk.match(/title='Transmission'>([^<]+)/i)?.[1] ?? ""),
        fuel: decodeListingText(chunk.match(/title='Fuel'>([^<]+)/i)?.[1] ?? ""),
      },
    ];
  });
}

export function extractManxVehicleCards(html: string, origin: string) {
  if (!html.includes("makemodel") || !html.includes("data-finance")) return [];
  const chunks = html.split(/class="card text-bg-primary h-100 vehicle"/i).slice(1);
  const seen = new Set<string>();
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="(\/vehicle\/[^"]+)"/i)?.[1];
    if (!href || seen.has(href)) return [];
    seen.add(href);
    const makeModel = decodeListingText(chunk.match(/class="makemodel[^"]*">([^<]+)/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(makeModel);
    if (!parsed.make || !parsed.model) return [];
    let finance: Record<string, unknown> = {};
    const raw = chunk.match(/data-finance="([^"]*)"/i)?.[1];
    if (raw) {
      try {
        finance = JSON.parse(raw.replace(/&quot;/g, '"')) as Record<string, unknown>;
      } catch {
        finance = {};
      }
    }
    const priceText = decodeListingText(chunk.match(/class="price\s*">([\s\S]{0,80})</i)?.[1] ?? "");
    const regDate = typeof finance.RegDate === "string" ? finance.RegDate : "";
    return [
      {
        url: resolveMaybeUrl(href, origin),
        sourceVehicleId: typeof finance.Id === "string" ? finance.Id : href.split("-").at(-1),
        ...parsed,
        derivative: decodeListingText(chunk.match(/class="version[^"]*">([^<]+)/i)?.[1] ?? ""),
        year: parsed.year ?? (regDate ? Number(regDate.slice(0, 4)) : null),
        price: typeof finance.Price === "number" ? finance.Price : priceFrom(chunk),
        isPoa: /poa/i.test(priceText),
        mileage: typeof finance.Mileage === "number" ? finance.Mileage : null,
        registration: typeof finance.VRM === "string" ? finance.VRM : null,
        image: typeof finance.ImageUrl === "string" ? finance.ImageUrl : null,
      },
    ];
  });
}

export function extractKingswoodPreowned(html: string, origin: string) {
  if (!html.includes("showroom-preowned-cars-container")) return [];
  const chunks = html.split(/class="showroom-preowned-cars-container"/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="(https?:\/\/[^"]+\/preowned-cars\/[^"]+)"/i)?.[1];
    const title = decodeListingText(chunk.match(/<h3>([^<]+)<\/h3>/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) return [];
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        sourceVehicleId: href?.split("/").filter(Boolean).at(-1),
        ...parsed,
        price: priceFrom(chunk),
      },
    ];
  });
}

export function extractRexSalesBoxes(html: string, origin: string) {
  if (!html.includes("vehicles-list") || !html.includes("FOR SALE")) return [];
  const chunks = html.split(/<a class="box" href="(\/(?:sales|retail)\/[^"]+)"/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    if (!href || seen.has(href) || !/FOR SALE/i.test(chunk)) continue;
    seen.add(href);
    const title = decodeListingText(chunk.match(/<h2>([^<]+)<\/h2>/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) continue;
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.split("/").filter(Boolean).at(-1),
      ...parsed,
      price: priceFrom(chunk),
    });
  }
  return cards;
}

export function extractDealerWebsitesCards(html: string, origin: string) {
  if (!html.includes("vehicle-make-model") || !html.includes("vehicle-price")) return [];
  const chunks = html.split(/href="(https?:\/\/[^"]+\/vehicle\/[a-f0-9]+)"/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < chunks.length; index += 2) {
    const href = chunks[index];
    const chunk = chunks[index + 1] ?? "";
    if (!href || seen.has(href)) continue;
    const makeModel = decodeListingText(chunk.match(/class="make-model[^"]*">([^<]+)/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(makeModel);
    if (!parsed.make || !parsed.model) continue;
    seen.add(href);
    const derivative = decodeListingText(chunk.match(/class="derivative[^"]*">([\s\S]*?)<\/span>/i)?.[1] ?? "");
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href.split("/").filter(Boolean).at(-1),
      ...parsed,
      derivative,
      year: parsed.year ?? yearFrom(derivative),
      price: priceFrom(chunk),
      mileage: milesFrom(chunk.match(/class="r25">([^<]*Miles)/i)?.[1] ?? ""),
    });
  }
  return cards;
}

export function extractBettridgeMotorCards(html: string, origin: string) {
  if (!/class=['"]detail (?:year|mileage)['"]/i.test(html) || !html.includes("<h2><span>")) return [];
  const parts = html.split(/<h2><span>/i);
  const cards: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < parts.length; index += 1) {
    const before = parts[index - 1] ?? "";
    const chunk = parts[index] ?? "";
    const make = decodeListingText(chunk.match(/^([^<]+)/)?.[1] ?? "");
    const model = decodeListingText(chunk.match(/^[^<]+<\/span>\s*([^<]+)/)?.[1] ?? "");
    if (!make || !model) continue;
    const href =
      before.match(/href="(\/motor\/[^"]+\/)"/i)?.[1] ??
      html.match(/rel="canonical" href="([^"]+\/motor\/[^"]+)"/i)?.[1] ??
      null;
    const key = href ?? `${make}-${model}-${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      url: resolveMaybeUrl(href, origin),
      sourceVehicleId: href?.split("/").filter(Boolean).at(-1),
      make,
      model,
      year: Number(chunk.match(/class=['"]detail year['"][\s\S]{0,80}?<\/i>\s*(\d{4})/i)?.[1] ?? "") || null,
      mileage: Number(chunk.match(/class=['"]detail mileage['"][\s\S]{0,80}?<\/i>\s*([\d,]+)/i)?.[1]?.replace(/,/g, "") ?? "") || null,
      price: priceFrom(chunk),
      fuel: decodeListingText(chunk.match(/class=['"]detail fuel['"][\s\S]{0,80}?<\/i>\s*([^<]+)/i)?.[1] ?? ""),
      transmission: decodeListingText(
        chunk.match(/class=['"]detail transmission['"][\s\S]{0,80}?<\/i>\s*([^<]+)/i)?.[1] ?? "",
      ),
    });
  }
  return cards;
}

export function extractClickDealerListings(html: string, origin: string) {
  if (!html.includes("results-spec__label") || !/listing[^"']*veh-/i.test(html)) return [];
  const chunks = html.split(/class="listing[^"]*veh-/i).slice(1);
  return chunks.flatMap((chunk) => {
    const href = chunk.match(/href="(\/used-[^"#]+)"/i)?.[1];
    const title =
      decodeListingText(chunk.match(/results-summary__title">([^<]+)/i)?.[1] ?? "") ||
      decodeListingText(chunk.match(/title="((?:20|19)\d{2} [^"]+)"/i)?.[1] ?? "");
    const parsed = parseYearMakeModel(title.split(" - ")[0] ?? title);
    if (!parsed.make || !parsed.model) return [];
    const spec = (label: string) =>
      decodeListingText(
        chunk.match(new RegExp(`results-spec__label">${label}</span>\\s*<span class="results-spec__stat">([^<]+)`, "i"))?.[1] ??
          "",
      );
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        sourceVehicleId: href?.split("-").at(-1) ?? chunk.match(/^(\d+)/)?.[1],
        ...parsed,
        year: parsed.year ?? yearFrom(spec("Year")),
        mileage: milesFrom(spec("Mileage")) ?? milesFrom(chunk),
        fuel: spec("Fuel Type") || null,
        transmission: spec("Transmission") || null,
        price: priceFrom(chunk.match(/class="price">([^<]+)/i)?.[1] ?? chunk),
        image: chunk.match(/src="(https:\/\/images\.clickdealer\.co\.uk[^"]+)"/i)?.[1],
      },
    ];
  });
}

export function extractSwiftBskCards(html: string, origin: string) {
  if (!html.includes("<bsk-vehicle-card") || !html.includes("manufacturer=")) return [];
  const chunks = html.split(/<bsk-vehicle-card(?![\w-])/i).slice(1);
  const seen = new Set<string>();
  return chunks.flatMap((chunk) => {
    const stockId = chunk.match(/\bid="(?:car_)?(\d+)"/i)?.[1] ?? chunk.match(/stockid="(\d+)"/i)?.[1];
    const make = decodeListingText(chunk.match(/manufacturer="([^"]+)"/i)?.[1] ?? "");
    const model = decodeListingText(chunk.match(/\smodel="([^"]+)"/i)?.[1] ?? "");
    if (!make || !model || (stockId && seen.has(stockId))) return [];
    if (stockId) seen.add(stockId);
    const href = chunk.match(/url="(\/used-vehicle-details\/[^"]+)"/i)?.[1];
    const priceText = chunk.match(/\bprice="([\d,]+)"/i)?.[1];
    const yearAttr = chunk.match(/regyear="(\d{4})"/i)?.[1];
    const mileageAttr = chunk.match(/['"]mileage['"]\s*:\s*['"]([\d,]+)/i)?.[1];
    return [
      {
        url: resolveMaybeUrl(href ?? null, origin),
        sourceVehicleId: stockId,
        make,
        model,
        derivative: decodeListingText(chunk.match(/\bversion="([^"]+)"/i)?.[1] ?? ""),
        year: yearAttr ? Number(yearAttr) : yearFrom(chunk),
        price: priceText ? Number(priceText.replace(/,/g, "")) : priceFrom(chunk),
        mileage: mileageAttr ? Number(mileageAttr.replace(/,/g, "")) : milesFrom(chunk),
        fuel: decodeListingText(chunk.match(/fuelType['"]\s*:\s*['"]([^'"]+)/i)?.[1] ?? ""),
        transmission: decodeListingText(chunk.match(/transmission['"]\s*:\s*['"]([^'"]+)/i)?.[1] ?? ""),
        colour: decodeListingText(chunk.match(/colour['"]\s*:\s*['"]([^'"]+)/i)?.[1] ?? ""),
        image: chunk.match(/img-src="(https:[^"]+)"/i)?.[1],
      },
    ];
  });
}

function takeJsonAttribute(chunk: string) {
  if (!chunk.startsWith("{")) return null;
  let depth = 0;
  for (let index = 0; index < chunk.length; index += 1) {
    const char = chunk[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return chunk.slice(0, index + 1);
    }
  }
  return null;
}

function parseProductFields(raw: string) {
  try {
    return JSON.parse(raw.replace(/&quot;/g, '"')) as Record<string, unknown>;
  } catch {
    const field = (name: string) =>
      raw.match(new RegExp(`(?:&quot;|")${name}(?:&quot;|")\\s*:\\s*(?:&quot;|")([\\s\\S]*?)(?:&quot;|")`))?.[1] ?? "";
    return {
      id: field("id"),
      title: field("title"),
      description: field("description"),
    };
  }
}

export function extractPhilShawProducts(html: string, origin: string) {
  if (!html.includes("u-products-item") || !html.includes("data-product=")) return [];
  const chunks = html.split(/data-product="/i).slice(1);
  const seen = new Set<string>();
  return chunks.flatMap((chunk) => {
    const raw = takeJsonAttribute(chunk);
    if (!raw) return [];
    const product = parseProductFields(raw);
    const title = decodeListingText(typeof product.title === "string" ? product.title : "");
    const parsed = parseYearMakeModel(title);
    if (!parsed.make || !parsed.model) return [];
    const id = typeof product.id === "string" ? product.id : null;
    if (id && seen.has(id)) return [];
    if (id) seen.add(id);
    const description = decodeListingText(typeof product.description === "string" ? product.description : "");
    const fullDescription = decodeListingText(
      typeof product.fullDescription === "string" ? product.fullDescription : "",
    );
    const registered = description.match(/First Registered:\s*(\d{4})/i)?.[1];
    return [
      {
        url: resolveMaybeUrl(id ? `/?productId=${id}` : null, origin),
        sourceVehicleId: id,
        ...parsed,
        year: parsed.year ?? (registered ? Number(registered) : null),
        price: priceFrom(fullDescription) ?? priceFrom(chunk.slice(raw.length, raw.length + 400)),
        mileage: milesFrom(description),
        description,
      },
    ];
  });
}

export function extractExtraNamedHtml(html: string, origin: string) {
  return [
    ...extractFranklinsListBoxes(html, origin),
    ...extractManxVehicleCards(html, origin),
    ...extractKingswoodPreowned(html, origin),
    ...extractRexSalesBoxes(html, origin),
    ...extractDealerWebsitesCards(html, origin),
    ...extractBettridgeMotorCards(html, origin),
    ...extractClickDealerListings(html, origin),
    ...extractSwiftBskCards(html, origin),
    ...extractPhilShawProducts(html, origin),
  ];
}
