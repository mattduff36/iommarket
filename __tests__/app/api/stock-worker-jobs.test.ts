/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
const { getDependencies } = vi.hoisted(() => ({ getDependencies: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/desktop-job-executor", () => ({
  createDesktopJobDependencies: getDependencies,
}));
import { GET, OPTIONS, POST, maxDuration, runtime } from "@/app/api/stock-worker/jobs/route";
import type { DesktopJobDependencies } from "@/lib/dealer-stock-sync/desktop-jobs";
import { randomBytes } from "node:crypto";

function install(overrides: Partial<DesktopJobDependencies> = {}) {
  const deps: DesktopJobDependencies = {
    env: { DEALER_STOCK_DESKTOP_API_ONLY: "1" },
    now: () => new Date(),
    authorize: vi.fn(async (header: string | null) => header === "Bearer scoped-token"
      ? { ok: true as const, principal: { adminId: "admin", deviceId: "device", environment: "preview" as const } }
      : { ok: false as const, status: 401 as const, error: "unauthorized" as const }),
    assertEnvironment: () => "preview",
    consumeRate: vi.fn(async () => true),
    randomBytes,
    leaseOneJob: vi.fn(async () => null),
    runLeasedJob: vi.fn(async () => undefined),
    jobs: { findById: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
    bindings: { findById: vi.fn(async () => null) },
    reports: { findById: vi.fn(async () => null) },
    readiness: vi.fn(async () => true),
    failScrape: vi.fn(async () => "lost" as const),
    applyStep: vi.fn(async () => ({ outcome: "unavailable" as const })),
    ...overrides,
  };
  getDependencies.mockReturnValue(deps);
  return deps;
}

function request(body: unknown, options: { url?: string; headers?: Record<string, string> } = {}) {
  return new Request(options.url ?? "https://itrader.dev/api/stock-worker/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer scoped-token", ...options.headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}, error?: Error) {
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    if (error) controller.error(error); else controller.close();
  } });
  return new Request("https://itrader.dev/api/stock-worker/jobs", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer scoped-token", ...headers },
    body, duplex: "half",
  } as RequestInit);
}

describe("POST /api/stock-worker/jobs integration", () => {
  afterEach(() => vi.resetAllMocks());

  it("runs the authenticated service and returns a minimal uncached check without leasing work", async () => {
    const deps = install();
    const response = await POST(request({ op: "check" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true });
    expect(deps.authorize).toHaveBeenCalledWith("Bearer scoped-token");
    expect(deps.readiness).toHaveBeenCalledOnce();
    expect(deps.leaseOneJob).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(300);
  });

  it("authorises before work and does not forward cookies or query credentials", async () => {
    const deps = install();
    const missing = request({ op: "check" });
    missing.headers.delete("authorization");
    missing.headers.set("cookie", "accessToken=scoped-token");
    const denied = await POST(missing);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });
    expect(deps.readiness).not.toHaveBeenCalled();
    const query = await POST(request({ op: "lease" }, { url: "https://itrader.dev/api/stock-worker/jobs?token=scoped-token" }));
    expect(query.status).toBe(400);
    expect(deps.authorize).toHaveBeenCalledTimes(1);
    expect(deps.leaseOneJob).not.toHaveBeenCalled();
  });

  it("returns lease and rate-store outcomes through the real operation dispatcher", async () => {
    const deps = install();
    const leased = await POST(request({ op: "lease" }));
    expect(await leased.json()).toEqual({ job: null });
    expect(deps.leaseOneJob).toHaveBeenCalledOnce();
    install({ consumeRate: async () => false });
    const limited = await POST(request({ op: "lease" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    install({ consumeRate: async () => { throw new Error("redis://secret"); } });
    const down = await POST(request({ op: "lease" }));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
  });

  it("rejects every unsupported or client-authoritative shape before mutation", async () => {
    const deps = install();
    for (const body of [
      { op: "lease", dealerId: "forged" },
      { op: "step", jobId: "cjob000000000000000000001", leaseToken: "a".repeat(43), approval: true },
      { op: "submit", jobId: "cjob000000000000000000001", leaseToken: "a".repeat(43), result: {}, plan: {} },
      { op: "check", config: { DATABASE_URL: "secret" } },
      { op: "unknown" }, [],
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(deps.leaseOneJob).not.toHaveBeenCalled();
    expect(deps.runLeasedJob).not.toHaveBeenCalled();
    expect(deps.applyStep).not.toHaveBeenCalled();
  });

  it("bounds streamed bytes even when the declared length is absent or false", async () => {
    install();
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
    for (const headers of [{}, { "content-length": "1" }] as Array<Record<string, string>>) {
      const response = await POST(streamRequest([bytes.subarray(0, 100), bytes.subarray(100)], headers));
      expect(response.status).toBe(400);
    }
    expect(getDependencies).not.toHaveBeenCalled();
    expect((await POST(request({ op: "check" }, { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }))).status).toBe(400);
  });

  it("rejects invalid UTF-8, malformed JSON, failed streams and non-JSON types without exposing errors", async () => {
    install();
    const cases = [
      streamRequest([new Uint8Array([0xc3, 0x28])]),
      streamRequest([], {}, new Error("internal database password")),
      request("{"),
      request({ op: "check" }, { headers: { "content-type": "text/plain" } }),
      request({ op: "check" }, { headers: { "content-length": "-1" } }),
    ];
    for (const item of cases) {
      const response = await POST(item);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(getDependencies).not.toHaveBeenCalled();
  });

  it("fails closed on unexpected adapter errors and offers no browser CORS path", async () => {
    getDependencies.mockImplementation(() => { throw new Error("postgres://password@internal"); });
    const response = await POST(request({ op: "check" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    for (const denied of [GET(), OPTIONS()]) {
      expect(denied.status).toBe(405);
      expect(denied.headers.get("allow")).toBe("POST");
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});
