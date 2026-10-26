import { isIP } from "node:net";
import type { ConnectorKey } from "@/scripts/dealer-stock-sync/types";

/**
 * Exact photo hosts taken from dealer-stock-sync extractors and image URL
 * normalisers. Shared S3 is limited to the ndstock prefixes in image-urls.ts.
 * Franklin and Swift hosts are the ones those galleries actually read.
 * *.cd5.uk is not allowlisted.
 */
const CLICK_DEALER_CDN = { host: "images.clickdealer.co.uk" } as const;
const NETDIRECTOR_IMAGE_CDN = { host: "images.netdirector.auto" } as const;
const NETDIRECTOR_S3 = {
  host: "s3-eu-west-1.amazonaws.com",
  pathPrefixes: ["/autofs/ndstock/", "/nd-stock-ireland-production/ndstock/"],
} as const;
const DRAGON_CDN = { host: "img.cdn.dragon2000.net" } as const;

const CONNECTOR_PHOTO_CDNS: Partial<Record<ConnectorKey, readonly DesktopUrlRule[]>> = {
  "click-dealer": [CLICK_DEALER_CDN],
  netdirector: [NETDIRECTOR_IMAGE_CDN, NETDIRECTOR_S3],
  dragon2000: [DRAGON_CDN],
};

const DEALER_PHOTO_CDNS: Readonly<Record<string, readonly DesktopUrlRule[]>> = {
  "ingear-car-sales": [{ host: "api.dealerwebsites.co.uk", pathPrefixes: ["/images/"] }],
  "manx-car-warehouse": [{ host: "smgmedia.blob.core.windows.net", pathPrefixes: ["/images/130519/"] }],
  franklins: [{ host: "img-uk3.cd5.uk" }, { host: "assets.cd5.uk" }],
  "swift-motors": [{ host: "bluesky.cdn.imgeng.in", pathPrefixes: ["/cogstock-images/"] }],
};

export interface DesktopUrlRule {
  host: string;
  pathPrefixes?: readonly string[];
}

export class DesktopSourcePolicyError extends Error {
  constructor(message = "URL is not an allowed public HTTPS URL.") {
    super(message);
    this.name = "DesktopSourcePolicyError";
  }
}

function configuredHost(startUrl: string | null): string | null {
  if (!startUrl) return null;
  try {
    return new URL(startUrl).hostname.toLowerCase();
  } catch {
    throw new DesktopSourcePolicyError("Configured source URL is invalid.");
  }
}

function sourceHostRule(startUrl: string | null): DesktopUrlRule[] {
  const host = configuredHost(startUrl);
  return host ? [{ host }] : [];
}

export function desktopDetailUrlRules(sourceStartUrl: string | null): DesktopUrlRule[] {
  return sourceHostRule(sourceStartUrl);
}

export function desktopImageUrlRules(
  dealerKey: string,
  connectorKey: ConnectorKey,
  sourceStartUrl: string | null,
): DesktopUrlRule[] {
  return [
    ...sourceHostRule(sourceStartUrl),
    ...(CONNECTOR_PHOTO_CDNS[connectorKey] ?? []),
    ...(DEALER_PHOTO_CDNS[dealerKey] ?? []),
  ];
}

function privateHostname(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".localdomain") ||
    /^\d+$/.test(host)
  );
}

function matchesRule(hostname: string, pathname: string, rule: DesktopUrlRule): boolean {
  if (hostname !== rule.host) return false;
  if (!rule.pathPrefixes?.length) return true;
  return rule.pathPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function assertDesktopSourceUrl(raw: string, rules: readonly DesktopUrlRule[]): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048 || raw !== raw.trim()) {
    throw new DesktopSourcePolicyError();
  }
  if (raw.startsWith("//") || /^[a-zA-Z]:[\\/]/.test(raw) || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) {
    throw new DesktopSourcePolicyError();
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new DesktopSourcePolicyError();
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowed =
    parsed.protocol === "https:" &&
    parsed.username.length === 0 &&
    parsed.password.length === 0 &&
    (parsed.port === "" || parsed.port === "443") &&
    host.length > 0 &&
    isIP(host) === 0 &&
    !privateHostname(host) &&
    rules.some((rule) => matchesRule(host, parsed.pathname, rule));
  if (!allowed) throw new DesktopSourcePolicyError();
  return parsed.href;
}
