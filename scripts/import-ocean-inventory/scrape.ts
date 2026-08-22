import { chromium, type Page } from "@playwright/test";
import {
  isClassicListRequest,
  isVueListRequest,
  transitUsedVansUrl,
  withPageQuery,
} from "./classic";
import {
  extractHasMoreResults,
  extractSearchVehicles,
  extractTotalPages,
  mergeDetailIntoCard,
  normalizeNetDirectorVehicle,
  vehicleIdentityToken,
} from "./normalize";
import { OCEAN_SOURCES, type OceanSourceKey } from "./sources";
import type { NormalizedVehicle, SourceListResult, SourceSearchContext } from "./types";

export interface NetDirectorSearchContext extends SourceSearchContext {}

export interface CapturedSearchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface SearchPageResult {
  vehicles: unknown[];
  totalPages: number;
  hasMoreResults: boolean;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const HEADER_ALLOWLIST = [
  "authorization",
  "accept",
  "content-type",
  "origin",
  "referer",
  "user-agent",
] as const;

export function buildSearchUrl(context: NetDirectorSearchContext, extraQuery = "") {
  const base = context.apiUrl.replace(/\/$/, "");
  const url = new URL(`${base}/api/vehicle-search`);
  url.searchParams.set("uuid", context.uuid);
  if (extraQuery) {
    const extra = new URLSearchParams(extraQuery);
    extra.forEach((value, key) => url.searchParams.set(key, value));
  }
  return url.toString();
}

export function withPageNumber(body: string | null, page: number) {
  if (!body) {
    return JSON.stringify({ page, pageNumber: page, pageIndex: page });
  }
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.query === "string" && /currentPage:\s*\d+/.test(parsed.query)) {
      parsed.query = parsed.query.replace(/currentPage:\s*\d+/, `currentPage: ${page}`);
      return JSON.stringify(parsed);
    }
    if ("page" in parsed) parsed.page = page;
    if ("pageNumber" in parsed) parsed.pageNumber = page;
    if ("pageIndex" in parsed) parsed.pageIndex = page;
    if (!("page" in parsed) && !("pageNumber" in parsed) && !("pageIndex" in parsed)) {
      parsed.page = page;
    }
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

function sanitizeHeaders(headers?: Record<string, string>) {
  if (!headers) return {};
  const sanitized: Record<string, string> = {};
  for (const key of HEADER_ALLOWLIST) {
    const value = headers[key] ?? headers[key.toUpperCase()];
    if (value) sanitized[key] = value;
  }
  return sanitized;
}

export async function fetchSearchPage(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SearchPageResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const method = (input.method ?? "POST").toUpperCase();
  const response = await fetchImpl(input.url, {
    method,
    headers: {
      accept: "application/json",
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...sanitizeHeaders(input.headers),
    },
    body: method === "GET" ? undefined : (input.body ?? undefined),
  });
  if (!response.ok) {
    throw new Error(`vehicle-search failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const vehicles = extractSearchVehicles(payload);
  return {
    vehicles,
    totalPages: extractTotalPages(payload, vehicles.length),
    hasMoreResults: extractHasMoreResults(payload),
  };
}

export async function paginateVehicleSearch(input: {
  context: NetDirectorSearchContext;
  captured?: CapturedSearchRequest | null;
  fetchImpl?: typeof fetch;
}) {
  const firstUrl = input.captured?.url ?? buildSearchUrl(input.context);
  const firstBody = withPageNumber(input.captured?.body ?? JSON.stringify({ page: 1 }), 1);
  const first = await fetchSearchPage({
    url: firstUrl,
    method: input.captured?.method,
    headers: input.captured?.headers,
    body: firstBody,
    fetchImpl: input.fetchImpl,
  });

  const vehicles = [...first.vehicles];
  let pagesFetched = 1;
  for (let page = 2; page <= first.totalPages; page += 1) {
    const next = await fetchSearchPage({
      url: firstUrl,
      method: input.captured?.method,
      headers: input.captured?.headers,
      body: withPageNumber(input.captured?.body ?? JSON.stringify({ page }), page),
      fetchImpl: input.fetchImpl,
    });
    vehicles.push(...next.vehicles);
    pagesFetched += 1;
    if (next.vehicles.length === 0) break;
  }
  return { vehicles, pagesFetched };
}

export async function paginateClassicListing(input: {
  captured: CapturedSearchRequest;
  fetchImpl?: typeof fetch;
}) {
  const first = await fetchSearchPage({
    url: withPageQuery(input.captured.url, 1),
    method: "GET",
    headers: input.captured.headers,
    fetchImpl: input.fetchImpl,
  });
  const vehicles = [...first.vehicles];
  let pagesFetched = 1;
  let page = 2;
  let hasMore = first.hasMoreResults;
  while (page <= first.totalPages || hasMore) {
    if (page > 50) break;
    const next = await fetchSearchPage({
      url: withPageQuery(input.captured.url, page),
      method: "GET",
      headers: input.captured.headers,
      fetchImpl: input.fetchImpl,
    });
    vehicles.push(...next.vehicles);
    pagesFetched += 1;
    hasMore = next.hasMoreResults;
    if (next.vehicles.length === 0 || (!hasMore && page >= first.totalPages)) break;
    page += 1;
  }
  return { vehicles, pagesFetched };
}

export function freezeListSnapshot(results: SourceListResult[]) {
  return results.map((result) => ({
    ...result,
    vehicles: result.vehicles.map((vehicle) => ({ ...vehicle })),
  }));
}

export function applyDetailEnrichment(
  frozen: NormalizedVehicle[],
  detailsByToken: Map<string, NormalizedVehicle>,
) {
  const frozenTokens = new Set(frozen.map((vehicle) => vehicleIdentityToken(vehicle)));
  const extraTokens = [...detailsByToken.keys()].filter((token) => !frozenTokens.has(token));
  if (extraTokens.length > 0) {
    throw new Error(`Detail phase introduced new vehicles: ${extraTokens.join(", ")}`);
  }

  let detailMissing = 0;
  const enriched: NormalizedVehicle[] = [];
  for (const card of frozen) {
    const detail = detailsByToken.get(vehicleIdentityToken(card));
    if (!detail) {
      const mappable = Boolean(card.make && card.model && card.year != null && card.mileage != null);
      if (!mappable) detailMissing += 1;
      enriched.push(card);
      continue;
    }
    enriched.push(mergeDetailIntoCard(card, detail));
  }
  return { vehicles: enriched, detailMissing };
}

function contextFromCaptured(captured: CapturedSearchRequest): NetDirectorSearchContext {
  const url = new URL(captured.url);
  if (isVueListRequest(captured.url, captured.body)) {
    return {
      kind: "vue",
      apiUrl: url.origin,
      uuid: url.searchParams.get("uuid") ?? "",
      clientToken: captured.headers.authorization,
      authorizationHeader: captured.headers.authorization,
    };
  }
  return {
    kind: "classic",
    apiUrl: url.origin,
    uuid: url.searchParams.get("pageId") ?? url.searchParams.get("section[]") ?? "",
    authorizationHeader: captured.headers.authorization,
  };
}

async function dismissCookies(page: Page) {
  for (const name of [/accept all/i, /allow all/i, /accept/i, /agree/i]) {
    const cookie = page.getByRole("button", { name }).first();
    if (await cookie.count()) {
      await cookie.click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
}

async function waitForListingRequest(
  page: Page,
  captured: CapturedSearchRequest[],
  timeoutMs = 20_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (captured.some((item) => isClassicListRequest(item.url) || isVueListRequest(item.url, item.body))) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

function pickListRequest(captured: CapturedSearchRequest[]) {
  return (
    captured.find((item) => isVueListRequest(item.url, item.body)) ??
    captured.find((item) => isClassicListRequest(item.url)) ??
    null
  );
}

async function scrapeSourceList(input: {
  sourceKey: OceanSourceKey;
  startUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<SourceListResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const browserContext = await browser.newContext({
      userAgent: BROWSER_UA,
      locale: "en-GB",
      viewport: { width: 1440, height: 1100 },
    });
    const page = await browserContext.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const captured: CapturedSearchRequest[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes("vehicle-search") && !isClassicListRequest(url)) return;
      captured.push({
        url,
        method: request.method(),
        headers: sanitizeHeaders(request.headers()),
        body: request.postData(),
      });
    });
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissCookies(page);
    await waitForListingRequest(page, captured, 12_000);

    if (!pickListRequest(captured) && input.sourceKey === "transit-centre") {
      await page.goto(transitUsedVansUrl(input.startUrl), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await dismissCookies(page);
      await waitForListingRequest(page, captured, 12_000);
    }

    const listRequest = pickListRequest(captured);
    if (!listRequest) {
      throw new Error("No vehicle-search or stock-listing/get-items request was captured");
    }

    const origin = new URL(input.startUrl).origin;
    const search =
      listRequest.body && isVueListRequest(listRequest.url, listRequest.body)
        ? await paginateVehicleSearch({
            context: contextFromCaptured(listRequest),
            captured: listRequest,
            fetchImpl: input.fetchImpl,
          })
        : await paginateClassicListing({
            captured: listRequest,
            fetchImpl: input.fetchImpl,
          });
    const vehicles = search.vehicles
      .map((item) => normalizeNetDirectorVehicle(item, input.sourceKey, origin))
      .filter((item): item is NormalizedVehicle => item != null);
    await browserContext.close();
    return {
      sourceKey: input.sourceKey,
      status: "ok",
      error: null,
      startUrl: input.startUrl,
      pagesFetched: search.pagesFetched,
      rawCount: vehicles.length,
      vehicles,
      searchContext: contextFromCaptured(listRequest),
    };
  } catch (error) {
    return {
      sourceKey: input.sourceKey,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      startUrl: input.startUrl,
      pagesFetched: 0,
      rawCount: null,
      vehicles: [],
      searchContext: null,
    };
  } finally {
    await browser.close();
  }
}

export async function fetchVehicleDetail(input: {
  context: NetDirectorSearchContext;
  stockId: string;
  fetchImpl?: typeof fetch;
}) {
  const url = `${input.context.apiUrl.replace(/\/$/, "")}/api/vehicle/${encodeURIComponent(input.stockId)}?uuid=${input.context.uuid}`;
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorization =
    input.context.authorizationHeader ??
    (input.context.clientToken ? input.context.clientToken : undefined);
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      ...(authorization ? { authorization } : {}),
    },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function scrapeAllOceanSources(input?: { fetchImpl?: typeof fetch }) {
  const scrapeStartedAt = new Date();
  const sourceResults: SourceListResult[] = [];
  for (const source of OCEAN_SOURCES) {
    sourceResults.push(
      await scrapeSourceList({
        sourceKey: source.key,
        startUrl: source.startUrl,
        fetchImpl: input?.fetchImpl,
      }),
    );
  }
  const frozen = freezeListSnapshot(sourceResults);
  const scrapeFinishedAt = new Date();
  return { scrapeStartedAt, scrapeFinishedAt, sourceResults: frozen };
}

export async function enrichFrozenDetails(
  sourceResults: SourceListResult[],
  fetchDetail: (sourceKey: OceanSourceKey, vehicle: NormalizedVehicle) => Promise<NormalizedVehicle | null>,
) {
  let detailMissing = 0;
  const enriched: SourceListResult[] = [];
  for (const result of sourceResults) {
    if (result.status !== "ok") {
      enriched.push(result);
      continue;
    }
    const details = new Map<string, NormalizedVehicle>();
    for (const vehicle of result.vehicles) {
      const detail = await fetchDetail(result.sourceKey, vehicle);
      if (detail) details.set(vehicleIdentityToken(vehicle), detail);
    }
    const applied = applyDetailEnrichment(result.vehicles, details);
    detailMissing += applied.detailMissing;
    enriched.push({ ...result, vehicles: applied.vehicles, rawCount: result.rawCount });
  }
  return { sourceResults: enriched, detailMissing };
}
