export type DesktopEnvironment = "preview" | "production";
export const DESKTOP_ORIGINS = {
  preview: "https://itrader.dev",
  production: "https://itrader.im",
} as const;

export class DesktopAccessError extends Error {
  constructor(readonly reason: "unauthorised" | "unavailable" | "invalid-response") {
    super(reason === "unauthorised"
      ? "Desktop authorisation has expired or been revoked. Sign in again."
      : "Desktop authorisation could not be verified. No new job was started.");
    this.name = "DesktopAccessError";
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new DesktopAccessError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 65_536) throw new DesktopAccessError("invalid-response");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Device tokens authenticate only to the selected canonical iTrader origin. */
export async function authoriseDesktopSession(
  environment: DesktopEnvironment,
  accessToken: string,
  options: { fetcher?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<{ deviceId: string; accountId: string; environment: DesktopEnvironment; expiresAt: string }> {
  if ((environment !== "preview" && environment !== "production") || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) {
    throw new DesktopAccessError("unauthorised");
  }
  try {
    const response = await (options.fetcher ?? fetch)(`${DESKTOP_ORIGINS[environment]}/api/stock-worker`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, options.timeoutMs ?? 15_000))),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ op: "session", includeConfig: false }),
    });
    if (response.status === 401 || response.status === 403) throw new DesktopAccessError("unauthorised");
    if (!response.ok || response.redirected) throw new DesktopAccessError("unavailable");
    const value = await boundedJson(response);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DesktopAccessError("invalid-response");
    const record = value as Record<string, unknown>;
    const account = record.account as Record<string, unknown> | null;
    const expiry = typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) : NaN;
    if (record.accessToken !== accessToken || record.environment !== environment ||
        typeof record.deviceId !== "string" || !/^dev_[A-Za-z0-9_-]{22}$/.test(record.deviceId) ||
        !account || typeof account.id !== "string" || !account.id || account.id.length > 128 ||
        !Number.isFinite(expiry) || expiry <= (options.now?.() ?? Date.now())) {
      throw new DesktopAccessError("invalid-response");
    }
    return { deviceId: record.deviceId, accountId: account.id, environment, expiresAt: record.expiresAt as string };
  } catch (error) {
    if (error instanceof DesktopAccessError) throw error;
    throw new DesktopAccessError("unavailable");
  }
}
