import { createHmac, timingSafeEqual } from "node:crypto";
import { isStagingDeployment } from "@/lib/deployment/environment";
import type { RuntimeEnv } from "@/lib/runtime-env";

export const STAGING_RATE_LIMIT_HEADER = "x-itrader-staging-rate-limit";

function signature(secret: string, expires: string, cookie: string) {
  return createHmac("sha256", secret).update("itrader-staging-rate-limit-v1:" + expires + ":" + cookie).digest("hex");
}

/** Issued only after the staging proxy validates the account and its session. */
export function createStagingRateLimitProof(cookie: string, env: RuntimeEnv = process.env, now = Date.now()) {
  const secret = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!cookie || !secret || !isStagingDeployment(env)) return null;
  const expires = String(now + 5 * 60_000);
  return expires + "." + signature(secret, expires, cookie);
}

export function verifyStagingRateLimitProof(proof: string | null, cookie: string, env: RuntimeEnv = process.env, now = Date.now()) {
  const secret = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(proof ?? "");
  if (!cookie || !secret || !match || !isStagingDeployment(env)) return false;
  const [, expires, provided] = match;
  if (Number(expires) <= now || Number(expires) > now + 5 * 60_000) return false;
  return timingSafeEqual(Buffer.from(signature(secret, expires, cookie), "hex"), Buffer.from(provided, "hex"));
}
