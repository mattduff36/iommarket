import crypto from "crypto";
import type { DealerTier } from "@prisma/client";
import {
  getRippleClientId,
  getRippleReferenceSecrets,
  type RippleCheckoutType,
} from "@/lib/payments/ripple-config";

export type RippleReferencePurpose =
  | "listing_payment"
  | "featured_upgrade"
  | "dealer_subscription";

export interface RippleReferenceClaims {
  version: "v1";
  purpose: RippleReferencePurpose;
  targetId: string;
  linkCode: string;
  nonce: string;
  tier: DealerTier | null;
}

const PURPOSE_ALIASES: Record<string, RippleReferencePurpose> = {
  listing_payment: "listing_payment",
  featured_upgrade: "featured_upgrade",
  dealer_subscription: "dealer_subscription",
};

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function signedPayload(input: {
  clientId: string;
  purpose: RippleReferencePurpose;
  targetId: string;
  linkCode: string;
  nonce: string;
  tier: DealerTier | null;
}): string {
  return [
    "v1",
    input.clientId,
    input.linkCode.toUpperCase(),
    input.purpose,
    input.targetId,
    input.tier ?? "",
    input.nonce,
  ].join("|");
}

function signWithSecret(secret: string, payload: string): string {
  return hmacHex(secret, payload).slice(0, 32);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createRippleReference(input: {
  purpose: RippleReferencePurpose;
  targetId: string;
  linkCode: string;
  tier?: DealerTier;
  nonce?: string;
}): string {
  const clientId = getRippleClientId();
  const { current } = getRippleReferenceSecrets();
  const nonce = input.nonce ?? crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const tier = input.purpose === "dealer_subscription" ? input.tier ?? "STARTER" : null;
  const payload = signedPayload({
    clientId,
    purpose: input.purpose,
    targetId: input.targetId,
    linkCode: input.linkCode,
    nonce,
    tier,
  });
  const mac = signWithSecret(current, payload);
  return ["v1", input.purpose, input.targetId, nonce, mac].join(":");
}

export function parseRippleReference(
  value: string | null | undefined,
  expectedLinkCode: string | null
): RippleReferenceClaims | null {
  if (!value) return null;
  const parts = value.trim().split(":");
  if (parts.length !== 5 || parts[0] !== "v1") {
    throw new Error("Invalid Ripple reference");
  }
  const purpose = PURPOSE_ALIASES[parts[1] ?? ""];
  const targetId = parts[2];
  const nonce = parts[3];
  const mac = parts[4];
  if (!purpose || !targetId || !nonce || !mac) {
    throw new Error("Invalid Ripple reference");
  }
  if (!expectedLinkCode) {
    throw new Error("Invalid Ripple reference");
  }

  const clientId = getRippleClientId();
  const secrets = getRippleReferenceSecrets();
  const candidates: Array<DealerTier | null> =
    purpose === "dealer_subscription" ? ["STARTER", "PRO"] : [null];

  for (const secret of [secrets.current, secrets.previous]) {
    if (!secret) continue;
    for (const tier of candidates) {
      const payload = signedPayload({
        clientId,
        purpose,
        targetId,
        linkCode: expectedLinkCode,
        nonce,
        tier,
      });
      if (safeEqual(signWithSecret(secret, payload), mac)) {
        return {
          version: "v1",
          purpose,
          targetId,
          linkCode: expectedLinkCode.toUpperCase(),
          nonce,
          tier,
        };
      }
    }
  }

  throw new Error("Invalid Ripple reference");
}

export function createSyntheticSubscriptionId(input: {
  clientId: string;
  linkCode: string;
  email: string;
}): string {
  const { current } = getRippleReferenceSecrets();
  return `v1:${hmacHex(
    current,
    `sub|${input.clientId}|${input.linkCode.toUpperCase()}|${normalizeRippleEmail(input.email)}`
  ).slice(0, 32)}`;
}

export function listSyntheticSubscriptionIds(input: {
  clientId: string;
  linkCode: string;
  email: string;
}): string[] {
  const secrets = getRippleReferenceSecrets();
  const payload = `sub|${input.clientId}|${input.linkCode.toUpperCase()}|${normalizeRippleEmail(input.email)}`;
  return [secrets.current, secrets.previous]
    .filter((secret): secret is string => Boolean(secret))
    .map((secret) => `v1:${hmacHex(secret, payload).slice(0, 32)}`);
}

export function normalizeRippleEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function checkoutTypeFromReferencePurpose(
  purpose: RippleReferencePurpose
): RippleCheckoutType {
  return purpose;
}
