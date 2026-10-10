import { asNumber, asRecord, asString, nested, poundsToPence, resolveMaybeUrl } from "../json";
import { emptyVehicle, validateCanonicalVehicle, type ConnectorContext, type StockConnector } from "./contract";
import {
  extractDescriptionFromHtml,
  extractWebsiteDetailImages,
  isNextInventoryDetailUrl,
  mergeOwnerImageUrls,
} from "../html-media";
import {
  collectJsonVehicles,
  discoverStockPageUrls,
  extractJsonLdVehicles,
  extractNextDataVehicles,
  extractStructuredHtml,
} from "./html-extract";
import { extractDetailSpecs } from "./named-html-more";
import type { CanonicalVehicle, ConnectorKey, SourceListResult } from "../types";

function blockedStatus(message: string) {
  return /403|401|cloudflare|captcha|access denied|blocked/i.test(message)
    ? "blocked_requires_feed"
    : "failed";
}

export function parseGenericVehicle(rawValue: unknown, origin: string | null) {
  const raw = asRecord(rawValue);
  if (!raw) return null;
  const make = asString(raw.make) ?? asString(raw.manufacturer) ?? asString(raw.Make) ?? "";
  const model = asString(raw.model) ?? asString(raw.Model) ?? "";
  if (!make && !model) return null;
  const price =
    asNumber(raw.price) ??
    asNumber(raw.price_now) ??
    asNumber(raw.askingPrice) ??
    asNumber(raw.cashPrice) ??
    asNumber(raw.Price) ??
    asNumber(nested(raw, ["price", "amount"]));
  const availabilityValue = (
    asString(raw.availability) ??
    asString(raw.status) ??
    asString(raw.stockStatus) ??
    ""
  ).toLowerCase();
  const availability: CanonicalVehicle["availability"] = availabilityValue.includes("sold")
    ? "sold"
    : availabilityValue.includes("reserv")
      ? "reserved"
      : availabilityValue
        ? "unknown"
        : "available";
  return {
    sourceVehicleId:
      asString(raw.sourceVehicleId) ??
      asString(raw.id) ??
      asString(raw.stockId) ??
      asString(raw.slug),
    registration: asString(raw.registration) ?? asString(raw.reg) ?? asString(raw.vrm) ?? asString(raw.VRM),
    vin: asString(raw.vin) ?? asString(raw.VIN),
    stockReference: asString(raw.stockNumber) ?? asString(raw.stock_number) ?? asString(raw.reference),
    make,
    model,
    derivative: asString(raw.variant) ?? asString(raw.derivative) ?? asString(raw.trim),
    year:
      asNumber(raw.year) ??
      asNumber(raw.regYear) ??
      asNumber(raw.registrationYear) ??
      asNumber(raw.Year) ??
      asNumber(String(raw.RegDate ?? raw.regDate ?? "").slice(0, 4)),
    mileage: asNumber(raw.mileage) ?? asNumber(raw.odometer) ?? asNumber(raw.Mileage),
    pricePence: price == null ? null : price > 10_000_000 ? Math.round(price) : poundsToPence(price),
    isPoa: Boolean(raw.isPoa) || asString(raw.price)?.toLowerCase() === "poa",
    fuel: asString(raw.fuel) ?? asString(raw.fuelType),
    transmission: asString(raw.transmission),
    bodyType: asString(raw.bodyType) ?? asString(raw.body),
    colour: asString(raw.colour) ?? asString(raw.color),
    doors: asNumber(raw.doors),
    seats: asNumber(raw.seats),
    engineSize: asNumber(raw.engineSize),
    enginePower: asNumber(raw.enginePower) ?? asNumber(raw.bhp),
    vehicleType: asString(raw.vehicleType) ?? asString(raw.type),
    description: asString(raw.description) ?? "",
    locationName: asString(raw.location) ?? asString(raw.locationName),
    detailUrl: resolveMaybeUrl(asString(raw.url) ?? asString(raw.link) ?? asString(raw.href), origin),
    imageUrls: [
      asString(raw.image),
      asString(raw.imageUrl),
      ...(Array.isArray(raw.images) ? raw.images.map((item) => asString(item) ?? asString(asRecord(item)?.url)) : []),
    ].filter((item): item is string => Boolean(item)),
    availability,
  };
}

