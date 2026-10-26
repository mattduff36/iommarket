import { describe, expect, it, vi } from "vitest";
import { persistCompleteScrape, persistFailedScrape } from "@/lib/dealer-stock-sync/persist-report";
import type { FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";

describe("restricted worker report persistence", () => {
  it("creates source identities but updates only mutable stock fields", async () => {
    const patch = {
      sourceIdentityKey: "sourceVehicleId:123", listingId: null, absenceCount: 0,
      lastAbsenceRunId: null, lastSeenRunId: "job", baselinePricePence: 100000, baselineMileage: 20000,
    };
    const upsert = vi.fn(async ({ update }: { update: object }) => {
      // Mirrors the real worker's immutable-key column permission boundary.
      if ("sourceIdentityKey" in update || "dealerId" in update || "bindingId" in update) {
        throw new Error("permission denied for table DealerStockSourceIdentity");
      }
      return { id: "identity" };
    });
    const client = {
      dealerStockSourceIdentity: { upsert },
      dealerStockSyncReport: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async () => ({ id: "report", fingerprint: "fingerprint" })),
      },
      dealerStockSyncAudit: { create: vi.fn(async () => ({ id: "audit" })) },
    };
    const snapshot: FingerprintSnapshot = {
      dealer: { id: "dealer", userId: "user", regionId: "region", tier: "STARTER", isAdminPreview: false, role: "DEALER", disabledAt: null, deletedAt: null },
      binding: { id: "binding", registryKey: "mikes-motors", enabled: false, verifiedAt: "2026-10-21T00:00:00.000Z" },
      activeListingCount: 0, listingCap: 30, listings: [], identities: [patch], actions: [],
    };
    await persistCompleteScrape(client, { bindingId: "binding", dealerId: "dealer", scrapeRunId: "job", jobId: "job", patches: [patch], snapshot, inventoryCount: 1 });
    expect(upsert).toHaveBeenCalledWith({
      where: { dealerId_sourceIdentityKey: { dealerId: "dealer", sourceIdentityKey: patch.sourceIdentityKey } },
      create: { bindingId: "binding", dealerId: "dealer", ...patch },
      update: { listingId: null, absenceCount: 0, lastAbsenceRunId: null, lastSeenRunId: "job", baselinePricePence: 100000, baselineMileage: 20000 },
    });
    expect(client.dealerStockSyncReport.create).toHaveBeenCalledOnce();
    expect(client.dealerStockSyncAudit.create).toHaveBeenCalledOnce();
  });

  it("stores only source key, status and count on a failed report plan", async () => {
    const create = vi.fn(async () => ({ id: "failed-report", fingerprint: "job" }));
    const client = {
      dealerStockSyncReport: { updateMany: vi.fn(async () => ({ count: 1 })), create },
      dealerStockSourceIdentity: { upsert: vi.fn() },
      dealerStockSyncAudit: { create: vi.fn(async () => ({ id: "audit" })) },
    };
    const report = await persistFailedScrape(client, {
      bindingId: "binding", dealerId: "dealer", scrapeRunId: "job", jobId: "job", failureReason: "source-failed",
      diagnostics: [
        { sourceKey: "stock", status: "failed", count: 14, error: "token-must-not-persist" },
        { sourceKey: "used-cars", status: "blocked_requires_feed", count: 0 },
        { sourceKey: "../secret", status: "failed", count: 1 },
        { sourceKey: "stock", status: "HTTP 500 body", count: 2 },
        { sourceKey: "stock", status: "ok", count: 1.5 },
      ],
    });
    expect(report).toEqual({ id: "failed-report", status: "FAILED" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: "FAILED",
      failureReason: "source-failed",
      plan: {
        actions: [],
        patches: [],
        diagnostics: [
          { sourceKey: "stock", status: "failed", count: 14 },
          { sourceKey: "used-cars", status: "blocked_requires_feed", count: 0 },
        ],
      },
    }) });
    expect(JSON.stringify(create.mock.calls)).not.toContain("token-must-not-persist");
    expect(JSON.stringify(client.dealerStockSyncAudit.create.mock.calls)).not.toContain("token-must-not-persist");
    expect(client.dealerStockSyncReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SUPERSEDED" }),
    }));
  });
});
