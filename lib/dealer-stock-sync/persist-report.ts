import { fingerprintSnapshot, type FingerprintSnapshot } from "./fingerprint";
import type { IdentityPatch, PlanAction } from "./types";

const DIAGNOSTIC_STATUSES = new Set(["ok", "failed", "blocked_requires_feed", "no_public_stock", "skipped"]);

function failedScrapePlan(diagnostics: readonly unknown[] | undefined) {
  const safe: Array<{ sourceKey: string; status: string; count: number }> = [];
  for (const item of diagnostics ?? []) {
    if (safe.length >= 20 || !item || typeof item !== "object") continue;
    const source = item as { sourceKey?: unknown; status?: unknown; count?: unknown };
    if (typeof source.sourceKey !== "string" || !/^[a-z0-9-]{1,64}$/i.test(source.sourceKey)) continue;
    if (typeof source.status !== "string" || !DIAGNOSTIC_STATUSES.has(source.status)) continue;
    if (typeof source.count !== "number" || !Number.isSafeInteger(source.count) || source.count < 0 || source.count > 100_000) continue;
    safe.push({ sourceKey: source.sourceKey, status: source.status, count: source.count });
  }
  return safe.length > 0 ? { actions: [], patches: [], diagnostics: safe } : { actions: [], patches: [] };
}

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
    diagnostics?: readonly unknown[];
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
      plan: failedScrapePlan(input.diagnostics),
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
  if (typeof report.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(report.id)) {
    throw new Error("Stock sync job failed.");
  }
  return { id: report.id, status: "FAILED" as const };
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
    // The identity key is immutable; the restricted worker may update stock fields only.
    const { sourceIdentityKey, ...mutableFields } = patch;
    await client.dealerStockSourceIdentity.upsert({
      where: {
        dealerId_sourceIdentityKey: {
          dealerId: input.dealerId,
          sourceIdentityKey,
        },
      },
      create: {
        bindingId: input.bindingId,
        dealerId: input.dealerId,
        ...patch,
      },
      update: mutableFields,
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
