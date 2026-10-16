import { isStagingOnlyFeatureEnabled } from "@/lib/deployment/environment";
import { STAGING_ORIGIN } from "@/lib/deployment/staging-origin";
import { resolvePreviewSessionUrl } from "@/lib/database-sync/session";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PreviewMirrorError } from "./error";

export function mirrorSourceUrl(env: NodeJS.ProcessEnv): string {
  const raw = env.PREVIEW_MIRROR_SOURCE_READONLY_URL;
  try {
    const url = new URL(raw ?? "");
    const ref = "snlqivvogfqesxpbjiei";
    const user = decodeURIComponent(url.username);
    const direct = url.hostname === `db.${ref}.supabase.co` && user === "postgres";
    const pooled = url.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`;
    if (!["postgres:", "postgresql:"].includes(url.protocol) || (!direct && !pooled) ||
      !["", "5432"].includes(url.port) || url.pathname !== "/postgres") throw new Error();
    return raw!;
  } catch { throw new PreviewMirrorError("The production read-only session connection is not configured."); }
}

export function assertMirrorTargets(env: NodeJS.ProcessEnv): void {
  if (!isStagingOnlyFeatureEnabled(env)) throw new PreviewMirrorError("Preview refresh is available only on the verified staging deployment.");
  mirrorSourceUrl(env);
  resolvePreviewSessionUrl(env);
  if (!/^[a-f0-9]{64}$/i.test(env.PREVIEW_MIRROR_ENCRYPTION_KEY ?? "")) throw new PreviewMirrorError("The preview backup encryption key is not configured.");
}

export function authorizeScheduledRequest(signature: string | null, timestamp: string | null, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !signature || !/^[a-f0-9]{64}$/.test(signature) || !timestamp || !/^\d{13}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`POST\n/api/cron/preview-mirror\n${timestamp}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function stagingMutationOriginAllowed(origin: string | null, env: NodeJS.ProcessEnv): boolean {
  if (!origin) return false;
  if (env.VERCEL_ENV === "preview") return origin === STAGING_ORIGIN;
  if (env.NODE_ENV !== "development" || env.VERCEL_ENV || env.ITRADER_LOCAL_STAGING_FEATURES !== "1") return false;
  try {
    const configured = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
    return ["http:", "https:"].includes(configured.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) && origin === configured.origin;
  } catch { return false; }
}