export function normalizeWebsiteVehicle(raw: unknown, context: ConnectorContext) {
  const origin = context.source.startUrl ? new URL(context.source.startUrl).origin : null;
  const parsed = parseGenericVehicle(raw, origin);
  if (!parsed) return null;
  return emptyVehicle(context, {
    ...parsed,
  });
}

export function mergeRawRecords(groups: unknown[][]) {
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const group of groups) {
    for (const item of group) {
      const raw = asRecord(item);
      const key =
        asString(raw?.url) ??
        asString(raw?.href) ??
        asString(raw?.sourceVehicleId) ??
        asString(raw?.id) ??
        asString(raw?.stockId);
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      merged.push(item);
    }
  }
  return merged;
}

function toListResult(
  context: ConnectorContext,
  startUrl: string,
  raw: unknown[],
  pagesFetched: number,
  html = "",
): SourceListResult {
  const vehicles = raw
    .map((item) => normalizeWebsiteVehicle(item, context))
    .filter((item): item is CanonicalVehicle => item != null);
  const confirmedEmpty = context.source.connectorKey === "click-dealer" && raw.length === 0 &&
    /We do not have any matching vehicles in stock at present\./i.test(
      html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    );
  return {
    dealerKey: context.dealer.key,
    sourceKey: context.source.key,
    platform: context.source.connectorKey,
    status: vehicles.length > 0 || confirmedEmpty ? "ok" : "failed",
    error: vehicles.length > 0 || confirmedEmpty ? null : "No structured public stock records found",
    startUrl,
    pagesFetched,
    advertisedCount: confirmedEmpty ? 0 : null,
    rawCount: vehicles.length > 0 ? vehicles.length : null,
    vehicles,
    rawRecords: raw,
  };
}

export function createWebsiteConnector(input: {
  key: ConnectorKey;
  detect: StockConnector["detect"];
  requestMatch?: (url: string, body: string | null) => boolean;
  extractHtml?: (html: string, origin: string) => unknown[];
  preferBrowser?: boolean;
  settleMs?: number;
  waitForSelector?: string;
  headed?: boolean;
}): StockConnector {
  return {
    key: input.key,
    detect: input.detect,
    async probe(context) {
      return {
        dealerKey: context.dealer.key,
        displayName: context.dealer.displayName,
        website: context.dealer.website,
        stockUrls: context.dealer.stockUrls,
        detectedPlatform: input.key,
        selectedConnector: input.key,
        status: context.source.startUrl ? "ok" : "no_public_stock",
        evidence: [`Selected connector ${input.key}`],
      };
    },
    async fetchList(context) {
      return fetchWebsiteList(context, {
        requestMatch: input.requestMatch,
        extractHtml: input.extractHtml,
        preferBrowser: input.preferBrowser,
        settleMs: input.settleMs,
        waitForSelector: input.waitForSelector,
        headed: input.headed,
      });
    },
    async fetchDetails(context, frozen) {
      const { fetchPageHtml, withPublicPage } = await import("../browse");
      const enrich = async (load: (url: string) => Promise<string>) => {
      let detailMissing = 0;
      const vehicles: CanonicalVehicle[] = [];
      for (const vehicle of frozen) {
        if (!vehicle.detailUrl) {
          detailMissing += 1;
          vehicles.push(vehicle);
          continue;
        }
        try {
          const html = await load(vehicle.detailUrl);
          const origin = new URL(vehicle.detailUrl).origin;
          const specs = extractDetailSpecs(html, vehicle.detailUrl);
          const detailImages = extractWebsiteDetailImages(html, origin, {
            dealerKey: context.dealer.key,
            detailUrl: vehicle.detailUrl,
          });
          const scopedGallery =
            context.dealer.key === "swift-motors" ||
            (isNextInventoryDetailUrl(vehicle.detailUrl) && html.includes("__NEXT_DATA__"));
          vehicles.push({
            ...vehicle,
            description: extractDescriptionFromHtml(html) || vehicle.description,
            imageUrls: scopedGallery
              ? mergeOwnerImageUrls(detailImages, vehicle.imageUrls)
              : mergeOwnerImageUrls(vehicle.imageUrls, detailImages),
            mileage: vehicle.mileage ?? specs.mileage,
            year: vehicle.year ?? specs.year,
            registration: vehicle.registration ?? specs.registration ?? null,
            fuel: vehicle.fuel ?? specs.fuel ?? null,
            transmission: vehicle.transmission ?? specs.transmission ?? null,
          });
        } catch {
          detailMissing += 1;
          vehicles.push(vehicle);
        }
      }
      return { vehicles, detailMissing };
      };
      if (context.source.connectorKey === "click-dealer" && !context.fetchImpl && context.source.startUrl && frozen.length) {
        return withPublicPage(context.source.startUrl, async page => enrich(async url => {
          const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          if (!response?.ok()) throw new Error("Vehicle detail page was unavailable");
          return page.content();
        }), { headed: false, settleMs: 1000 });
      }
      return enrich(url => fetchPageHtml(url, context.fetchImpl));
    },
    normalize(raw, context) {
      return normalizeWebsiteVehicle(raw, context);
    },
    validate: validateCanonicalVehicle,
  };
}

