import { fingerprintSnapshot, type FingerprintSnapshot } from "./fingerprint";
import type { IdentityPatch, PlanAction } from "./types";

interface PersistClient {
  dealerStockSyncReport: {
    updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
    create(args: { data: object }): Promise<{ id: string; fingerprint: string }>;
  };
  dealerStockSourceIdentity: {
    upsert(args: { where: object; create: object; update: object }): Promise<{ id: string }>;
  };
  dealerStockSyncAudit: {
    create(args: { data: object }): Promise<{ id: string }>;
  };
}

export async function persistFailedScrape(
  client: PersistClient,
  input: {
    bindingId: string;
    dealerId: string;
    scrapeRunId: string;
    failureReason: string;
    jobId: string;
  },
) {
  await client.dealerStockSyncReport.updateMany({
    where: { bindingId: input.bindingId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
    data: { status: "SUPERSEDED", supersededAt: new Date() },
  });
  const report = await client.dealerStockSyncReport.create({
    data: {
      bindingId: input.bindingId,
      dealerId: input.dealerId,
      scrapeRunId: input.scrapeRunId,
      status: "FAILED",
      fingerprint: input.scrapeRunId,
      plan: { actions: [], patches: [] },
      inventoryCount: 0,
      failureReason: input.failureReason,
    },
  });
  await client.dealerStockSyncAudit.create({
    data: {
      reportId: report.id,
      jobId: input.jobId,
      actorId: null,
      action: "scrape-failed",
      before: {},
      after: { failureReason: input.failureReason },
    },
  });
  return report;
}

export async function persistCompleteScrape(
  client: PersistClient,
  input: {
    bindingId: string;
    dealerId: string;
    scrapeRunId: string;
    jobId: string;
    patches: IdentityPatch[];
    snapshot: FingerprintSnapshot;
    inventoryCount: number;
  },
) {
  const fingerprint = fingerprintSnapshot(input.snapshot);
  await client.dealerStockSyncReport.updateMany({
    where: { bindingId: input.bindingId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
    data: { status: "SUPERSEDED", supersededAt: new Date() },
  });
  for (const patch of input.patches) {
    await client.dealerStockSourceIdentity.upsert({
      where: {
        dealerId_sourceIdentityKey: {
          dealerId: input.dealerId,
          sourceIdentityKey: patch.sourceIdentityKey,
        },
      },
      create: {
        bindingId: input.bindingId,
        dealerId: input.dealerId,
        ...patch,
      },
      update: patch,
    });
  }
  const report = await client.dealerStockSyncReport.create({
    data: {
      bindingId: input.bindingId,
      dealerId: input.dealerId,
      scrapeRunId: input.scrapeRunId,
      status: "PENDING_REVIEW",
      fingerprint,
      plan: { actions: input.snapshot.actions satisfies PlanAction[] },
      inventoryCount: input.inventoryCount,
    },
  });
  await client.dealerStockSyncAudit.create({
    data: {
      reportId: report.id,
      jobId: input.jobId,
      actorId: null,
      action: "scrape-reviewed",
      before: {},
      after: { fingerprint, scrapeRunId: input.scrapeRunId },
    },
  });
  return { report, fingerprint };
}
