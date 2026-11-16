import { isMonitoringIngestPath } from "./redact";

export interface RequestDiagnostic {
  at: number;
  target: string;
  method: string;
  status: number | null;
  durationMs: number;
  outcome: "ok" | "http-error" | "network-error" | "cancelled";
  requestId?: string;
  errorCategory?: typeof EXCEPTION_CATEGORIES[number];
  signalAborted?: boolean;
  requestKind?: typeof REQUEST_KINDS[number];
  responseType?: typeof RESPONSE_TYPES[number];
  responseContentType?: typeof RESPONSE_CONTENT_TYPES[number];
  redirected?: boolean;
  responseTarget?: string;
}

const MAX_REQUESTS = 10;
// A page can cancel many prefetched reads at once; this transient queue is
// separate from the small breadcrumb history exported with each fault.
const MAX_PENDING_NAVIGATION_FAILURES = 64;
const MAX_AGE_MS = 5 * 60_000;
let recent: RequestDiagnostic[] = [];
const STATIC_SEGMENTS = new Set("api admin account listings listing search sell private dealer dealers profile logo photos images upload media listing-photo costs users stock-reviews preview me auth token sign-in sign-up payments webhooks monitoring events report-issue _next static chunks".split(" "));
// These established endpoints must stay distinguishable without exposing query values.
const EXACT_STATIC_PATHS = new Set(["/api/account-updates", "/api/media/cloudinary-ref"]);
const REQUEST_KINDS = ["fetch", "rsc", "prefetch"] as const;
const RESPONSE_TYPES = ["basic", "cors", "default", "error", "opaque", "opaqueredirect"] as const;
const RESPONSE_CONTENT_TYPES = ["html", "rsc", "json", "other"] as const;
const PROVIDER_TARGETS = ["provider:external", "provider:supabase", "provider:imagekit"];
const EXCEPTION_CATEGORIES = ["Error", "TypeError", "AbortError", "TimeoutError", "NetworkError", "SecurityError", "other"] as const;

/** Only route shapes/provider categories leave the browser; no queries, IDs or bodies. */
export function diagnosticTarget(input: string, origin: string): string | null {
  if (PROVIDER_TARGETS.includes(input)) return input;
  try {
    const url = new URL(input, origin);
    if (url.origin === origin) {
      if (isMonitoringIngestPath(url.pathname)) return null;
      if (EXACT_STATIC_PATHS.has(url.pathname)) return url.pathname;
      return "/" + url.pathname.split("/").filter(Boolean).slice(0, 8)
        .map(segment => STATIC_SEGMENTS.has(segment) ? segment : ":segment").join("/");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.hostname.endsWith(".supabase.co")) return "provider:supabase";
    if (url.hostname === "ik.imagekit.io") return "provider:imagekit";
    return "provider:external";
  } catch { return null; }
}

export function requestDiagnostics(now = Date.now()): RequestDiagnostic[] {
  return recent.filter(item => now - item.at >= 0 && now - item.at <= MAX_AGE_MS).map(item => ({ ...item }));
}

export function safeRequestDiagnostics(value: unknown): RequestDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_REQUESTS).flatMap(item => {
    const request = safeRequestDiagnostic(item);
    return request ? [request] : [];
  });
}

function isSafeTarget(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180 && (
    PROVIDER_TARGETS.includes(value) || EXACT_STATIC_PATHS.has(value)
    || value.startsWith("/") && value.split("/").every(segment => !segment || segment === ":segment" || STATIC_SEGMENTS.has(segment))
  );
}

export function safeRequestDiagnostic(value: unknown): RequestDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!isSafeTarget(row.target)
    || typeof row.method !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OTHER"].includes(row.method)
    || !(row.outcome === "ok" || row.outcome === "http-error" || row.outcome === "network-error" || row.outcome === "cancelled")
    || typeof row.at !== "number" || !Number.isSafeInteger(row.at) || row.at < 0
    || typeof row.durationMs !== "number" || !Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 300_000
    || !(row.status === null || typeof row.status === "number" && Number.isInteger(row.status) && row.status >= 0 && row.status <= 599)) return undefined;
  const errorCategory = EXCEPTION_CATEGORIES.find(category => category === row.errorCategory);
  const requestKind = REQUEST_KINDS.find(kind => kind === row.requestKind);
  const responseType = RESPONSE_TYPES.find(type => type === row.responseType);
  const responseContentType = RESPONSE_CONTENT_TYPES.find(type => type === row.responseContentType);
  return { at: row.at, target: row.target, method: row.method, status: row.status,
    durationMs: row.durationMs, outcome: row.outcome,
    ...(typeof row.requestId === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(row.requestId) ? { requestId: row.requestId } : {}),
    ...(errorCategory ? { errorCategory } : {}),
    ...(typeof row.signalAborted === "boolean" ? { signalAborted: row.signalAborted } : {}),
    ...(requestKind ? { requestKind } : {}),
    ...(responseType ? { responseType } : {}),
    ...(responseContentType ? { responseContentType } : {}),
    ...(typeof row.redirected === "boolean" ? { redirected: row.redirected } : {}),
    ...(isSafeTarget(row.responseTarget) ? { responseTarget: row.responseTarget } : {}),
  };
}

