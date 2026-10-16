/* @vitest-environment node */
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { authoriseDesktopSession, DesktopAccessError } from "@/scripts/dealer-stock-sync/desktop-access";
import { parseDesktopMode, readDesktopBootstrap, validateDesktopBootstrap, workerLineEvent } from "@/scripts/dealer-stock-sync/desktop-worker";
import { processTick } from "@/scripts/dealer-stock-sync/worker-cli";

const token = "t".repeat(43);
const now = Date.parse("2026-10-16T12:00:00Z");
function response(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: token, deviceId: "dev_" + "d".repeat(22), environment: "preview",
    expiresAt: new Date(now + 60_000).toISOString(), account: { id: "admin-1", name: "Test", email: "test@example.com" },
    ...overrides,
  };
}
function config(): Record<string, string> {
  return {
    DEALER_STOCK_SYNC_TARGET: "preview", VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging",
    NODE_ENV: "production", DEALER_STOCK_SYNC_WORKER: "1", NEXT_PUBLIC_APP_URL: "https://itrader.dev",
    NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
    DATABASE_URL: "postgresql://postgres:synthetic@db.syneonzucehwlghqmfbg.supabase.co:5432/postgres",
    SUPABASE_DB_CA_CERT: "-----BEGIN CERTIFICATE-----\nSYNTHETIC-TEST-CERTIFICATE\n-----END CERTIFICATE-----",
    MEDIA_PROVIDER: "imagekit", NEXT_PUBLIC_MEDIA_PROVIDER: "imagekit", MEDIA_UPLOAD_PROVIDER: "imagekit",
    IMAGEKIT_UPLOADS_ENABLED: "1", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/itraderim",
    IMAGEKIT_PUBLIC_KEY: "public_test_key", IMAGEKIT_PRIVATE_KEY: "private_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  };
}

describe("desktop worker access", () => {
  it("uses a canonical HTTPS POST, bearer header, and no redirects or config request", async () => {
    const fetcher = vi.fn(async () => Response.json(response())) as unknown as typeof fetch;
    await expect(authoriseDesktopSession("preview", token, { fetcher, now: () => now })).resolves.toMatchObject({ accountId: "admin-1" });
    expect(fetcher).toHaveBeenCalledWith("https://itrader.dev/api/stock-worker", expect.objectContaining({
      method: "POST", redirect: "error", body: JSON.stringify({ op: "session", includeConfig: false }),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    }));
  });
  it.each([401, 403, 429, 500, 503, 302])("denies HTTP %i before taking another job", async (status) => {
    const fetcher = vi.fn(async () => new Response("not a secret-bearing error", { status })) as unknown as typeof fetch;
    await expect(authoriseDesktopSession("preview", token, { fetcher, now: () => now })).rejects.toBeInstanceOf(DesktopAccessError);
  });
  it.each([
    { environment: "production" }, { expiresAt: "invalid" }, { expiresAt: new Date(now).toISOString() },
    { accessToken: "x".repeat(43) }, { deviceId: "untrusted" }, { account: null },
  ])("rejects mismatched/corrupt identity %#", async (patch) => {
    const fetcher = vi.fn(async () => Response.json(response(patch))) as unknown as typeof fetch;
    await expect(authoriseDesktopSession("preview", token, { fetcher, now: () => now })).rejects.toBeInstanceOf(DesktopAccessError);
  });
  it("redacts network errors and bounds response data", async () => {
    const fetcher = vi.fn(async () => { throw new Error(`private internal detail ${token}`); }) as unknown as typeof fetch;
    await expect(authoriseDesktopSession("preview", token, { fetcher })).rejects.not.toThrow(token);
    const large = vi.fn(async () => new Response(" ".repeat(65_537))) as unknown as typeof fetch;
    await expect(authoriseDesktopSession("preview", token, { fetcher: large })).rejects.toBeInstanceOf(DesktopAccessError);
  });
});

describe("desktop bootstrap", () => {
  it("validates a single explicit config without borrowing process credentials", () => {
    const value = { environment: "preview", accessToken: token, config: config() };
    expect(validateDesktopBootstrap(value)).toEqual(value);
    expect(() => validateDesktopBootstrap({ ...value, config: { ...value.config, NODE_OPTIONS: "--inspect" } })).toThrow();
    expect(() => validateDesktopBootstrap({ ...value, environment: "production" })).toThrow();
    const noDb = { ...value.config }; delete noDb.DATABASE_URL;
    expect(() => validateDesktopBootstrap({ ...value, config: noDb })).toThrow();
  });
  it("reads only a bounded newline-terminated first frame", async () => {
    const pipe = new PassThrough();
    const read = readDesktopBootstrap(pipe);
    pipe.write('{"hello":"world"}\n');
    await expect(read).resolves.toEqual({ hello: "world" });
    expect(pipe.destroyed).toBe(false);
    pipe.destroy();
  });
  it("refuses early EOF and oversized input", async () => {
    const ended = new PassThrough();
    const read = readDesktopBootstrap(ended);
    ended.end();
    await expect(read).rejects.toThrow("closed");
    const large = new PassThrough();
    const oversized = readDesktopBootstrap(large);
    large.write(Buffer.alloc(65_537));
    await expect(oversized).rejects.toThrow("large");
    large.destroy();
  });
  it("has only manual check/watch modes and never claims generic completion is success", () => {
    expect(parseDesktopMode(["--mode", "check"])).toBe("check");
    expect(parseDesktopMode(["--mode", "watch"])).toBe("watch");
    expect(() => parseDesktopMode(["--mode", "watch", "--weekly"])).toThrow();
    expect(workerLineEvent("Finished processing job job-1. Check its result in the admin page.\n")?.state).toBe("processing-finished");
    expect(workerLineEvent(`unexpected private_${token}`)).toBeNull();
  });
});

describe("authorisation and safe stop before a lease", () => {
  function tick() {
    return {
      env: config(), manual: true, isStopped: () => false, enqueueWeekly: vi.fn(),
      leaseOneJob: vi.fn(async () => ({ id: "job-1", owner: "test" })),
      runJob: vi.fn(async () => undefined), write: vi.fn(),
    };
  }
  it("does not lease on authorisation failure", async () => {
    const input = tick();
    await expect(processTick({ ...input, authorise: async () => { throw new DesktopAccessError("unavailable"); } })).rejects.toBeInstanceOf(DesktopAccessError);
    expect(input.leaseOneJob).not.toHaveBeenCalled();
    expect(input.enqueueWeekly).not.toHaveBeenCalled();
  });
  it("observes stop arriving while authorisation is in flight", async () => {
    const input = tick(); let stopped = false;
    expect(await processTick({ ...input, isStopped: () => stopped, authorise: async () => { stopped = true; } })).toBe(false);
    expect(input.leaseOneJob).not.toHaveBeenCalled();
  });
  it("rechecks authorisation on every tick and never enables weekly scheduling", async () => {
    const input = tick(); const authorise = vi.fn(async () => undefined);
    await processTick({ ...input, authorise }); await processTick({ ...input, authorise });
    expect(authorise).toHaveBeenCalledTimes(2); expect(input.runJob).toHaveBeenCalledTimes(2);
    expect(input.enqueueWeekly).not.toHaveBeenCalled();
  });
});
