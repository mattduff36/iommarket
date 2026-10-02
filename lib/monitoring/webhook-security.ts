import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export interface WebhookLookup {
  lookup(hostname: string): Promise<string[]>;
}

export function isBlockedMonitoringAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [first = -1, second = -1] = address.split(".").map(Number);
    if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("fe80")) return true;
    if (normalized.startsWith("::ffff:")) {
      return isBlockedMonitoringAddress(normalized.slice("::ffff:".length));
    }
    return false;
  }
  return true;
}

export async function validateMonitoringWebhookUrl(
  raw: string,
  lookup: WebhookLookup,
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Webhook URL is invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Webhook URL must use HTTPS" };
  if (url.username || url.password) return { ok: false, error: "Webhook URL cannot include credentials" };
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { ok: false, error: "Webhook host is not allowed" };
  }
  if (isIP(hostname) && isBlockedMonitoringAddress(hostname)) {
    return { ok: false, error: "Webhook address is not public" };
  }
  if (!isIP(hostname)) {
    let addresses: string[];
    try {
      addresses = await lookup.lookup(hostname);
    } catch {
      return { ok: false, error: "Webhook host could not be resolved" };
    }
    if (addresses.length === 0 || addresses.some((address) => isBlockedMonitoringAddress(address))) {
      return { ok: false, error: "Webhook host does not resolve to a public address" };
    }
  }
  return { ok: true, url };
}

export function signMonitoringWebhook(secret: string, timestamp: number, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

export function verifyMonitoringWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const expected = signMonitoringWebhook(secret, timestamp, body);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
