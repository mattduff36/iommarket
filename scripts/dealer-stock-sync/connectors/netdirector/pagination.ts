import {
  extractHasMoreResults,
  extractSearchVehicles,
  extractTotalPages,
} from "./normalize";

export interface CapturedSearchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface NetDirectorSearchContext {
  kind?: "vue" | "classic";
  apiUrl: string;
  uuid: string;
  clientToken?: string;
  authorizationHeader?: string;
}

const HEADER_ALLOWLIST = [
  "authorization",
  "accept",
  "content-type",
  "origin",
  "referer",
  "user-agent",
] as const;

export function isClassicListRequest(url: string) {
  return url.includes("stock-listing/get-items");
}

export function isVueListRequest(url: string, body: string | null) {
  return url.includes("vehicle-search") && Boolean(body?.includes("getAll"));
}

export function withPageQuery(url: string, page: number) {
  const next = new URL(url);
  next.searchParams.set("page", String(page));
  return next.toString();
}

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

export function sanitizeHeaders(headers?: Record<string, string>) {
  if (!headers) return {};
  const sanitized: Record<string, string> = {};
  for (const key of HEADER_ALLOWLIST) {
    const value = headers[key] ?? headers[key.toUpperCase()];
    if (value) sanitized[key] = value;
  }
  return sanitized;
}

export function detectNetDirector(input: {
  url?: string | null;
  html?: string;
  requestUrls?: string[];
  requestBodies?: Array<string | null>;
}) {
  const haystack = [
    input.url ?? "",
    input.html ?? "",
    ...(input.requestUrls ?? []),
    ...(input.requestBodies ?? []),
  ]
    .join("\n")
    .toLowerCase();
  if (haystack.includes("netdirector")) return true;
  if ((input.requestUrls ?? []).some((url) => isClassicListRequest(url) || url.includes("vehicle-search"))) {
    return true;
  }
  if ((input.requestBodies ?? []).some((body) => Boolean(body?.includes("getAll")))) return true;
  return false;
}

export async function fetchSearchPage(input: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  fetchImpl?: typeof fetch;
}) {
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
