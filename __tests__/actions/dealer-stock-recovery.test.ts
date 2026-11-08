import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: vi.fn(), availability: vi.fn(), rate: vi.fn(), recover: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/deployment/dealer-stock-sync", () => ({ getDealerStockSyncAvailability: mocks.availability }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/dealer-stock-sync/apply-recovery-store", () => ({ recoverApprovedStock: mocks.recover }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { recoverDealerStockReport } from "@/actions/admin/dealer-stock-recovery";

const input = { operation: "retry", reportId: "report", fingerprint: "a".repeat(64), expectedJobId: "failed" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue({ id: "admin" });
  mocks.availability.mockReturnValue({ enabled: true });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.recover.mockResolvedValue({ data: { jobId: "retry", dealerId: "dealer", status: "queued" } });
});

describe("stock recovery action boundary", () => {
  it("requires ADMIN before accessing the store", async () => {
    mocks.role.mockRejectedValue(new Error("Forbidden"));
    await expect(recoverDealerStockReport(input)).rejects.toThrow("Forbidden");
    expect(mocks.role).toHaveBeenCalledWith("ADMIN");
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });

  it("fails closed when stock review is unavailable", async () => {
    mocks.availability.mockReturnValue({ enabled: false, reason: "Unavailable here" });
    expect(await recoverDealerStockReport(input)).toEqual({ error: "Unavailable here" });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("rate limits the authenticated actor before mutation", async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect(await recoverDealerStockReport(input)).toHaveProperty("error", expect.stringContaining("Too many"));
    expect(mocks.rate).toHaveBeenCalledWith("dealer-stock-sync:admin", expect.objectContaining({ policy: "dealer-stock-sync" }));
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, expectedJobId: undefined },
    { ...input, fingerprint: "not-a-fingerprint" },
    { ...input, actorId: "forged" },
    { ...input, operation: "approve" },
    { operation: "fresh", reportId: "", fingerprint: input.fingerprint },
  ])("rejects malformed or extra client fields: %j", async invalid => {
    expect(await recoverDealerStockReport(invalid)).toHaveProperty("error", expect.stringContaining("invalid"));
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["retry", "fresh"])("passes the authenticated actor and revalidates after %s", async operation => {
    const request = operation === "retry" ? input : { operation, reportId: input.reportId, fingerprint: input.fingerprint };
    expect(await recoverDealerStockReport(request)).toHaveProperty("data.jobId", "retry");
    expect(mocks.recover).toHaveBeenCalledWith(request, "admin");
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([
      "/admin/stock-reviews", "/admin/dealers", "/admin/dealers/dealer/stock-sync",
    ]);
  });

  it("preserves actionable refusals without reporting successful mutation", async () => {
    mocks.recover.mockResolvedValue({ error: "Run a fresh check." });
    expect(await recoverDealerStockReport(input)).toEqual({ error: "Run a fresh check." });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("reports uncertain outcomes without exposing database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.recover.mockRejectedValue(Object.assign(new Error("private database details"), { code: "P2034" }));
      expect(await recoverDealerStockReport(input)).toEqual({
        error: "Recovery could not be confirmed. Refresh the results and check the current task before trying again.",
      });
      expect(log).toHaveBeenCalledWith("Stock report recovery failed.", {
        reportId: "report", operation: "retry", code: "P2034",
      });
      expect(mocks.revalidate).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
