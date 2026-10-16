import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { browserOriginAllowed } from "@/lib/dealer-stock-sync/desktop-config";
import {
  approveDesktopDevice,
  handleDesktopPost,
  listDesktopDevices,
  memoryDesktopDependencies,
  revokeDesktopDevice,
  type DesktopAccount,
  type DesktopDependencies,
} from "@/lib/dealer-stock-sync/desktop-service";
import {
  createRedisDesktopStore,
  DesktopStoreUnavailable,
  type DesktopStore,
  type PendingRecord,
} from "@/lib/dealer-stock-sync/desktop-store";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIBTESTCERTIFICATE\n-----END CERTIFICATE-----";
const ADMIN_A = "cadmin0000000000000000001";
const ADMIN_B = "cadmin0000000000000000002";
const PRIVATE_A = "private_test_key_value_0123456789";
const PRIVATE_B = "private_other_key_value_012345678";

function databaseUrl(project: string, password: string): string {
  return `postgresql://postgres:${password}@db.${project}.supabase.co:5432/postgres`;
}

function workerEnv(privateKey = PRIVATE_A): Record<string, string> {
  const project = "syneonzucehwlghqmfbg";
  return {
    DEALER_STOCK_SYNC_TARGET: "preview",
    VERCEL_ENV: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NODE_ENV: "production",
    DEALER_STOCK_SYNC_WORKER: "1",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl(project, "worker-secret"),
    POSTGRES_URL: databaseUrl(project, "worker-secret"),
    POSTGRES_URL_NON_POOLING: databaseUrl(project, "worker-secret"),
    SUPABASE_DB_CA_CERT: CERT,
    MEDIA_PROVIDER: "imagekit",
    NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
    MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1",
    IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    IMAGEKIT_PUBLIC_KEY: "public_test_key",
    IMAGEKIT_PRIVATE_KEY: privateKey,
  };
}

function previewEnv(ids: string[], workers: Record<string, Record<string, string>>): Record<string, string> {
  const project = "syneonzucehwlghqmfbg";
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: ids.join(","),
    DEALER_STOCK_DESKTOP_CONFIG_JSON: JSON.stringify(workers),
    VERCEL_ENV: "preview",
    DEALER_STOCK_SYNC_TARGET: "preview",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl(project, "app-secret"),
    POSTGRES_URL: databaseUrl(project, "app-secret"),
    POSTGRES_URL_NON_POOLING: databaseUrl(project, "app-secret"),
  };
}

function verifier(): string {
  return randomBytes(32).toString("base64url");
}

