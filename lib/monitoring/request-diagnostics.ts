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
}

const MAX_REQUESTS = 10;
const MAX_AGE_MS = 5 * 60_000;
let recent: RequestDiagnostic[] = [];
const STATIC_SEGMENTS = new Set("api admin account listings listing search sell private dealer dealers profile logo photos images upload media listing-photo costs users stock-reviews preview me auth token sign-in sign-up payments webhooks monitoring events report-issue _next static chunks".split(" "));
const PROVIDER_TARGETS = ["provider:external", "provider:supabase", "provider:imagekit"];
const EXCEPTION_CATEGORIES = ["Error", "TypeError", "AbortError", "TimeoutError", "NetworkError", "SecurityError", "other"] as const;

/** Only route shapes/provider categories leave the browser; no queries, IDs or bodies. */
export function diagnosticTarget(input: string, origin: string): string | null {
  if (PROVIDER_TARGETS.includes(input)) return input;
  try {
    const url = new URL(input, origin);
    if (url.origin === origin) {
      if (isMonitoringIngestPath(url.pathname)) return null;
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

export function safeRequestDiagnostic(value: unknown): RequestDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.target !== "string" || row.target.length > 180
    || !(PROVIDER_TARGETS.includes(row.target)
      || row.target.startsWith("/") && row.target.split("/").every(segment => !segment || segment === ":segment" || STATIC_SEGMENTS.has(segment)))
    || typeof row.method !== "string" || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OTHER"].includes(row.method)
    || !(row.outcome === "ok" || row.outcome === "http-error" || row.outcome === "network-error" || row.outcome === "cancelled")
    || typeof row.at !== "number" || !Number.isSafeInteger(row.at) || row.at < 0
    || typeof row.durationMs !== "number" || !Number.isFinite(row.durationMs) || row.durationMs < 0 || row.durationMs > 300_000
    || !(row.status === null || typeof row.status === "number" && Number.isInteger(row.status) && row.status >= 0 && row.status <= 599)) return undefined;
  const errorCategory = EXCEPTION_CATEGORIES.find(category => category === row.errorCategory);
  return { at: row.at, target: row.target, method: row.method, status: row.status,
    durationMs: row.durationMs, outcome: row.outcome,
    ...(typeof row.requestId === "string" && /^[A-Za-z0-9:_-]{8,160}$/.test(row.requestId) ? { requestId: row.requestId } : {}),
    ...(errorCategory ? { errorCategory } : {}),
    ...(typeof row.signalAborted === "boolean" ? { signalAborted: row.signalAborted } : {}),
  };
}

function exceptionCategory(error: unknown): NonNullable<RequestDiagnostic["errorCategory"]> {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  return EXCEPTION_CATEGORIES.find(category => category === name) ?? "other";
}

export function installRequestDiagnostics(
  target: Pick<Window, "fetch">,
  origin: string,
  onFailure: (item: RequestDiagnostic) => void,
): () => void {
  const original = target.fetch;
  recent = [];
  const record = (item: RequestDiagnostic) => {
    recent = [...requestDiagnostics(), item].slice(-MAX_REQUESTS);
    if (item.outcome === "network-error" || (item.status !== null && item.status >= 500)) {
      try { onFailure({ ...item }); } catch { /* Diagnostics must not change the request result. */ }
    }
  };
  const wrapped: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = diagnosticTarget(url, origin);
    const methodValue = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(methodValue) ? methodValue : "OTHER";
    const initSignal = init?.signal;
    // An explicit null removes a Request's signal; undefined inherits it.
    const signal = initSignal !== undefined ? initSignal : typeof input === "object" && "signal" in input ? input.signal : undefined;
    const started = Date.now();
    try {
      const response = await original.call(target, input, init);
      if (route) {
        const correlation = response.headers.get("x-request-id") ?? response.headers.get("x-vercel-id");
        record({ at: Date.now(), target: route, method, status: response.status,
          durationMs: Math.max(0, Math.min(300_000, Date.now() - started)), outcome: response.ok ? "ok" : "http-error",
          ...(correlation && /^[A-Za-z0-9:_-]{8,160}$/.test(correlation) ? { requestId: correlation } : {}),
        });
      }
      return response;
    } catch (error) {
      const errorCategory = exceptionCategory(error);
      if (route) record({ at: Date.now(), target: route, method, status: null,
        durationMs: Math.max(0, Math.min(300_000, Date.now() - started)),
        outcome: errorCategory === "AbortError" ? "cancelled" : "network-error",
        errorCategory, signalAborted: signal?.aborted === true });
      throw error;
    }
  };
  target.fetch = wrapped;
  return () => { if (target.fetch === wrapped) target.fetch = original; recent = []; };
}
