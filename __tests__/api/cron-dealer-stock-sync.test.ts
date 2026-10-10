import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorized, enqueue } = vi.hoisted(() => ({
  authorized: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/ops/safety", () => ({ isCronAuthorized: authorized }));
vi.mock("@/lib/dealer-stock-sync/enqueue", () => ({ enqueueDueWeeklyScrapes: enqueue }));

const { GET } = await import("@/app/api/cron/dealer-stock-sync/route");

describe("dealer stock sync cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEALER_STOCK_SYNC_TARGET", "local");
    vi.stubEnv("DEALER_STOCK_SYNC_ISOLATED_LOCAL", "1");
    for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "postgresql://fixture@127.0.0.1:5432/test");
    authorized.mockReturnValue(true);
    enqueue.mockResolvedValue({ due: false, weeklyKey: "2026-W25", queued: 0, skipped: 0 });
  });

  it("does not enqueue production jobs while the rollout flag is off", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DEALER_STOCK_SYNC_PRODUCTION_ENABLED", "0");
    const response = await GET(new Request("https://itrader.im/api/cron/dealer-stock-sync") as never);
    expect(response.status).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a missing cron secret before enqueueing", async () => {
    authorized.mockReturnValue(false);
    const response = await GET(new Request("https://example.test/api/cron/dealer-stock-sync") as never);
    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns the weekly enqueue summary and does not apply plans", async () => {
    const response = await GET(
      new Request("https://example.test/api/cron/dealer-stock-sync", {
        headers: { authorization: "Bearer secret" },
      }) as never,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { due: false, weeklyKey: "2026-W25", queued: 0, skipped: 0 },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
