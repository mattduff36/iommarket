import type { RuntimeEnv } from "@/lib/runtime-env";
import { claimAdvertisingEvent } from "@/lib/advertising/deliver";

const CLAIM_TTL_SECONDS = 60 * 60 * 24 * 14;

export async function claimPurchaseDelivery(
  transactionId: string,
  options: { env?: RuntimeEnv; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(transactionId)) return false;
  const env = options.env ?? process.env;
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return claimAdvertisingEvent(`purchase:${transactionId}`);
  try {
    const endpoint = `${url.replace(/\/$/, "")}/set/${encodeURIComponent(`ad-purchase:${transactionId}`)}/1/NX/EX/${CLAIM_TTL_SECONDS}`;
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = await response.json() as { result?: unknown };
    return body.result === "OK";
  } catch {
    return false;
  }
}
