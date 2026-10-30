import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), rate: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.auth }));
vi.mock("@/lib/policy/gate", () => ({ acceptedAuthHttpStatus: (e: { status?: number }) => e.status ?? 500 }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, makeRateLimitKey: (_: string, id: string) => id, toRateLimitDenial: (r: { allowed: boolean }) => r.allowed ? null : { status: 429, message: "Wait", retryAfterSeconds: 5 } }));
vi.mock("@/lib/monitoring", () => ({ captureException: mocks.capture }));
vi.mock("@/app/(admin)/admin/stock-reviews/snapshot-loader", () => ({ loadStockReviewSnapshot: mocks.load }));
import { GET } from "@/app/api/admin/stock-reviews/snapshot/route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin" }); mocks.rate.mockResolvedValue({ allowed: true }); mocks.load.mockResolvedValue({ jobs: [] }); });
describe("stock snapshot access", () => {
  it.each([401, 403])("refuses %s before reading stock", async status => {
    mocks.auth.mockRejectedValue({ status }); const response = await GET();
    expect(response.status).toBe(status); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("returns uncached admin data", async () => {
    const response = await GET(); expect(mocks.auth).toHaveBeenCalledWith("ADMIN");
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ jobs: [] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("limits repeated reads without loading data", async () => {
    mocks.rate.mockResolvedValue({ allowed: false }); const response = await GET();
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("5"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("records server failure without leaking its details", async () => {
    mocks.load.mockRejectedValue(new Error("private database details")); const response = await GET();
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private database details"); expect(mocks.capture).toHaveBeenCalledOnce();
  });
});
