import { createHash } from "node:crypto";
import type { RuntimeEnv } from "@/lib/runtime-env";

export const ACCOUNTS_PREVIEW_PREFIX = "accounts-preview:itrader:";
export const ACCOUNTS_PREVIEW_SETTINGS = `${ACCOUNTS_PREVIEW_PREFIX}snapshot`;
export const ACCOUNTS_PREVIEW_CATEGORIES = `${ACCOUNTS_PREVIEW_PREFIX}categories`;
export const ACCOUNTS_PREVIEW_START = "2026-08-13T23:00:00.000Z";
export const ACCOUNTS_PREVIEW_PROJECT = "prj_TFAfJkG9P0osjQpsH2gaNrSPWbCr";
const VERIFIED_PREVIEW_DATABASE = "71999144551f4394";

export function accountsPreviewRequested(env: RuntimeEnv = process.env): boolean {
  return env.COST_LEDGER_ROLE === "accounts-preview";
}

export function previewDatabaseFingerprint(raw: string): string {
  const url = new URL(raw);
  return createHash("sha256").update([url.hostname, url.port, url.pathname, decodeURIComponent(url.username)].join("|")).digest("hex");
}

/** The runtime resolver precedence must match lib/db/index.ts exactly. */
export function assertAccountsPreview(env: RuntimeEnv = process.env): void {
  const deny = () => { throw new Error("Accounts preview is not configured for this isolated deployment."); };
  if (!accountsPreviewRequested(env) || env.COST_LEDGER_DATABASE_URL) return deny();
  const raw = env.POSTGRES_URL ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL;
  if (!raw) return deny();
  try {
    if (env.VERCEL_ENV !== "preview" || env.VERCEL_PROJECT_ID !== ACCOUNTS_PREVIEW_PROJECT ||
        !/^[a-f0-9]{64}$/.test(env.COST_ACCOUNTS_PREVIEW_DB_FINGERPRINT ?? "") ||
        env.COST_ACCOUNTS_PREVIEW_DB_FINGERPRINT !== previewDatabaseFingerprint(raw) ||
        previewDatabaseFingerprint(raw).slice(0,16) !== VERIFIED_PREVIEW_DATABASE) return deny();
  } catch { return deny(); }
}
