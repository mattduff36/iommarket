import { describe, expect, it, vi } from "vitest";
import { persistCompleteScrape } from "@/lib/dealer-stock-sync/persist-report";
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
});
