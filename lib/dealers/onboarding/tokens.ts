import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const ONBOARDING_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ONBOARDING_CLAIM_COOKIE = "dealer_onboarding_claim";
export const ONBOARDING_CLAIM_COOKIE_MAX_AGE_SECONDS = 20 * 60;
export const ONBOARDING_LEASE_MS = 2 * 60 * 1000;

export function createOnboardingToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOnboardingToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function onboardingTokenMatches(token: string, tokenHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) return false;
  const actual = Buffer.from(hashOnboardingToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createLeaseToken() {
  return randomBytes(16).toString("base64url");
}

export function sanitizeOnboardingError(error: unknown) {
  const message = error instanceof Error ? error.message : "Dealer onboarding failed.";
  return message.replace(/token|bearer|action_link|password/gi, "[redacted]").slice(0, 300);
}
