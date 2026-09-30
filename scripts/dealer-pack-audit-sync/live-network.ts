import type { AddressLookup } from "../../lib/images/safe-remote-image";
import { resolvePublicImageAddresses } from "../../lib/images/safe-remote-image";
import {
  inspectLiveNavigation,
  isBlockedLiveHostname,
  type LiveNavigationInspection,
} from "./live-observe";

export const MAX_LIVE_DOCUMENT_REDIRECTS = 10;

export interface LiveBrowserRequestInfo {
  url: string;
  resourceType?: string;
  isNavigationRequest?: boolean;
  redirectedFromUrl?: string | null;
  allowedHosts?: readonly string[] | null;
}

export type LiveRequestGuardDecision =
  | { action: "continue"; error: null }
  | { action: "abort"; error: string };

export type LiveRequestGuard = (
  input: LiveBrowserRequestInfo,
) => LiveRequestGuardDecision;

export type LiveHostResolver = (url: string) => Promise<LiveNavigationInspection>;

export interface LiveRouteRequestLike {
  url(): string;
  resourceType(): string;
  isNavigationRequest(): boolean;
  redirectedFrom(): { url(): string } | null;
}

export interface LiveFetchOptions {
  url?: string;
  maxRedirects?: number;
}

export interface LiveFetchedResponseLike {
  status(): number;
  headers(): Record<string, string>;
  headerValue?(name: string): string | null;
}

export interface LiveRouteFulfillOptions {
  response?: LiveFetchedResponseLike;
}

export interface LiveRouteLike {
  request(): LiveRouteRequestLike;
  abort(errorCode?: string): Promise<void> | void;
  continue(): Promise<void> | void;
}

interface LiveFetchableRoute extends LiveRouteLike {
  fetch(options?: LiveFetchOptions): Promise<LiveFetchedResponseLike>;
  fulfill(options: LiveRouteFulfillOptions): Promise<void> | void;
}

function asFetchableRoute(route: LiveRouteLike): LiveFetchableRoute | null {
  const candidate = route as LiveFetchableRoute;
  if (typeof candidate.fetch !== "function" || typeof candidate.fulfill !== "function") {
    return null;
  }
  return candidate;
}

export interface LiveRoutePageLike {
  route(
    url: string,
    handler: (route: LiveRouteLike) => unknown,
  ): Promise<unknown> | unknown;
}

export interface LiveRouteHandlerOptions {
  getAllowedHosts: () => readonly string[] | null | undefined;
  guard?: LiveRequestGuard;
  lookupImpl?: AddressLookup;
  resolveHost?: LiveHostResolver;
  onDocumentFinalUrl?: (requestedUrl: string, finalUrl: string) => void;
}

export function isGuardedLiveDocumentRequest(input: LiveBrowserRequestInfo) {
  if (input.isNavigationRequest === true) return true;
  if (input.resourceType === "document") return true;
  return input.resourceType == null && input.isNavigationRequest == null;
}

export function decideLiveBrowserRequest(
  input: LiveBrowserRequestInfo,
): LiveRequestGuardDecision {
  const enforceAllowedHosts = isGuardedLiveDocumentRequest(input);
  const inspected = inspectLiveNavigation(
    input.url,
    enforceAllowedHosts ? input.allowedHosts : null,
  );
  if (!inspected.ok) return { action: "abort", error: inspected.error };
  return { action: "continue", error: null };
}

export function isLiveRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function resolveLiveRedirectUrl(
  currentUrl: string,
  location: string | null | undefined,
) {
  if (!location?.trim()) return null;
  try {
    return new URL(location.trim(), currentUrl).href;
  } catch {
    return null;
  }
}

export function readLiveRedirectLocation(response: LiveFetchedResponseLike) {
  const headerValue = response.headerValue?.("location");
  if (headerValue) return headerValue;
  const headers = response.headers();
  return headers.location ?? headers.Location ?? null;
}

