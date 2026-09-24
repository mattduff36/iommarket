import { isLegalRoute } from "@/lib/policies/registry";

export type LaunchRouteClass =
  | "trusted-hook"
  | "public-api"
  | "gated-api"
  | "seo"
  | "holding"
  | "homepage"
  | "legal"
  | "app";

const EXACT_TRUSTED_HOOKS = new Set([
  "/api/auth/send-email",
  "/api/dev-auth",
  "/api/monitoring/events",
  "/api/internal/cost-sync",
]);

const PUBLIC_WHILE_GATED = [
  "/contact",
  "/safety",
  "/faq",
  "/vehicle-check",
  "/dealer/onboarding",
];

export function matchesPathBoundary(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isTrustedLaunchHook(pathname: string): boolean {
  return (
    matchesPathBoundary(pathname, "/api/webhooks/payments") ||
    matchesPathBoundary(pathname, "/api/webhooks/ripple") ||
    matchesPathBoundary(pathname, "/api/cron") ||
    EXACT_TRUSTED_HOOKS.has(pathname)
  );
}

export function isPublicWhileGated(pathname: string): boolean {
  if (isLegalRoute(pathname)) return true;
  return PUBLIC_WHILE_GATED.some((prefix) => matchesPathBoundary(pathname, prefix));
}

export function classifyLaunchRoute(pathname: string): LaunchRouteClass {
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return "seo";
  if (pathname === "/holding") return "holding";
  if (pathname === "/") return "homepage";
  if (isPublicWhileGated(pathname)) return "legal";
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    if (isTrustedLaunchHook(pathname)) return "trusted-hook";
    if (matchesPathBoundary(pathname, "/api/vehicle-check")) return "public-api";
    return "gated-api";
  }
  return "app";
}