function exceptionCategory(error: unknown): NonNullable<RequestDiagnostic["errorCategory"]> {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  return EXCEPTION_CATEGORIES.find(category => category === name) ?? "other";
}

function diagnosticHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return Headers.prototype.get.call(headers, name);
  if (Object.getPrototypeOf(headers) === Object.prototype || Object.getPrototypeOf(headers) === null) {
    const key = Object.keys(headers).find(key => key.toLowerCase() === name);
    const field = key ? Object.getOwnPropertyDescriptor(headers, key) : undefined;
    return field && "value" in field && typeof field.value === "string" ? field.value : null;
  }
  // Do not consume custom/one-shot iterables or execute header getters.
  return null;
}

function requestKind(input: RequestInfo | URL, init?: RequestInit): RequestDiagnostic["requestKind"] {
  try {
    const descriptor = init ? Object.getOwnPropertyDescriptor(init, "headers") : undefined;
    // Reading a valid accessor here would change the headers later read by native fetch.
    if (descriptor && !("value" in descriptor)) return undefined;
    if (init && !descriptor && Object.getPrototypeOf(init) !== Object.prototype
      && Object.getPrototypeOf(init) !== null) return undefined;
    let headers: HeadersInit | undefined = descriptor?.value;
    if (headers === undefined && typeof Request !== "undefined" && input instanceof Request) {
      const getter = Object.getOwnPropertyDescriptor(Request.prototype, "headers")?.get;
      headers = getter?.call(input);
    }
    // Array pairs may contain accessors; leave their evaluation entirely to native fetch.
    if (Array.isArray(headers)) return undefined;
    if (headers && !(headers instanceof Headers)
      && Object.getPrototypeOf(headers) !== Object.prototype && Object.getPrototypeOf(headers) !== null) return undefined;
    if (diagnosticHeader(headers, "next-router-prefetch") === "1" || diagnosticHeader(headers, "purpose") === "prefetch"
      || diagnosticHeader(headers, "sec-purpose")?.split(";")[0]?.trim() === "prefetch") return "prefetch";
    return diagnosticHeader(headers, "rsc") === "1" ? "rsc" : "fetch";
  } catch { return undefined; }
}

function responseProvenance(response: Response, origin: string): Partial<RequestDiagnostic> {
  try {
    const responseType = RESPONSE_TYPES.find(type => type === response.type);
    const responseTarget = response.url ? diagnosticTarget(response.url, origin) : null;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const responseContentType = contentType === "text/html" ? "html" : contentType === "text/x-component" ? "rsc"
      : contentType === "application/json" ? "json" : contentType ? "other" : undefined;
    return {
      ...(responseType ? { responseType } : {}),
      ...(responseTarget ? { responseTarget } : {}),
      ...(responseContentType ? { responseContentType } : {}),
      ...(typeof response.redirected === "boolean" ? { redirected: response.redirected } : {}),
    };
  } catch { return {}; }
}

/** Unknown/custom dictionary access stays reportable without invoking a getter twice. */
function requestKeepalive(input: RequestInfo | URL, init?: RequestInit): boolean | undefined {
  try {
    const descriptor = init ? Object.getOwnPropertyDescriptor(init, "keepalive") : undefined;
    if (descriptor && !("value" in descriptor)) return undefined;
    if (init && !descriptor && Object.getPrototypeOf(init) !== Object.prototype
      && Object.getPrototypeOf(init) !== null) return undefined;
    if (descriptor?.value !== undefined) return Boolean(descriptor.value);
    if (typeof input === "string" || input instanceof URL) return false;
    if (typeof Request !== "undefined") {
      // Native brand checking also handles Requests from another window.
      return Object.getOwnPropertyDescriptor(Request.prototype, "keepalive")?.get?.call(input);
    }
    return undefined;
  } catch { return undefined; }
}