export async function assertLiveResolvedHost(
  url: string,
  lookupImpl?: AddressLookup,
): Promise<LiveNavigationInspection> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid-url", blocked: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "unsupported-protocol", blocked: true };
  }
  if (isBlockedLiveHostname(parsed.hostname)) {
    return { ok: false, error: "private-or-local-host", blocked: true };
  }
  try {
    await resolvePublicImageAddresses(parsed.hostname, lookupImpl);
    return { ok: true, error: null, blocked: false };
  } catch {
    return { ok: false, error: "private-or-local-host", blocked: true };
  }
}

function requestInfoFromRoute(
  request: LiveRouteRequestLike,
  allowedHosts: readonly string[] | null | undefined,
): LiveBrowserRequestInfo {
  return {
    url: request.url(),
    resourceType: request.resourceType(),
    isNavigationRequest: request.isNavigationRequest(),
    redirectedFromUrl: request.redirectedFrom()?.url() ?? null,
    allowedHosts,
  };
}

function redirectRequestInfo(
  url: string,
  fromUrl: string,
  original: LiveBrowserRequestInfo,
): LiveBrowserRequestInfo {
  return {
    url,
    resourceType: original.resourceType,
    isNavigationRequest: original.isNavigationRequest,
    redirectedFromUrl: fromUrl,
    allowedHosts: original.allowedHosts,
  };
}

async function preflightLiveRoute(
  route: LiveRouteLike,
  options: {
    guard: LiveRequestGuard;
    resolveHost: LiveHostResolver;
    original: LiveBrowserRequestInfo;
    onDocumentFinalUrl?: (requestedUrl: string, finalUrl: string) => void;
  },
) {
  const fetchable = asFetchableRoute(route);
  if (!fetchable) return route.abort("failed");
  const requestedUrl = route.request().url();
  let currentUrl = requestedUrl;
  for (let hop = 0; hop < MAX_LIVE_DOCUMENT_REDIRECTS; hop += 1) {
    let response: LiveFetchedResponseLike;
    try {
      response = await fetchable.fetch({
        ...(hop === 0 ? {} : { url: currentUrl }),
        maxRedirects: 0,
      });
    } catch {
      return route.abort("failed");
    }
    if (!isLiveRedirectStatus(response.status())) {
      if (
        isGuardedLiveDocumentRequest(options.original) &&
        currentUrl !== requestedUrl
      ) {
        options.onDocumentFinalUrl?.(requestedUrl, currentUrl);
      }
      return fetchable.fulfill({ response });
    }
    const nextUrl = resolveLiveRedirectUrl(
      currentUrl,
      readLiveRedirectLocation(response),
    );
    if (!nextUrl) return route.abort("blockedbyclient");
    const decision = options.guard(
      redirectRequestInfo(nextUrl, currentUrl, options.original),
    );
    if (decision.action === "abort") return route.abort("blockedbyclient");
    const resolved = await options.resolveHost(nextUrl);
    if (!resolved.ok) return route.abort("blockedbyclient");
    currentUrl = nextUrl;
  }
  return route.abort("blockedbyclient");
}

export function createLiveRouteHandler(options: LiveRouteHandlerOptions) {
  const guard = options.guard ?? decideLiveBrowserRequest;
  const resolveHost =
    options.resolveHost ??
    ((url: string) => assertLiveResolvedHost(url, options.lookupImpl));
  return async (route: LiveRouteLike) => {
    const request = route.request();
    const info = requestInfoFromRoute(request, options.getAllowedHosts());
    const decision = guard(info);
    if (decision.action === "abort") return route.abort("blockedbyclient");
    const resolved = await resolveHost(info.url);
    if (!resolved.ok) return route.abort("blockedbyclient");
    return preflightLiveRoute(route, {
      guard,
      resolveHost,
      original: info,
      onDocumentFinalUrl: options.onDocumentFinalUrl,
    });
  };
}

export async function installLiveBrowserNetworkGuard(
  page: LiveRoutePageLike,
  options: LiveRouteHandlerOptions,
) {
  await page.route("**/*", createLiveRouteHandler(options));
}
