import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getRippleClientId, isRipplePreviewRuntime, isRippleStagingLinkCode } from "@/lib/payments/ripple-config";
import { RIPPLE_EVENT_TYPES, type RippleMinimizedPayload } from "@/lib/payments/ripple-contract";

export const RIPPLE_STAGING_RECEIVER = "https://preview.itrader.im/api/webhooks/ripple-staging";
export const RIPPLE_STAGING_MAX_BODY_BYTES = 16_384;
const nullableText = z.string().max(2048).nullable();
const relaySchema = z.object({
  version: z.literal(1),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  customerEmailNorm: z.string().email().max(320).nullable(),
  minimized: z.object({
    event: z.enum(RIPPLE_EVENT_TYPES),
    client_id: z.string().min(1).max(100),
    timestamp: z.string().datetime(),
    amount: z.number().finite().nonnegative().nullable(),
    currency: z.literal("gbp"),
    payment_reference: nullableText,
    merchant_reference: nullableText,
    link_code: z.string().min(1).max(100),
    link_type: nullableText,
    recurring: z.boolean().nullable(),
    package: nullableText,
    description: nullableText,
    reason: nullableText,
  }).strict(),
}).strict();

type RelayInput = { bodyHash: string; minimized: RippleMinimizedPayload; customerEmailNorm: string | null };

function signature(body: string, timestamp: string) {
  const secret = process.env.RIPPLE_STAGING_RELAY_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("STAGING_RELAY_CONFIGURATION");
  return createHmac("sha256", secret)
    .update(`itrader:ripple-staging:v1:${timestamp}:${body}`).digest("hex");
}

export function shouldRelayRippleToStaging(linkCode: string | null | undefined) {
  return !isRipplePreviewRuntime() && isRippleStagingLinkCode(linkCode);
}

export function createRippleStagingRelayRequest(input: RelayInput, now = Date.now()) {
  const body = JSON.stringify(relaySchema.parse({ version: 1, ...input }));
  const timestamp = String(Math.floor(now / 1000));
  return { body, headers: {
    "content-type": "application/json",
    "x-itrader-relay-timestamp": timestamp,
    "x-itrader-relay-signature": signature(body, timestamp),
  } };
}

export function verifyRippleStagingRelay(body: string, headers: Headers, now = Date.now()) {
  if (!isRipplePreviewRuntime()) throw new Error("STAGING_RELAY_DISABLED");
  if (Buffer.byteLength(body) > RIPPLE_STAGING_MAX_BODY_BYTES) throw new Error("STAGING_RELAY_INVALID");
  const timestamp = headers.get("x-itrader-relay-timestamp") ?? "";
  const supplied = headers.get("x-itrader-relay-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(supplied)) throw new Error("STAGING_RELAY_INVALID");
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) throw new Error("STAGING_RELAY_EXPIRED");
  if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(signature(body, timestamp), "hex"))) throw new Error("STAGING_RELAY_INVALID");
  const envelope = relaySchema.parse(JSON.parse(body));
  if (envelope.minimized.client_id !== getRippleClientId() || !isRippleStagingLinkCode(envelope.minimized.link_code)) throw new Error("STAGING_RELAY_INVALID_PRODUCT");
  if (envelope.customerEmailNorm !== null && envelope.customerEmailNorm !== envelope.customerEmailNorm.trim().toLowerCase()) throw new Error("STAGING_RELAY_INVALID_EMAIL");
  return envelope;
}

export async function forwardRippleWebhookToStaging(input: RelayInput) {
  const request = createRippleStagingRelayRequest(input);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  const response = await fetch(RIPPLE_STAGING_RECEIVER, {
    method: "POST", body: request.body,
    headers: { ...request.headers, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("STAGING_RELAY_DELIVERY");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("bodyHash" in result) || result.bodyHash !== input.bodyHash || !("received" in result) || result.received !== true) throw new Error("STAGING_RELAY_ACKNOWLEDGEMENT");
}
