import { isIP } from "node:net";
import { headers } from "next/headers";
import { isStagingDeployment } from "@/lib/deployment/environment";
import { STAGING_RATE_LIMIT_HEADER, verifyStagingRateLimitProof } from "@/lib/deployment/staging-rate-limit";
import type { RateLimitExemption } from "@/lib/rate-limit-result";
import type { RuntimeEnv } from "@/lib/runtime-env";

const productionDecisions = new WeakMap<object, Promise<boolean>>();
const authCookie = /(?:^|;\s*)sb-[\w-]+-auth-token(?:\.\d+)?=/;

function normalizedAddress(value: string | null | undefined) {
  const address = value?.trim() ?? "";
  const version = isIP(address);
  if (version === 4) return address;
  if (version === 6 && !address.includes("%")) return new URL(`http://[${address}]`).hostname;
  return null;
}

function isTrustedIp(request: Pick<Headers, "get">, env: RuntimeEnv) {
  if (env.VERCEL !== "1") return false;
  const allowed = normalizedAddress(env.ITRADER_RATE_LIMIT_EXEMPT_IP);
  // Vercel supplies this address. Require exactly one IP and ignore client IP hints.
  return allowed !== null && allowed === normalizedAddress(request.get("x-vercel-forwarded-for"));
}

async function checkProductionAccount(config: string) {
  const allowed = config.split(",").map(value => value.trim());
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (error || !id || !allowed.includes(id)) return false;

  // Use the existing live session and active-account checks after matching the
  // verified subject. The allowlist uses production Auth IDs, never user claims
  // such as editable profile metadata, email text, or a shared role.
  const { getCurrentUser } = await import("@/lib/auth");
  const user = await getCurrentUser();
  return user?.authUserId === id;
}

export async function getRateLimitExemption(env: RuntimeEnv = process.env): Promise<RateLimitExemption | null> {
  const staging = isStagingDeployment(env);
  const production = env.NODE_ENV === "production" && env.VERCEL_ENV === "production";
  if (!staging && !production) return null;
  try {
    const request = await headers();
    const cookie = request.get("cookie") ?? "";
    if (staging && verifyStagingRateLimitProof(request.get(STAGING_RATE_LIMIT_HEADER), cookie, env)) return "account";
    const allowlist = env.ITRADER_RATE_LIMIT_EXEMPT_AUTH_IDS;
    if (production && allowlist && authCookie.test(cookie)) {
      let decision = env === process.env ? productionDecisions.get(request) : undefined;
      if (!decision) {
        decision = checkProductionAccount(allowlist).catch(() => false);
        if (env === process.env) productionDecisions.set(request, decision);
      }
      if (await decision) return "account";
    }
    return isTrustedIp(request, env) ? "ip" : null;
  } catch {
    // Jobs without an HTTP request and failed identity checks use the usual limit.
    return null;
  }
}

export async function isRateLimitExempt(env: RuntimeEnv = process.env) {
  return (await getRateLimitExemption(env)) !== null;
}
