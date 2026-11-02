import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ redeem: vi.fn(), deps: vi.fn() }));
vi.mock("@/lib/dealer-stock-sync/desktop-launch", () => ({ liveLaunchDependencies: mocks.deps, redeemDesktopLaunch: mocks.redeem }));
import { POST } from "@/app/api/stock-worker/launch/route";
beforeEach(() => { vi.clearAllMocks(); mocks.deps.mockReturnValue({}); });
it("rejects oversized or malformed launch requests before redemption", async () => {
  for (const body of ["x".repeat(16 * 1024 + 1), "{", ""]) {
    const response = await POST(new Request("https://itrader.dev/api/stock-worker/launch", {
      method: "POST", headers: { "content-type": "application/json" }, body,
    }));
    expect(response.status).toBe(400);
  }
  expect(mocks.redeem).not.toHaveBeenCalled();
});
it("uses no-store without CORS and forwards only the bearer to redemption", async () => {
  mocks.redeem.mockResolvedValue({ status: 400, body: { error: "invalid_grant" } });
  const response = await POST(new Request("https://itrader.dev/api/stock-worker/launch", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer example" },
    body: JSON.stringify({ op: "redeem", ticket: "x".repeat(43), deviceName: "Computer", clientVersion: "1.1.11" }),
  }));
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(mocks.redeem).toHaveBeenCalledWith({}, expect.objectContaining({ authorization: "Bearer example" }));
});
