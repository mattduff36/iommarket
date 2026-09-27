import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CORRESPONDENCE_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function createCorrespondenceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashCorrespondenceToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function correspondenceTokenMatches(token: string, tokenHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(tokenHash)) return false;
  const actual = Buffer.from(hashCorrespondenceToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
