/* @vitest-environment node */

import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const { getDependencies } = vi.hoisted(() => ({ getDependencies: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/desktop-service", async (original) => ({
  ...await original<typeof import("@/lib/dealer-stock-sync/desktop-service")>(),
  liveDesktopDependencies: getDependencies,
}));
import { GET, OPTIONS, POST } from "@/app/api/stock-worker/route";
import { memoryDesktopDependencies } from "@/lib/dealer-stock-sync/desktop-service";
import { unavailableDesktopStore } from "@/lib/dealer-stock-sync/desktop-store";

const CERT = "-----BEGIN CERTIFICATE-----\nMIIBTESTCERTIFICATE\n-----END CERTIFICATE-----";
const ADMIN_A = "cadmin0000000000000000001";
const PRIVATE_KEY = "private_test_key_value_0123456789";

function databaseUrl(password: string): string {
  return `postgresql://postgres:${password}@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres`;
}

function env(): Record<string, string> {
  const project = "syneonzucehwlghqmfbg";
  const worker = {
    DEALER_STOCK_SYNC_TARGET: "preview",
    VERCEL_ENV: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NODE_ENV: "production",
    DEALER_STOCK_SYNC_WORKER: "1",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl("worker-secret"),
    POSTGRES_URL: databaseUrl("worker-secret"),
    POSTGRES_URL_NON_POOLING: databaseUrl("worker-secret"),
    SUPABASE_DB_CA_CERT: CERT,
    MEDIA_PROVIDER: "imagekit",
    NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit",
    MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1",
    IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    IMAGEKIT_PUBLIC_KEY: "public_test_key",
    IMAGEKIT_PRIVATE_KEY: PRIVATE_KEY,
  };
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: ADMIN_A,
    DEALER_STOCK_DESKTOP_CONFIG_JSON: JSON.stringify({ [ADMIN_A]: worker }),
    VERCEL_ENV: "preview",
    DEALER_STOCK_SYNC_TARGET: "preview",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: `https://${project}.supabase.co`,
    DATABASE_URL: databaseUrl("app-secret"),
    POSTGRES_URL: databaseUrl("app-secret"),
    POSTGRES_URL_NON_POOLING: databaseUrl("app-secret"),
  };
}

function install(store?: ReturnType<typeof unavailableDesktopStore>) {
  const deps = memoryDesktopDependencies(env(), () => Date.parse("2026-10-16T12:00:00.000Z"), {
    async findById(id: string) {
      return id === ADMIN_A ? { id, name: "Stock Admin", email: "stock-admin@example.com", role: "ADMIN", disabledAt: null, deletedAt: null } : null;
    },
  });
  getDependencies.mockReturnValue(store ? { ...deps, store } : deps);
  return deps;
}

function request(body: unknown, url = "https://itrader.dev/api/stock-worker", headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/stock-worker", () => {
  afterEach(() => {
    getDependencies.mockReset();
  });

  it("bounds a streamed body without trusting content-length", async () => {
    install();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(8193)); controller.close();
    } });
    const request = new Request("https://itrader.dev/api/stock-worker", {
      method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
    } as RequestInit);
    expect((await POST(request)).status).toBe(400);
  });

  it("returns the pairing contract without store secrets or CORS", async () => {
    install();
    const secret = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(secret).digest("base64url");
    const response = await POST(request({
      op: "begin",
      deviceName: "Front Desk",
      codeChallenge: challenge,
      environment: "preview",
      clientVersion: "1.0.0",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = await response.json() as { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };
    expect(body.expiresIn).toBe(600);
    expect(body.interval).toBe(5);
    expect(body.verificationUri).toBe(`https://itrader.dev/admin/stock-worker?code=${body.userCode}`);
    expect(body.deviceCode).toHaveLength(43);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_KEY);
    const pending = await POST(request({ op: "poll", deviceCode: body.deviceCode, codeVerifier: secret }));
    expect(pending.status).toBe(202);
    await expect(pending.json()).resolves.toEqual({ status: "pending" });
  });

  it("rejects query credentials, GET approval, oversized bodies, and a missing bearer", async () => {
    install();
    const queried = await POST(request({ op: "session" }, "https://itrader.dev/api/stock-worker?access_token=secret"));
    expect(queried.status).toBe(400);
    expect(queried.headers.get("access-control-allow-origin")).toBeNull();
    expect(GET().status).toBe(405);
    expect(OPTIONS().status).toBe(405);
    expect(OPTIONS().headers.get("access-control-allow-origin")).toBeNull();
    const oversized = await POST(request("x".repeat(8193)));
    expect(oversized.status).toBe(400);
    const missing = await POST(request({ op: "session", includeConfig: true }));
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("never returns configuration after authorisation and fails closed without redis", async () => {
    const deps = install();
    const secret = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(secret).digest("base64url");
    const started = await POST(request({
      op: "begin", deviceName: "Front Desk", codeChallenge: challenge, environment: "preview", clientVersion: "1.0.0",
    }));
    const pairing = await started.json() as { deviceCode: string; userCode: string };
    const { approveDesktopDevice } = await import("@/lib/dealer-stock-sync/desktop-service");
    expect(await approveDesktopDevice(deps, {
      origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null, adminId: ADMIN_A, userCode: pairing.userCode,
    })).toMatchObject({ ok: true });
    const issued = await POST(request({ op: "poll", deviceCode: pairing.deviceCode, codeVerifier: secret }));
    expect(issued.status).toBe(200);
    const token = (await issued.json() as { accessToken: string }).accessToken;
    const plain = await POST(request({ op: "session" }, undefined, { authorization: `Bearer ${token}` }));
    const plainBody = await plain.json() as Record<string, unknown>;
    expect(plain.status).toBe(200);
    expect(plainBody).not.toHaveProperty("config");
    expect(JSON.stringify(plainBody)).not.toContain(PRIVATE_KEY);
    const configured = await POST(request({ op: "session", includeConfig: true }, undefined, { authorization: `Bearer ${token}` }));
    const configuredBody = await configured.json() as Record<string, unknown>;
    expect(configured.status).toBe(400);
    expect(configured.headers.get("cache-control")).toContain("no-store");
    expect(configuredBody).toEqual({ error: "invalid_request" });
    expect(JSON.stringify(configuredBody)).not.toContain(PRIVATE_KEY);
    expect(JSON.stringify(configuredBody)).not.toContain("worker-secret");
    expect(JSON.stringify(configuredBody)).not.toContain("app-secret");

    install(unavailableDesktopStore());
    const down = await POST(request({
      op: "begin", deviceName: "Front Desk", codeChallenge: challenge, environment: "preview", clientVersion: "1.0.0",
    }));
    expect(down.status).toBe(503);
    await expect(down.json()).resolves.toEqual({ error: "unavailable" });
  });
});