function challenge(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function account(id: string, overrides: Partial<DesktopAccount> = {}): DesktopAccount {
  return { id, name: "Stock Admin", email: "stock-admin@example.com", role: "ADMIN", disabledAt: null, deletedAt: null, ...overrides };
}

function harness(users = new Map<string, DesktopAccount>([[ADMIN_A, account(ADMIN_A)]])) {
  let now = Date.parse("2026-10-16T12:00:00.000Z");
  const env = previewEnv([ADMIN_A, ADMIN_B], { [ADMIN_A]: workerEnv(PRIVATE_A), [ADMIN_B]: workerEnv(PRIVATE_B) });
  const deps = memoryDesktopDependencies(env, () => now, { async findById(id) { return users.get(id) ?? null; } });
  return { deps, users, env, advance: (ms: number) => { now += ms; } };
}

function post(deps: DesktopDependencies, body: unknown, authorization: string | null = null) {
  return handleDesktopPost(deps, { body, authorization, ip: "203.0.113.10", hasQuery: false });
}

async function paired(deps: DesktopDependencies) {
  const secret = verifier();
  const started = await post(deps, {
    op: "begin",
    deviceName: "Front Desk",
    codeChallenge: challenge(secret),
    environment: "preview",
    clientVersion: "1.2.0",
  });
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error("pairing did not start");
  return { secret, started };
}

describe("desktop worker service", () => {
  it("issues one session for a valid approval and refuses replay", async () => {
    const { deps } = harness();
    const { secret, started } = await paired(deps);
    const approved = await approveDesktopDevice(deps, {
      origin: "https://itrader.dev",
      host: "itrader.dev",
      forwardedHost: null,
      adminId: ADMIN_A,
      userCode: String(started.body.userCode),
    });
    expect(approved.ok).toBe(true);
    const body = { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret };
    const [first, second] = await Promise.all([post(deps, body), post(deps, body)]);
    const issued = [first, second].filter((result) => result.ok && result.status === 200);
    const rejected = [first, second].filter((result) => !result.ok);
    expect(issued).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const token = String(issued[0]?.ok ? issued[0].body.accessToken : "");
    const session = await post(deps, { op: "session", includeConfig: true }, `Bearer ${token}`);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.body.environment).toBe("preview");
    expect(session.body.account).toEqual({ id: ADMIN_A, name: "Stock Admin", email: "stock-admin@example.com" });
    expect(session.body.config).toMatchObject({ IMAGEKIT_PRIVATE_KEY: PRIVATE_A });
    expect(JSON.stringify(session.body.config)).not.toContain(PRIVATE_B);
    expect(JSON.stringify(session.body.config)).not.toContain("app-secret");
    const replay = await post(deps, body);
    expect(replay).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(JSON.stringify(replay)).not.toContain(token);
  });

  it("does not consume a code for a bad PKCE verifier", async () => {
    const { deps } = harness();
    const { secret, started } = await paired(deps);
    const wrong = await post(deps, { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: verifier() });
    expect(wrong).toMatchObject({ ok: false, error: "invalid_grant" });
    const pending = await post(deps, { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret });
    expect(pending).toEqual({ ok: true, status: 202, body: { status: "pending" } });
    expect(JSON.stringify(wrong)).not.toContain(String(started.body.deviceCode));
  });

  it("fails closed for expiry, revocation, role, allowlist, environment, config, and redis", async () => {
    const { deps, users, env, advance } = harness();
    const { secret, started } = await paired(deps);
    advance(601_000);
    expect(await post(deps, { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret })).toMatchObject({ error: "invalid_grant" });

    const fresh = await paired(deps);
    expect(await post(deps, {
      op: "begin",
      deviceName: "Front Desk",
      codeChallenge: challenge(verifier()),
      environment: "production",
      clientVersion: "1.2.0",
    })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await approveDesktopDevice(deps, {
      origin: "https://evil.example",
      host: "evil.example",
      forwardedHost: null,
      adminId: ADMIN_A,
      userCode: String(fresh.started.body.userCode),
    })).toMatchObject({ error: "forbidden" });
    users.set(ADMIN_A, account(ADMIN_A, { role: "USER" }));
    expect(await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, userCode: String(fresh.started.body.userCode),
    })).toMatchObject({ error: "forbidden" });
    users.set(ADMIN_A, account(ADMIN_A));
    const outsider = account("cadmin0000000000000000009");
    users.set(outsider.id, outsider);
    expect(await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: outsider.id, userCode: String(fresh.started.body.userCode),
    })).toMatchObject({ error: "forbidden" });
    expect(await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, userCode: String(fresh.started.body.userCode),
    })).toMatchObject({ ok: true });
    const issued = await post(deps, { op: "poll", deviceCode: fresh.started.body.deviceCode, codeVerifier: fresh.secret });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const token = String(issued.body.accessToken);
    users.set(ADMIN_A, account(ADMIN_A, { disabledAt: "2026-10-16T00:00:00.000Z" }));
    const disabled = await post(deps, { op: "session", includeConfig: true }, `Bearer ${token}`);
    expect(disabled).toMatchObject({ ok: false, error: "forbidden" });
    expect(JSON.stringify(disabled)).not.toContain(PRIVATE_A);
    users.set(ADMIN_A, account(ADMIN_A));
    env.DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS = ADMIN_B;
    env.DEALER_STOCK_DESKTOP_CONFIG_JSON = JSON.stringify({ [ADMIN_B]: workerEnv(PRIVATE_B) });
    const unlisted = await post(deps, { op: "session" }, `Bearer ${token}`);
    expect(unlisted).toMatchObject({ error: "forbidden" });
    expect(JSON.stringify(unlisted)).not.toContain("config");
    env.DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS = `${ADMIN_A},${ADMIN_B}`;
    env.DEALER_STOCK_DESKTOP_CONFIG_JSON = JSON.stringify({ [ADMIN_A]: workerEnv(PRIVATE_A), [ADMIN_B]: workerEnv(PRIVATE_B) });
    const restored = await post(deps, { op: "session" }, `Bearer ${token}`);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.body).not.toHaveProperty("config");
    expect(await post(deps, { op: "revoke" }, `Bearer ${token}`)).toMatchObject({ ok: true, body: { status: "revoked" } });
    expect(await post(deps, { op: "session" }, `Bearer ${token}`)).toMatchObject({ error: "unauthorized" });
    const devices = await listDesktopDevices(deps, ADMIN_A);
    expect(devices).toEqual([]);

    const expired = await paired(deps);
    await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, userCode: String(expired.started.body.userCode),
    });
    const longLived = await post(deps, { op: "poll", deviceCode: expired.started.body.deviceCode, codeVerifier: expired.secret });
    expect(longLived.ok).toBe(true);
    if (!longLived.ok) return;
    advance(30 * 24 * 60 * 60 * 1000 + 1_000);
    expect(await post(deps, { op: "session" }, `Bearer ${String(longLived.body.accessToken)}`)).toMatchObject({ error: "unauthorized" });

    deps.env.DEALER_STOCK_DESKTOP_ENABLED = "0";
    const unavailable = await post(deps, {
      op: "begin", deviceName: "Front Desk", codeChallenge: challenge(verifier()), environment: "preview", clientVersion: "1.2.0",
    });
    expect(unavailable).toMatchObject({ status: 503, error: "unavailable" });
    expect(JSON.stringify(unavailable)).not.toContain(PRIVATE_A);
    expect(browserOriginAllowed("https://itrader.dev", "internal.local", "itrader.dev", "https://itrader.dev")).toBe(true);
    expect(browserOriginAllowed("https://itrader.dev.evil.test", "itrader.dev", null, "https://itrader.dev")).toBe(false);
  });

  it("passes all atomic Redis keys explicitly and never consumes a bad verifier", async () => {
    const now = Date.parse("2026-10-16T12:00:00.000Z");
    const values = new Map<string, unknown>();
    const calls: Array<{ script: string; keys: string[]; args: string[] }> = [];
    const ttlWrites: unknown[] = [];
    const redis = {
      async set(key: string, value: unknown, options?: { ex: number; nx: true }) {
        ttlWrites.push(options); values.set(key, value); return "OK";
      },
      async get(key: string) { return values.get(key) ?? null; },
      async del(...keys: string[]) { keys.forEach((key) => values.delete(key)); return keys.length; },
      async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
        calls.push({ script, keys, args }); return "issued";
      },
      async smembers() { return [] as string[]; },
    };
    const store = createRedisDesktopStore(redis, "preview", () => now);
    const pending: PendingRecord = {
      status: "pending", challenge: "a".repeat(43), deviceName: "Front Desk", environment: "preview",
      clientVersion: "1.0.0", deviceId: "dev_abcdefghijklmnopqrstuv", adminId: null,
      userCodeHash: "b".repeat(64), expiresAt: new Date(now + 600_000).toISOString(),
    };
    const hash = "c".repeat(64);
    expect(await store.savePending(hash, pending, 600)).toBe("ok");
    expect(ttlWrites).toEqual([{ ex: 600, nx: true }, { ex: 600, nx: true }]);
    const claim = (challenge: string) => store.claim(hash, challenge, "d".repeat(64), 2_592_000,
      new Date(now + 2_592_000_000).toISOString(), new Date(now).toISOString());
    expect(await claim("z".repeat(43))).toBe("rejected");
    expect(await claim(pending.challenge)).toBe("pending");
    expect(calls).toHaveLength(0);
    values.set(`itrader:stock-desktop:preview:pending:${hash}`, { ...pending, status: "approved", adminId: ADMIN_A });
    expect(await claim(pending.challenge)).toBe("issued");
    expect(calls[0]?.keys).toEqual([
      `itrader:stock-desktop:preview:pending:${hash}`,
      `itrader:stock-desktop:preview:session:${"d".repeat(64)}`,
      `itrader:stock-desktop:preview:device:${pending.deviceId}`,
      `itrader:stock-desktop:preview:admin:${ADMIN_A}`,
      `itrader:stock-desktop:preview:user:${pending.userCodeHash}`,
    ]);
    const script = calls[0]?.script ?? "";
    expect(script).toContain("data.adminId ~= ARGV[4]");
    expect(script.indexOf("data.challenge")).toBeLessThan(script.indexOf("redis.call('SET'"));
    expect(script).not.toMatch(/redis\.call\([^\n]*ARGV\[\d+\]\s*\.\./);
    // Adapter contract test, not a claim that a real Redis/Lua server ran.
    redis.eval = async () => { throw new Error("redis down"); };
    await expect(store.consumeRate("begin:test", 5, 600)).rejects.toBeInstanceOf(DesktopStoreUnavailable);
    const { deps } = harness();
    const failing: DesktopStore = { ...deps.store, consumeRate: async () => { throw new DesktopStoreUnavailable(); } };
    const down = await post({ ...deps, store: failing }, {
      op: "begin", deviceName: "Front Desk", codeChallenge: challenge(verifier()), environment: "preview", clientVersion: "1.0.0",
    });
    expect(down).toMatchObject({ status: 503, error: "unavailable" });
    expect(JSON.stringify(down)).not.toContain("redis down");
  });

  it("revokes only the approving admin's computer", async () => {
    const { deps } = harness(new Map([[ADMIN_A, account(ADMIN_A)], [ADMIN_B, account(ADMIN_B)]]));
    const { secret, started } = await paired(deps);
    await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, userCode: String(started.body.userCode),
    });
    const issued = await post(deps, { op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const deviceId = String(issued.body.deviceId);
    expect(await revokeDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_B, deviceId,
    })).toMatchObject({ error: "invalid_grant" });
    expect(await listDesktopDevices(deps, ADMIN_A)).toHaveLength(1);
    expect(await listDesktopDevices(deps, ADMIN_B)).toEqual([]);
    expect(await revokeDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, deviceId,
    })).toMatchObject({ ok: true });
    expect(await post(deps, { op: "session" }, `Bearer ${String(issued.body.accessToken)}`)).toMatchObject({ error: "unauthorized" });
  });
});