export async function fetchWebsiteList(
  context: ConnectorContext,
  options: {
    requestMatch?: (url: string, body: string | null) => boolean;
    extractHtml?: (html: string, origin: string) => unknown[];
    preferBrowser?: boolean;
    settleMs?: number;
    waitForSelector?: string;
    headed?: boolean;
  } = {},
): Promise<SourceListResult> {
  const startUrl = context.source.startUrl;
  if (!startUrl) {
    return {
      dealerKey: context.dealer.key,
      sourceKey: context.source.key,
      platform: context.source.connectorKey,
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
    const { withPublicPage, fetchPageHtml } = await import("../browse");
    const origin = new URL(startUrl).origin;
    const preferBrowser = context.source.preferBrowser ?? options.preferBrowser;
    const headed = context.source.headed ?? options.headed ?? process.env.DEALER_STOCK_HEADED === "1";
    const waitForSelector = context.source.waitForSelector ?? options.waitForSelector;
    const settleMs = context.source.settleMs ?? options.settleMs ?? 2_500;
    const maxPages = Math.max(1, context.source.maxPages ?? 1);
    if (!headed) {
      try {
        const firstHtml = await fetchPageHtml(startUrl, context.fetchImpl);
        let raw = preferBrowser
          ? [...extractNextDataVehicles(firstHtml), ...extractJsonLdVehicles(firstHtml)].filter(Boolean)
          : extractStructuredHtml(firstHtml, origin, options.extractHtml);
        let pagesFetched = 1;
        const fetched = new Set([startUrl.replace(/\/$/, "")]);
        const queue = discoverStockPageUrls(firstHtml, startUrl);
        let failedPage = false;
        while (!preferBrowser && pagesFetched < maxPages && queue.length) {
          const pageUrl = queue.shift()!;
          const key = pageUrl.replace(/\/$/, "");
          if (fetched.has(key)) continue;
          fetched.add(key);
          try {
            const pageHtml = await fetchPageHtml(pageUrl, context.fetchImpl);
            raw = mergeRawRecords([raw, extractStructuredHtml(pageHtml, origin, options.extractHtml)]);
            pagesFetched += 1;
            for (const next of discoverStockPageUrls(pageHtml, pageUrl)) {
              if (!fetched.has(next.replace(/\/$/, "")) && !queue.includes(next)) queue.push(next);
            }
          } catch { failedPage = true; }
        }
        const listed = toListResult(context, startUrl, raw, pagesFetched, firstHtml);
        const withPagination = { ...listed, paginationUncertain: failedPage || queue.length > 0 || listed.vehicles.length !== raw.length };
        if (listed.status === "ok" || preferBrowser === false) return withPagination;
      } catch (error) {
        if (preferBrowser === false) {
          throw error;
        }
      }
    }

    const capturedJson = await withPublicPage(
      startUrl,
      async (page, captured, jsonPayloads, htmlPayloads) => {
        const jsonRequest = captured.find((item) =>
          options.requestMatch
            ? options.requestMatch(item.url, item.body)
            : /\/api\/|loadSearch|inventory|stock-listing/i.test(item.url) &&
              !/google|facebook|analytics|hotjar|visitor-chat|config\/components/i.test(item.url),
        );
        const htmls = [await page.content()];
        const visited = new Set([page.url().replace(/\/$/, "")]);
        const queue = discoverStockPageUrls(htmls[0] ?? "", page.url());
        const { sleep } = await import("../rate-limit");
        while (htmls.length < maxPages && queue.length > 0) {
          const nextUrl = queue.shift();
          if (!nextUrl || visited.has(nextUrl.replace(/\/$/, ""))) continue;
          visited.add(nextUrl.replace(/\/$/, ""));
          await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
          if (waitForSelector) {
            await page.locator(waitForSelector).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
          }
          await sleep(settleMs);
          const nextHtml = await page.content();
          htmls.push(nextHtml);
          for (const extra of discoverStockPageUrls(nextHtml, nextUrl)) {
            if (!visited.has(extra.replace(/\/$/, "")) && !queue.includes(extra)) queue.push(extra);
          }
        }
        return {
          jsonRequest,
          html: htmls[0],
          htmls,
          jsonPayloads,
          htmlPayloads,
          paginationUncertain: queue.length > 0,
        };
      },
      {
        captureJson: true,
        settleMs,
        waitForSelector,
        headed,
        captureHtmlUrls: options.requestMatch ? (url) => Boolean(options.requestMatch?.(url, null)) : undefined,
      },
    );

    const pages = capturedJson.htmls ?? [capturedJson.html];
    const fromPages = pages.flatMap((html: string) => extractStructuredHtml(html, origin, options.extractHtml));
    const fromAjax = capturedJson.htmlPayloads.flatMap((html) =>
      extractStructuredHtml(html, origin, options.extractHtml),
    );
    const fromJson = capturedJson.jsonPayloads.flatMap((payload) => {
      const record = asRecord(payload);
      if (typeof record?.html === "string") {
        return extractStructuredHtml(record.html, origin, options.extractHtml);
      }
      return collectJsonVehicles(payload);
    });
    let raw = mergeRawRecords([fromPages, fromAjax, fromJson]);
    if (raw.length === 0 && capturedJson.jsonRequest) {
      try {
        const response = await (context.fetchImpl ?? fetch)(capturedJson.jsonRequest.url, {
          method: capturedJson.jsonRequest.method,
          headers: capturedJson.jsonRequest.headers,
          body:
            capturedJson.jsonRequest.method.toUpperCase() === "GET"
              ? undefined
              : (capturedJson.jsonRequest.body ?? undefined),
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (response.ok && contentType.includes("json")) {
          const replayed = collectJsonVehicles(await response.json());
          if (replayed.length > 0) raw = replayed;
        }
      } catch {
        // Keep captured payloads / fall through to rendered HTML.
      }
    }
    return {
      ...toListResult(context, startUrl, raw, pages.length, pages.join("\n")),
      paginationUncertain: Boolean(capturedJson.paginationUncertain) || raw.some(item => !normalizeWebsiteVehicle(item, context)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      dealerKey: context.dealer.key,
      sourceKey: context.source.key,
      platform: context.source.connectorKey,
      status: blockedStatus(message),
      error: message,
      startUrl,
      pagesFetched: 0,
      advertisedCount: null,
      rawCount: null,
      vehicles: [],
    };
  }
}