export function installRequestDiagnostics(
  target: Pick<Window, "fetch"> & Partial<Pick<EventTarget, "addEventListener" | "removeEventListener">>,
  origin: string,
  onFailure: (item: RequestDiagnostic) => void,
): () => void {
  const original = target.fetch;
  let leavingPage = false;
  let navigationDeadline = 0;
  let navigationTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: RequestDiagnostic[] = [];
  recent = [];
  const record = (item: RequestDiagnostic) => {
    recent = [...requestDiagnostics(), item].sort((a, b) => a.at - b.at).slice(-MAX_REQUESTS);
    if (item.outcome === "network-error" || (item.status !== null && item.status >= 500)) {
      try { onFailure({ ...item }); } catch { /* Diagnostics must not change the request result. */ }
    }
  };
  const flushNavigation = (cancelled = false) => {
    if (navigationTimer !== undefined) clearTimeout(navigationTimer);
    navigationTimer = undefined;
    navigationDeadline = 0;
    const items = pending;
    pending = [];
    for (const item of items) record(cancelled ? { ...item, outcome: "cancelled" } : item);
  };
  const beforeunload = () => {
    flushNavigation();
    navigationDeadline = Date.now() + 1_000;
    navigationTimer = setTimeout(() => flushNavigation(), 1_000);
  };
  const pagehide = (event: Event) => {
    leavingPage = "persisted" in event && event.persisted === false;
    flushNavigation(leavingPage && Date.now() < navigationDeadline);
  };
  const pageshow = () => { leavingPage = false; flushNavigation(); };
  target.addEventListener?.("beforeunload", beforeunload);
  target.addEventListener?.("pagehide", pagehide);
  target.addEventListener?.("pageshow", pageshow);
  const wrapped: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = diagnosticTarget(url, origin);
    const methodValue = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(methodValue) ? methodValue : "OTHER";
    const initSignal = init?.signal;
    // An explicit null removes a Request's signal; undefined inherits it.
    const signal = initSignal !== undefined ? initSignal : typeof input === "object" && "signal" in input ? input.signal : undefined;
    const kind = requestKind(input, init);
    const started = Date.now();
    const startedOnActivePage = !leavingPage;
    const keepalive = requestKeepalive(input, init);
    try {
      const response = await original.call(target, input, init);
      if (route) {
        const correlation = response.headers.get("x-request-id") ?? response.headers.get("x-vercel-id");
        record({ at: Date.now(), target: route, method, status: response.status,
          requestKind: kind, ...responseProvenance(response, origin),
          durationMs: Math.max(0, Math.min(300_000, Date.now() - started)), outcome: response.ok ? "ok" : "http-error",
          ...(correlation && /^[A-Za-z0-9:_-]{8,160}$/.test(correlation) ? { requestId: correlation } : {}),
        });
      }
      return response;
    } catch (error) {
      const errorCategory = exceptionCategory(error);
      // WebKit can reject before pagehide. Briefly await teardown confirmation,
      // without delaying the caller's rejection or treating beforeunload as proof.
      const eligibleRead = startedOnActivePage && keepalive === false
        && (method === "GET" || method === "HEAD") && errorCategory === "TypeError";
      const cancelledByPagehide = leavingPage && eligibleRead;
      if (route) {
        const item: RequestDiagnostic = { at: Date.now(), target: route, method, status: null, requestKind: kind,
        durationMs: Math.max(0, Math.min(300_000, Date.now() - started)),
        outcome: errorCategory === "AbortError" || cancelledByPagehide ? "cancelled" : "network-error",
        errorCategory, signalAborted: signal?.aborted === true };
        if (eligibleRead && !leavingPage && Date.now() < navigationDeadline && pending.length < MAX_PENDING_NAVIGATION_FAILURES) {
          pending.push(item);
        } else record(item);
      }
      throw error;
    }
  };
  target.fetch = wrapped;
  return () => {
    target.removeEventListener?.("beforeunload", beforeunload);
    target.removeEventListener?.("pagehide", pagehide);
    target.removeEventListener?.("pageshow", pageshow);
    flushNavigation();
    if (target.fetch === wrapped) target.fetch = original;
    recent = [];
  };
}
