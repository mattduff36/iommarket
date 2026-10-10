import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, db, logAdminAction } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  logAdminAction: vi.fn(),
  db: {
    dealerProfile: { findUnique: vi.fn() },
    dealerStockSourceBinding: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    dealerStockSyncJob: { findFirst: vi.fn(), create: vi.fn() },
    dealerStockSyncReport: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ requireRole }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, resetAt: 0, unavailable: false })),
}));

const { approveDealerStockReport, saveDealerStockBinding } = await import(
  "@/actions/admin/dealer-stock-sync"
);

const liveDealer = {
  id: "dealer-1",
  isAdminPreview: false,
  user: { role: "DEALER" as const, disabledAt: null, deletedAt: null },
};

describe("admin dealer stock sync actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("DEALER_STOCK_SYNC_TARGET", "local");
    vi.stubEnv("DEALER_STOCK_SYNC_ISOLATED_LOCAL", "1");
    for (const key of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"]) vi.stubEnv(key, "postgresql://fixture@127.0.0.1:5432/test");
    requireRole.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  });

  it("keeps production disabled before any database access", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DEALER_STOCK_SYNC_PRODUCTION_ENABLED", "0");
    const result = await saveDealerStockBinding({ dealerId: "dealer-1", registryKey: "franklins" });
    expect(result.error).toMatch(/disabled in production/);
    expect(db.dealerProfile.findUnique).not.toHaveBeenCalled();
    expect(db.dealerStockSourceBinding.upsert).not.toHaveBeenCalled();
  });

  it("requires an admin before reading or writing a binding", async () => {
    requireRole.mockRejectedValue(new Error("Insufficient permissions"));
    await expect(saveDealerStockBinding({ dealerId: "dealer-1", registryKey: "franklins" })).rejects.toThrow(
      /permissions/i,
    );
    expect(db.dealerStockSourceBinding.upsert).not.toHaveBeenCalled();
  });

  it("rejects an arbitrary source and does not upsert", async () => {
    const result = await saveDealerStockBinding({
      dealerId: "dealer-1",
      registryKey: "https://evil.example/stock",
    });
    expect(result).toEqual({ error: "Choose a registry source." });
    expect(db.dealerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a superseded report without queueing an apply job", async () => {
    db.dealerStockSyncReport.findUnique.mockResolvedValue({
      id: "report-1",
      status: "SUPERSEDED",
      fingerprint: "a".repeat(64),
      bindingId: "binding-1",
      dealerId: "dealer-1",
    });
    const result = await approveDealerStockReport({
      reportId: "report-1",
      fingerprint: "a".repeat(64),
    });
    expect(result).toEqual({ error: "This review is stale." });
    expect(db.dealerStockSyncJob.create).not.toHaveBeenCalled();
    expect(db.dealerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("does not bind a preview dealer", async () => {
    db.dealerProfile.findUnique.mockResolvedValue({ ...liveDealer, isAdminPreview: true });
    const result = await saveDealerStockBinding({ dealerId: "dealer-1", registryKey: "franklins" });
    expect(result).toEqual({ error: "This dealer account cannot sync website stock." });
    expect(db.dealerStockSourceBinding.upsert).not.toHaveBeenCalled();
  });
});
