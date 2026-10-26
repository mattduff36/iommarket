/* @vitest-environment node */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveDesktopDevice,
  handleDesktopPost,
  memoryDesktopDependencies,
  type DesktopAccount,
  type DesktopDependencies,
} from "@/lib/dealer-stock-sync/desktop-service";

const { getDependencies } = vi.hoisted(() => ({ getDependencies: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/worker-control", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dealer-stock-sync/worker-control")>(
    "@/lib/dealer-stock-sync/worker-control",
  );
  return { ...actual, createWorkerControlDependencies: getDependencies };
});

import { GET, OPTIONS, POST, maxDuration, runtime } from "@/app/api/stock-worker/control/route";
import { memoryWorkerControlDependencies, type WorkerControlDependencies } from "@/lib/dealer-stock-sync/worker-control";

const ADMIN = "cadmin0000000000000000001";
const MAX_BODY_BYTES = 16 * 1024;

function apiEnv(): Record<string, string> {
  const databaseUrl = "postgresql://postgres:app-secret@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres";
  return {
    DEALER_STOCK_DESKTOP_ENABLED: "1",
    DEALER_STOCK_DESKTOP_API_ONLY: "1",
    DEALER_STOCK_DESKTOP_ALLOWED_ADMIN_IDS: ADMIN,
    VERCEL_ENV: "preview",
    DEALER_STOCK_SYNC_TARGET: "preview",
    NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
    DATABASE_URL: databaseUrl,
    POSTGRES_URL: databaseUrl,
    POSTGRES_URL_NON_POOLING: databaseUrl,
  };
}

function depsFor(): WorkerControlDependencies {
  const now = Date.parse("2026-10-22T20:00:00.000Z");
  const account: DesktopAccount = {
    id: ADMIN, name: "Stock Admin", email: "stock-admin@example.com", role: "ADMIN", disabledAt: null, deletedAt: null,
  };
  const desktop = memoryDesktopDependencies(apiEnv(), () => now, { async findById(id) { return id === ADMIN ? account : null; } });
  return memoryWorkerControlDependencies(desktop, () => now);
}

async function issue(desktop: DesktopDependencies) {
  const secret = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(secret).digest("base64url");
  const post = (body: unknown, authorization: string | null = null) => handleDesktopPost(desktop, {
    body, authorization, ip: "203.0.113.10", hasQuery: false,
  });
  const started = await post({
    op: "begin", deviceName: "Front Desk", codeChallenge: challenge, environment: "preview", clientVersion: "1.2.0",
  });
  if (!started.ok) throw new Error("pairing did not start");
  await approveDesktopDevice(desktop, {
    origin: "https://itrader.dev", host: "itrader.dev", forwardedHost: null,
    adminId: ADMIN, userCode: String(started.body.userCode),
  });
  const issued = await post({ op: "poll", deviceCode: started.body.deviceCode, codeVerifier: secret });
  if (!issued.ok) throw new Error("session was not issued");
  return `Bearer ${String(issued.body.accessToken)}`;
}

function request(body: unknown, options: { url?: string; headers?: Record<string, string> } = {}) {
  return new Request(options.url ?? "https://itrader.dev/api/stock-worker/control", {
    method: "POST",
    headers: { "content-type": "application/json", ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  } });
  return new Request("https://itrader.dev/api/stock-worker/control", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);
}

describe("POST /api/stock-worker/control", () => {
  afterEach(() => vi.resetAllMocks());

  it("returns an authorised heartbeat without cookies, query, or CORS", async () => {
    const deps = depsFor();
    getDependencies.mockReturnValue(deps);
    const authorization = await issue(deps.desktop);
    const heartbeat = {
      op: "heartbeat",
      instanceId: "11111111-1111-4111-8111-111111111111",
      state: "running",
      activity: [{ sequence: 1, code: "processing", at: "2026-10-22T20:00:00.000Z" }],
      acknowledgedCommandId: null,
    };
    const response = await POST(request(heartbeat, { headers: { authorization } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, command: null });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(15);

    const missing = request(heartbeat, { headers: { cookie: `accessToken=${authorization}` } });
    const denied = await POST(missing);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });
    const query = await POST(request(heartbeat, {
      url: "https://itrader.dev/api/stock-worker/control?token=scoped-token",
      headers: { authorization },
    }));
    expect(query.status).toBe(400);
    expect(getDependencies).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized, raw, and non-JSON bodies and hides store failures", async () => {
    const deps = depsFor();
    getDependencies.mockReturnValue(deps);
    const bytes = new Uint8Array(MAX_BODY_BYTES + 1);
    expect((await POST(streamRequest([bytes.subarray(0, 100), bytes.subarray(100)]))).status).toBe(400);
    expect((await POST(request({ op: "heartbeat" }, { headers: { "content-length": String(MAX_BODY_BYTES + 1) } }))).status).toBe(400);
    const raw = await POST(request({
      op: "heartbeat",
      instanceId: "11111111-1111-4111-8111-111111111111",
      state: "waiting",
      activity: [],
      acknowledgedCommandId: null,
      output: "secret scrape output",
    }));
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: "invalid_request" });
    expect(JSON.stringify({ error: "invalid_request" })).not.toContain("secret scrape output");
    for (const item of [
      request("{"),
      request({ op: "heartbeat" }, { headers: { "content-type": "text/plain" } }),
      streamRequest([new Uint8Array([0xc3, 0x28])]),
    ]) {
      expect((await POST(item)).status).toBe(400);
    }
    expect(getDependencies).toHaveBeenCalledTimes(1);
    getDependencies.mockImplementation(() => { throw new Error("postgres://password@internal"); });
    const down = await POST(request({
      op: "heartbeat", instanceId: "11111111-1111-4111-8111-111111111111", state: "waiting", activity: [], acknowledgedCommandId: null,
    }));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
    for (const denied of [GET(), OPTIONS()]) {
      expect(denied.status).toBe(405);
      expect(denied.headers.get("allow")).toBe("POST");
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
