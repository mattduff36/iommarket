import type { RuntimeEnv } from "@/lib/runtime-env";
import { isStagingDeployment } from "@/lib/deployment/environment";

const APPROVED_STAGING_TEST_EMAILS = new Set([
  "mattduff36@gmail.com",
  "davooomarsh@hotmail.com",
]);

/** Every hosted preview running this code is private, regardless of its branch. */
export function requiresStagingAdmin(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview" || env.ITRADER_DEPLOYMENT_ROLE === "staging";
}

const ENTRY_PATHS = new Set([
  "/staging-access", "/sign-in", "/forgot-password", "/auth/callback",
  "/robots.txt", "/sitemap.xml",
]);

// These handlers authenticate their own signed machine requests. Never allow
// arbitrary /api prefixes or the legacy shared-password endpoint through.
const MACHINE_PATHS = new Set([
  "/api/auth/send-email",
  "/api/webhooks/payments", "/api/webhooks/ripple", "/api/webhooks/ripple-staging",
]);

export function isStagingEntryRequest(path: string, method: string, serverAction: boolean) {
  return !serverAction && (method === "GET" || method === "HEAD") && ENTRY_PATHS.has(path);
}

export function isStagingMachineRequest(path: string, method: string, serverAction: boolean) {
  return !serverAction && method === "POST" && MACHINE_PATHS.has(path);
}

export function hasStagingAdminRole(user: {
  role: string;
  disabledAt?: unknown;
  deletedAt?: unknown;
} | null | undefined): boolean {
  return user?.role === "ADMIN" && !user.disabledAt && !user.deletedAt;
}

/**
 * Allows only explicitly approved, verified test identities on the exact staging
 * deployment. Admin access keeps its existing behavior; production never accepts
 * the test-account exception.
 */
export function hasStagingAccess(user: {
  role: string;
  email?: string | null;
  verifiedAuthEmail?: string | null;
  disabledAt?: unknown;
  deletedAt?: unknown;
} | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (hasStagingAdminRole(user)) return true;
  if (!user || !isStagingDeployment(env) || user.disabledAt || user.deletedAt) return false;
  if (!user.verifiedAuthEmail || !user.email) return false;

  const verifiedEmail = user.verifiedAuthEmail.trim().toLowerCase();
  return user.email.trim().toLowerCase() === verifiedEmail &&
    APPROVED_STAGING_TEST_EMAILS.has(verifiedEmail);
}
