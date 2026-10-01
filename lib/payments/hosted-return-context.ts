import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getRippleReferenceSecrets } from "@/lib/payments/ripple-config";

export const HOSTED_RETURN_COOKIE = "itrader-listing-checkout";
export const HOSTED_RETURN_MAX_AGE_SECONDS = 30 * 60;
const commonFields = {
  userId: z.string().min(1).max(100),
  email: z.string().email().max(254),
  merchantReference: z.string().min(1).max(500),
  issuedAt: z.number().int().positive(),
};
const listingFields = {
  paymentId: z.string().min(1).max(100),
  listingId: z.string().min(1).max(100),
};
const productCode = z.string().regex(/^[A-F0-9]{16,64}$/);
const contextSchema = z.union([
  z.object({ ...commonFields, ...listingFields, kind: z.literal("listing_payment").optional() }).strict(),
  z.object({ ...commonFields, ...listingFields, kind: z.literal("featured_upgrade"), productCode }).strict(),
  z.object({ ...commonFields, ...listingFields, kind: z.literal("listing_and_featured"), productCode }).strict(),
  z.object({ ...commonFields, kind: z.literal("dealer_subscription"), dealerId: z.string().min(1).max(100), productCode }).strict(),
]);
export type HostedReturnContext = z.infer<typeof contextSchema>;

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`itrader:hosted-return:v1:${payload}`).digest("hex");
}

export function encodeHostedReturnContext(input: z.infer<typeof contextSchema>) {
  const context = contextSchema.parse(input);
  const payload = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${payload}.${sign(payload, getRippleReferenceSecrets().current)}`;
}

export function decodeHostedReturnContext(value: string | undefined, now = Date.now()) {
  if (!value || value.length > 2500) return null;
  const [payload, mac, extra] = value.split(".");
  if (!payload || !mac || extra !== undefined || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const secrets = getRippleReferenceSecrets();
  const valid = [secrets.current, secrets.previous].some((secret) =>
    secret && timingSafeEqual(Buffer.from(mac), Buffer.from(sign(payload, secret))),
  );
  if (!valid) return null;
  try {
    const parsed = contextSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!parsed.success || parsed.data.issuedAt > now ||
      now - parsed.data.issuedAt > HOSTED_RETURN_MAX_AGE_SECONDS * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
