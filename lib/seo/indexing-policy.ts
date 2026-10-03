import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import type { RuntimeEnv } from "@/lib/runtime-env";

export type DeploymentClass = "production" | "preview" | "local" | "test" | "unknown";

/**
 * Preview URLs may already have been crawled while robots allowed fetching and
 * pages did not send noindex. Keep preview robots crawlable so crawlers can
 * read X-Robots-Tag: noindex and drop those URLs. Publish no preview sitemap
 * entries. A blanket disallow comes only after removal is confirmed, because
 * robots.txt cannot carry a noindex directive. Robots rules are not access control.
 */
export const PREVIEW_INDEX_REMOVAL_PHASE = "crawlable-noindex" as const;

const UTILITY_NOINDEX_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/auth",
  "/account",
  "/admin",
  "/pay",
  "/sell",
  "/preview",
  "/early-access",
  "/demo",
  "/uidemo",
  "/payment-return",
  "/dealer/subscribe",
  "/dealer/dashboard",
  "/dealer/profile",
  "/dealer/onboarding",
  "/dealer/correspondence",
] as const;

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Deployment class comes from server-owned VERCEL_ENV and NODE_ENV.
 * Request host, query and cookies are intentionally ignored.
 */
export function classifyDeployment(env: RuntimeEnv = process.env): DeploymentClass {
  const vercel = env.VERCEL_ENV?.trim();
  const node = env.NODE_ENV?.trim();
  if (vercel === "preview") return "preview";
  if (node === "test") return "test";
  if (node === "development") return "local";
  if (vercel === "production" && node === "production") return "production";
  return "unknown";
}

export function isSearchIndexingEnabled(
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  if (classifyDeployment(env) !== "production") return false;
  return !shouldEnforceLaunchGate(env, now);
}

export function isUtilityNoindexPath(pathname: string): boolean {
  return UTILITY_NOINDEX_PREFIXES.some((prefix) => matchesPath(pathname, prefix));
}

export function shouldNoindexHtmlResponse(
  pathname: string,
  env: RuntimeEnv = process.env,
  now = Date.now(),
): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (!isSearchIndexingEnabled(env, now)) return true;
  return isUtilityNoindexPath(pathname);
}

export function applyIndexingHeader<T extends { headers: { set: (name: string, value: string) => void } }>(
  response: T,
  pathname: string,
  env: RuntimeEnv = process.env,
  now = Date.now(),
): T {
  if (shouldNoindexHtmlResponse(pathname, env, now)) {
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
}
