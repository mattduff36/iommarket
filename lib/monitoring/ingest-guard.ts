import { createHash } from "node:crypto";
import type { MonitoringSeverity } from "./types";

const HIGH_CARDINALITY = /(?:[a-f0-9]{16,}|\d{8,})/gi;

export function isHighCardinalityClientMessage(message: string): boolean {
  return (message.match(HIGH_CARDINALITY) ?? []).length >= 4;
}

export function shouldSampleClientEvent(message: string, severity: MonitoringSeverity): boolean {
  if (severity !== "LOW") return true;
  return createHash("sha256").update(message).digest()[0]! % 10 === 0;
}

export function isAllowedMonitoringOrigin(
  origin: string | null,
  allowedHosts: string[],
): boolean {
  if (!origin || origin === "null") return true;
  try {
    return allowedHosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}

export function monitoringOriginHosts(hostHeader: string | null, appUrl: string | undefined): string[] {
  const hosts = new Set<string>();
  if (hostHeader) hosts.add(hostHeader.split(",")[0]?.trim() ?? "");
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).host);
    } catch {
      // Ignore a malformed configured app URL and rely on the request host.
    }
  }
  hosts.delete("");
  return [...hosts];
}

export function assessClientIngest(input: {
  origin: string | null;
  host: string | null;
  appUrl?: string;
  contentType: string | null;
  message: string;
  route?: string;
  severity: MonitoringSeverity;
}): { ok: true; sampled: boolean } | { ok: false; status: number; error: string } {
  if (!input.contentType?.toLowerCase().includes("application/json")) {
    return { ok: false, status: 415, error: "JSON body required" };
  }
  if (!isAllowedMonitoringOrigin(input.origin, monitoringOriginHosts(input.host, input.appUrl))) {
    return { ok: false, status: 403, error: "Origin is not allowed" };
  }
  if (input.route && !input.route.startsWith("/")) {
    return { ok: false, status: 400, error: "Route must be a relative path" };
  }
  if (isHighCardinalityClientMessage(input.message)) {
    return { ok: false, status: 400, error: "Event message is too unique to store" };
  }
  return { ok: true, sampled: shouldSampleClientEvent(input.message, input.severity) };
}
