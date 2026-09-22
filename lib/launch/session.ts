import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { RuntimeEnv } from "@/lib/runtime-env";

export const LAUNCH_GATE_COOKIE = "__Host-dev-gate";
export const LAUNCH_GATE_PURPOSE = "launch-gate";
export const LAUNCH_GATE_VERSION = "v1";
export const LAUNCH_GATE_TTL_SECONDS = 12 * 60 * 60;
const MIN_SECRET_BYTES = 32;
const CLOCK_SKEW_SECONDS = 60;

const ENVIRONMENTS = new Set(["production", "preview", "development", "test"]);

export type LaunchGateCookieOptions = {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
};

export type IssuedLaunchGateCookie = {
  value: string;
  options: LaunchGateCookieOptions;
};

export function launchEnvironmentLabel(env: RuntimeEnv = process.env): string {
  if (
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview" ||
    env.VERCEL_ENV === "development"
  ) {
    return env.VERCEL_ENV;
  }
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "production") return "production";
  return "development";
}

export function launchGateSecretBytes(secret: string | undefined): Buffer | null {
  if (!secret) return null;
  const trimmed = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const bytes = Buffer.from(trimmed, "utf8");
  if (bytes.length < MIN_SECRET_BYTES) return null;
  return bytes;
}

function signPayload(payload: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function issueLaunchGateCookie(input: {
  secret: string | undefined;
  environment: string;
  now?: number;
  nonce?: string;
}): IssuedLaunchGateCookie | null {
  const secret = launchGateSecretBytes(input.secret);
  if (!secret || !ENVIRONMENTS.has(input.environment)) return null;
  const now = input.now ?? Date.now();
  const exp = Math.floor(now / 1000) + LAUNCH_GATE_TTL_SECONDS;
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const payload = [
    LAUNCH_GATE_VERSION,
    LAUNCH_GATE_PURPOSE,
    input.environment,
    String(exp),
    nonce,
  ].join(".");
  const value = `${payload}.${signPayload(payload, secret)}`;
  return {
    value,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: LAUNCH_GATE_TTL_SECONDS,
    },
  };
}

export function verifyLaunchGateCookie(
  token: string | undefined,
  input: {
    secret: string | undefined;
    environment: string;
    now?: number;
  },
): boolean {
  const secret = launchGateSecretBytes(input.secret);
  if (!secret || !token || !ENVIRONMENTS.has(input.environment)) return false;
  const parts = token.split(".");
  if (parts.length !== 6) return false;
  const [version, purpose, environment, expText, nonce, signature] = parts;
  if (
    version !== LAUNCH_GATE_VERSION ||
    purpose !== LAUNCH_GATE_PURPOSE ||
    environment !== input.environment ||
    !/^[0-9a-f]+$/i.test(nonce) ||
    !/^[0-9a-f]+$/i.test(signature)
  ) {
    return false;
  }
  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (exp < nowSeconds - CLOCK_SKEW_SECONDS) return false;
  if (exp > nowSeconds + LAUNCH_GATE_TTL_SECONDS + CLOCK_SKEW_SECONDS) return false;
  const payload = parts.slice(0, 5).join(".");
  return signaturesMatch(signature, signPayload(payload, secret));
}
