import { diagnosticTarget } from "./request-diagnostics";

const ELEMENT_KINDS = ["img", "script", "link", "video", "audio", "source", "other", "window"] as const;
const LINK_RELS = ["stylesheet", "preload", "modulepreload", "prefetch", "icon", "manifest"] as const;
const LINK_AS = ["audio", "document", "embed", "fetch", "font", "image", "object", "script", "style", "track", "video", "worker"] as const;
const MAX_TIMING_AGE_MS = 1_000;
const MAX_DURATION_MS = 300_000;
const MAX_RESOURCE_BYTES = 1_073_741_824;
const MAX_TRACKED_RESOURCES = 100;

export interface ResourceDiagnostic {
  elementKind: typeof ELEMENT_KINDS[number];
  target?: string;
  linkRel?: typeof LINK_RELS[number];
  linkAs?: typeof LINK_AS[number];
  mediaErrorCode?: number;
  responseStatus?: number;
  durationMs?: number;
  transferSize?: number;
  decodedBodySize?: number;
}

interface ResourceBrowser {
  location: { origin: string };
  performance?: { now: () => number; getEntriesByName: (name: string, type?: string) => unknown };
}

function read(value: unknown, key: string): unknown {
  try { return value && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined; }
  catch { return undefined; } // Browser getters may be unavailable; diagnostics must not throw.
}

function boundedNumber(value: unknown, max: number, integer = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    && (!integer || Number.isSafeInteger(value));
}

function resourceKind(target: unknown, browser: ResourceBrowser): ResourceDiagnostic["elementKind"] {
  if (target === browser || target && read(target, "window") === target) return "window";
  const tag = read(target, "tagName");
  return ELEMENT_KINDS.find(kind => kind !== "window" && typeof tag === "string" && kind === tag.toLowerCase()) ?? "other";
}

/** Closed wire/storage/export shape. Never accept raw URLs or arbitrary DOM/error properties. */
export function safeResourceDiagnostic(value: unknown): ResourceDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const elementKind = ELEMENT_KINDS.find(kind => kind === read(value, "elementKind"));
  if (!elementKind) return undefined;
  const result: ResourceDiagnostic = { elementKind };
  const target = read(value, "target");
  if (elementKind !== "window" && elementKind !== "other" && typeof target === "string" && target.length <= 180
    && diagnosticTarget(target, "https://itrader.im") === target) result.target = target;
  if (elementKind === "link") {
    const rel = LINK_RELS.find(item => item === read(value, "linkRel"));
    const as = LINK_AS.find(item => item === read(value, "linkAs"));
    if (rel) result.linkRel = rel;
    if (as) result.linkAs = as;
  }
  const code = read(value, "mediaErrorCode");
  if ((elementKind === "audio" || elementKind === "video") && boundedNumber(code, 4, true) && code >= 1) result.mediaErrorCode = code;
  if (!result.target) return result;
  const status = read(value, "responseStatus");
  // 0 is an opaque/unavailable status, never evidence of an HTTP failure.
  if (status === 0 || boundedNumber(status, 599, true) && status >= 100) result.responseStatus = status;
  const duration = read(value, "durationMs");
  if (boundedNumber(duration, MAX_DURATION_MS)) result.durationMs = duration;
  for (const key of ["transferSize", "decodedBodySize"] as const) {
    const size = read(value, key);
    if (boundedNumber(size, MAX_RESOURCE_BYTES, true)) result[key] = size;
  }
  return result;
}

function selectedSource(target: unknown, kind: ResourceDiagnostic["elementKind"], origin: string): string | undefined {
  if (kind === "other" || kind === "window") return undefined;
  const current = read(target, "currentSrc");
  const fallback = read(target, kind === "link" ? "href" : "src");
  const source = typeof current === "string" && current ? current : fallback;
  if (typeof source !== "string" || !source || source.length > 16_000) return undefined;
  try {
    const url = new URL(source, origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch { return undefined; }
}

function monotonicNow(performance: unknown): number | undefined {
  const now = read(performance, "now");
  try {
    const value: unknown = typeof now === "function" ? now.call(performance) : undefined;
    return boundedNumber(value, Number.MAX_SAFE_INTEGER) ? value : undefined;
  } catch { return undefined; }
}

function matchingTiming(
  performance: unknown, source: string, kind: ResourceDiagnostic["elementKind"], startedAfter: number, eventAt: number,
): Partial<ResourceDiagnostic> {
  const getEntries = read(performance, "getEntriesByName");
  try {
    const entries: unknown = typeof getEntries === "function" ? getEntries.call(performance, source, "resource") : undefined;
    if (!Array.isArray(entries) || entries.length > 100) return {};
    const matches = entries.filter(entry => {
      const start = read(entry, "startTime"), end = read(entry, "responseEnd"), duration = read(entry, "duration");
      return read(entry, "name") === source && read(entry, "entryType") === "resource"
        && read(entry, "initiatorType") === kind && boundedNumber(start, eventAt) && start > startedAfter
        && boundedNumber(end, eventAt) && end > 0 && end >= start && eventAt - end <= MAX_TIMING_AGE_MS
        && boundedNumber(duration, MAX_DURATION_MS);
    });
    // Multiple plausible requests cannot be correlated safely to one element error.
    if (matches.length !== 1) return {};
    const entry = matches[0];
    return {
      responseStatus: read(entry, "responseStatus") as number | undefined,
      durationMs: read(entry, "duration") as number | undefined,
      transferSize: read(entry, "transferSize") as number | undefined,
      decodedBodySize: read(entry, "decodedBodySize") as number | undefined,
    };
  } catch { return {}; }
}

/** Reads existing browser timing only. Load observations prevent reusing an earlier request's entry. */
export function createResourceDiagnostics(browser: ResourceBrowser): (event: Event) => ResourceDiagnostic {
  const performance = read(browser, "performance");
  const installedAt = monotonicNow(performance);
  const origin = read(read(browser, "location"), "origin");
  const completed = new Map<string, number>();
  let blockedUntil = 0;
  return (event) => {
    const target = read(event, "target");
    const elementKind = resourceKind(target, browser);
    const source = selectedSource(target, elementKind, typeof origin === "string" ? origin : "");
    const safeTarget = source && typeof origin === "string" ? diagnosticTarget(source, origin) : undefined;
    const facts = {
      elementKind, target: safeTarget, linkRel: read(target, "rel"), linkAs: read(target, "as"),
      mediaErrorCode: read(read(target, "error"), "code"),
    };
    const eventAt = read(event, "timeStamp"), now = monotonicNow(performance);
    if (!source || !safeTarget || installedAt === undefined || now === undefined
      || !boundedNumber(eventAt, now) || eventAt < installedAt || now - eventAt > MAX_TIMING_AGE_MS) {
      return safeResourceDiagnostic(facts) ?? { elementKind };
    }
    for (const [url, at] of completed) if (eventAt - at > MAX_TIMING_AGE_MS) completed.delete(url);
    const startedAfter = Math.max(installedAt, completed.get(source) ?? installedAt);
    const timing = read(event, "type") !== "load" && eventAt >= blockedUntil
      ? matchingTiming(performance, source, elementKind, startedAfter, eventAt) : {};
    if (!completed.has(source) && completed.size >= MAX_TRACKED_RESOURCES) {
      // Fail closed while busy: evicted recent entries must not become candidates again.
      completed.clear();
      blockedUntil = eventAt + MAX_TIMING_AGE_MS;
    }
    completed.set(source, eventAt);
    return safeResourceDiagnostic({ ...facts, ...timing }) ?? { elementKind };
  };
}
