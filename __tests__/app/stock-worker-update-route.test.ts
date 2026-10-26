/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ staging: vi.fn(), role: vi.fn(), enabled: vi.fn(), auth: vi.fn(), rate: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/dealer-stock-sync/desktop-config", () => ({ desktopAccountEnabled: mocks.enabled, resolveDesktopGate: mocks.staging }));
vi.mock("@/lib/dealer-stock-sync/desktop-service", () => ({ authoriseDesktopRequest: mocks.auth, liveDesktopDependencies: () => ({ store: { consumeRate: mocks.rate } }) }));
vi.mock("@/lib/dealer-stock-sync/update-release", () => ({ getUpdateRelease: mocks.release }));
import { GET, POST } from "@/app/api/stock-worker/update/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.staging.mockReturnValue({ ok: true, gate: { environment: "preview" } });
  mocks.role.mockResolvedValue({ id: "admin" });
  mocks.enabled.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ ok: true, principal: { deviceId: "device", environment: "preview" } });
  mocks.rate.mockResolvedValue(true);
  mocks.release.mockResolvedValue({ payload: "signed", signature: "signature", downloadUrl: "https://example.test/fresh" });
});
describe("private environment-scoped installer access", () => {
  it("fails closed when the desktop gate is disabled without accessing storage", async () => {
    mocks.staging.mockReturnValue({ ok: false });
    expect((await GET(new Request("https://itrader.im/api/stock-worker/update"))).status).toBe(404);
    expect((await POST(new Request("https://itrader.im/api/stock-worker/update", { method: "POST" }))).status).toBe(404);
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rejects unauthorised and revoked devices", async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401 });
    expect((await POST(new Request("https://itrader.dev/api/stock-worker/update", { method: "POST" }))).status).toBe(401);
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rejects non-admin and disallowed accounts", async () => {
    mocks.role.mockRejectedValueOnce(new Error("denied"));
    expect((await GET(new Request("https://itrader.dev/api/stock-worker/update"))).status).toBe(401);
    mocks.enabled.mockReturnValue(false);
    expect((await GET(new Request("https://itrader.dev/api/stock-worker/update"))).status).toBe(403);
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it("rate limits downloads and hides infrastructure failures", async () => {
    mocks.rate.mockResolvedValueOnce(false);
    expect((await GET(new Request("https://itrader.dev/api/stock-worker/update"))).status).toBe(429);
    mocks.release.mockRejectedValue(new Error("sensitive internal error"));
    const response = await GET(new Request("https://itrader.dev/api/stock-worker/update"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("sensitive");
  });
  it("creates a fresh non-cacheable link on every authorised request", async () => {
    for (let i = 0; i < 2; i++) {
      const response = await GET(new Request("https://itrader.dev/api/stock-worker/update"));
      expect(response.status).toBe(302);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it("returns the signed envelope only to a preview device", async () => {
    const response = await POST(new Request("https://itrader.dev/api/stock-worker/update", { method: "POST" }));
    expect(response.status).toBe(200);
    expect((await response.json()).payload).toBe("signed");
    mocks.auth.mockResolvedValue({ ok: true, principal: { environment: "production" } });
    expect((await POST(new Request("https://itrader.dev/api/stock-worker/update", { method: "POST" }))).status).toBe(403);
  });
});

it("serves production only after its own gate and device authorisation pass", async () => {
  mocks.staging.mockReturnValue({ ok: true, gate: { environment: "production" } });
  mocks.auth.mockResolvedValue({ ok: true, principal: { deviceId: "prod", environment: "production" } });
  expect((await POST(new Request("https://itrader.im/api/stock-worker/update", { method: "POST" }))).status).toBe(200);
  mocks.auth.mockResolvedValue({ ok: true, principal: { deviceId: "preview", environment: "preview" } });
  expect((await POST(new Request("https://itrader.im/api/stock-worker/update", { method: "POST" }))).status).toBe(403);
});
