import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { launchGateSecretBytes } from "@/lib/launch/session";

export const EARLY_ACCESS_INVITE_PURPOSE = "waitlist-early-access-v1";
export const EARLY_ACCESS_CLAIM_COOKIE = "__Host-early-access";
export const EARLY_ACCESS_CLAIM_TTL_SECONDS = 20 * 60;
const CLAIM_VERSION = "v1";
const CLAIM_PURPOSE = "early-access-claim";

export type EarlyAccessClaimCookie = {
  value: string;
  options: {
    httpOnly: true;
    secure: true;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
};

export function createEarlyAccessNonce(): string {
  return randomBytes(32).toString("base64url");
}

function sign(secret: string | undefined, payload: string): string | null {
  const key = launchGateSecretBytes(secret);
  if (!key) return null;
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function signEarlyAccessInvite(input: {
  secret: string | undefined;
  recipientId: string;
  nonce: string;
}): string | null {
  if (!input.recipientId || !input.nonce) return null;
  return sign(
    input.secret,
    [EARLY_ACCESS_INVITE_PURPOSE, input.recipientId, input.nonce].join("."),
  );
}

export function earlyAccessInviteMatches(
  proof: string,
  input: { secret: string | undefined; recipientId: string; nonce: string },
): boolean {
  const expected = signEarlyAccessInvite(input);
  if (!expected || !proof) return false;
  return signaturesMatch(proof, expected);
}

export function buildEarlyAccessClaimUrl(
  origin: string,
  recipientId: string,
  proof: string,
): string {
  const claim = new URL("/early-access", origin);
  claim.searchParams.set("recipient", recipientId);
  claim.searchParams.set("proof", proof);
  if (claim.origin !== new URL(origin).origin || claim.pathname !== "/early-access") {
    throw new Error("Early-access link was rejected.");
  }
  return claim.toString();
}

export function issueEarlyAccessClaimCookie(input: {
  secret: string | undefined;
  recipientId: string;
  nonce: string;
  now?: number;
}): EarlyAccessClaimCookie | null {
  const now = input.now ?? Date.now();
  const exp = Math.floor(now / 1000) + EARLY_ACCESS_CLAIM_TTL_SECONDS;
  const payload = [CLAIM_VERSION, CLAIM_PURPOSE, input.recipientId, String(exp)].join(".");
  const signature = sign(input.secret, `${payload}.${input.nonce}`);
  if (!signature) return null;
  return {
    value: `${payload}.${signature}`,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: EARLY_ACCESS_CLAIM_TTL_SECONDS,
    },
  };
}

export function readEarlyAccessClaimCookie(
  token: string | undefined,
  input: {
    secret: string | undefined;
    recipientId: string;
    nonce: string;
    now?: number;
  },
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;
  const [version, purpose, recipientId, expText, signature] = parts;
  if (
    version !== CLAIM_VERSION ||
    purpose !== CLAIM_PURPOSE ||
    recipientId !== input.recipientId ||
    !/^[0-9]+$/.test(expText) ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    return false;
  }
  const exp = Number(expText);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(exp) || exp < nowSeconds - 60) return false;
  if (exp > nowSeconds + EARLY_ACCESS_CLAIM_TTL_SECONDS + 60) return false;
  const payload = parts.slice(0, 4).join(".");
  const expected = sign(input.secret, `${payload}.${input.nonce}`);
  return Boolean(expected && signaturesMatch(signature, expected));
}
