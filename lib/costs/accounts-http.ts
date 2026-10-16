/** Accounts credentials stay on the server. Next resolves this marker internally. */
import "server-only";
import type { RuntimeEnv } from "@/lib/runtime-env";

export const ACCOUNTS_PRODUCTION_ORIGIN = "https://accounts.mpdee.info";
const LOOPBACK_ORIGIN = "http://127.0.0.1:4000";

export const ACCOUNTS_REQUEST_TIMEOUT_MS = 30_000;
export const ACCOUNTS_BILLING_MAX_BYTES = 15_000_000;
export const ACCOUNTS_SUMMARY_MAX_BYTES = 1_048_576;

export type AccountsFetchFailure = "status" | "size" | "json" | "network";

export function resolveAccountsOrigin(env: RuntimeEnv): string | null {
  const deploymentLocked = env.VERCEL === "1"
    || env.VERCEL_ENV === "production"
    || env.VERCEL_ENV === "preview";
  if (deploymentLocked || env.NODE_ENV !== "development") return ACCOUNTS_PRODUCTION_ORIGIN;
  const configured = env.COST_ACCOUNTS_DEV_ORIGIN?.trim() ?? "";
  if (configured.length === 0) return ACCOUNTS_PRODUCTION_ORIGIN;
  if (configured !== LOOPBACK_ORIGIN && configured !== `${LOOPBACK_ORIGIN}/`) return null;
  const url = new URL(configured);
  const loopback = url.origin === LOOPBACK_ORIGIN
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === ""
    && url.pathname === "/";
  return loopback ? LOOPBACK_ORIGIN : null;
}

export function accountsProjectUrl(env: RuntimeEnv, resource: "summary" | "billing"): string | null {
  const origin = resolveAccountsOrigin(env);
  if (!origin) return null;
  return `${origin}/api/costs/projects/itrader/${resource}`;
}

export async function readBoundedBody(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function fetchAccountsDocument(
  url: string,
  token: string,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; failure: AccountsFetchFailure }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(ACCOUNTS_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, failure: "status" };
    const text = await readBoundedBody(response, maxBytes);
    if (text === null) return { ok: false, failure: "size" };
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, failure: "json" };
    }
  } catch {
    return { ok: false, failure: "network" };
  }
}
