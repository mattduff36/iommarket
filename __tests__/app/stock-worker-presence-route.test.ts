import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), allowed: vi.fn(), rate: vi.fn(), dashboard: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/dealer-stock-sync/desktop-config", () => ({ desktopAccountEnabled: mocks.allowed }));
vi.mock("@/lib/dealer-stock-sync/worker-control", () => ({
  createWorkerControlDependencies: () => ({ desktop: { store: { consumeRate: mocks.rate } } }), readWorkerDashboard: mocks.dashboard,
}));
import { GET } from "@/app/api/admin/stock-reviews/presence/route";
beforeEach(() => {
  vi.clearAllMocks(); mocks.role.mockResolvedValue({ id: "admin" }); mocks.allowed.mockReturnValue(true);
  mocks.rate.mockResolvedValue(true); mocks.dashboard.mockResolvedValue({ ok: true, devices: [] });
});
it("checks allowlist and rate before opening a presence stream", async () => {
  mocks.allowed.mockReturnValue(false);
  expect((await GET(new Request("https://itrader.dev/api/admin/stock-reviews/presence"))).status).toBe(403);
  expect(mocks.dashboard).not.toHaveBeenCalled();
  mocks.allowed.mockReturnValue(true); mocks.rate.mockResolvedValue(false);
  expect((await GET(new Request("https://itrader.dev/api/admin/stock-reviews/presence"))).status).toBe(429);
});
it("sends scoped presence and closes cleanly on browser disconnect", async () => {
  const abort = new AbortController();
  const response = await GET(new Request("https://itrader.dev/api/admin/stock-reviews/presence", { signal: abort.signal }));
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  expect(response.headers.get("cache-control")).toContain("no-store");
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("retry: 1000");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: {"ok":true,"devices":[]}');
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  expect(mocks.dashboard).toHaveBeenCalledWith(expect.anything(), "admin");
});
