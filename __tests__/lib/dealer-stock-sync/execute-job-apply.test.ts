/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), transaction: vi.fn(), report: vi.fn(), snapshot: vi.fn(),
  cleanup: vi.fn(), attached: vi.fn(), claim: vi.fn(), apply: vi.fn(),
  delay: vi.fn(),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.delay }));
vi.mock("@/lib/db", () => ({ db: {
  dealerStockSyncJob: { findUnique: mocks.find, updateMany: mocks.update },
  dealerStockSyncReport: { findUnique: mocks.report },
  listingImage: { findMany: mocks.attached }, $transaction: mocks.transaction,
} }));
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: mocks.snapshot }));
vi.mock("@/lib/dealer-stock-sync/apply", () => ({ applyFrozenPlan: mocks.apply }));
vi.mock("@/lib/media/managed-import", () => ({ claimManagedImportsForAttachment: mocks.claim }));
vi.mock("@/lib/preview-packs/upload", async original => ({
  ...await original<typeof import("@/lib/preview-packs/upload")>(),
  enqueuePreviewUploadedImageCleanup: mocks.cleanup,
}));
import { runLeasedJob } from "@/scripts/dealer-stock-sync/execute-job";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { CreatePlanAction } from "@/lib/dealer-stock-sync/types";
import type { PreviewUploadedImage, uploadPreviewPackImages } from "@/lib/preview-packs/upload";

function fixture() {
  const actions: CreatePlanAction[] = ["one", "two"].map(identity => ({
    kind: "create", sourceIdentityKey: identity, listingId: null, title: "Ford Fiesta", description: "Reviewed stock",
    pricePence: 500000, categorySlug: "car", attributes: {}, ownedImages: [], changes: [],
    sourceImageUrls: ["https://images.clickdealer.co.uk/" + identity + ".jpg"],
  }));
  const snapshot: FingerprintSnapshot = {
    dealer: { id: "dealer", userId: "user", regionId: "region", tier: "STARTER", isAdminPreview: false,
      role: "DEALER", disabledAt: null, deletedAt: null },
    binding: { id: "binding", registryKey: "mikes-motors", enabled: true, verifiedAt: new Date(0).toISOString() },
    activeListingCount: 0, listingCap: 30, listings: [], identities: [], actions,
  };
  const fingerprint = fingerprintSnapshot(snapshot);
  const job = { id: "job", kind: "APPLY", status: "LEASED", leaseOwner: "busy", leaseExpiresAt: new Date(Date.now() + 900000),
    bindingId: "binding", dealerId: "dealer", reportId: "report", payload: { fingerprint, reportId: "report" } };
  const report = { id: "report", bindingId: "binding", dealerId: "dealer", status: "APPROVED", approvedById: "admin",
    fingerprint, plan: { actions } };
  const freshReport = { ...report };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    dealerStockSourceBinding: { findUnique: vi.fn(async (): Promise<{ dealerId: string; verifiedAt: Date } | null> =>
      ({ dealerId: "dealer", verifiedAt: new Date(0) })) },
    dealerStockSyncJob: {
      updateMany: vi.fn(async ({ where }: { where: { leaseOwner: string } }) => ({ count: job.leaseOwner === where.leaseOwner ? 1 : 0 })),
      update: vi.fn(async ({ data }: { data: { status: string } }) => { job.status = data.status; return job; }),
    },
    dealerStockSyncReport: {
      findUniqueOrThrow: vi.fn(async () => freshReport),
      updateMany: vi.fn(async () => { freshReport.status = "APPLIED"; return { count: 1 }; }),
    },
    user: { findUnique: vi.fn(async () => ({ role: "ADMIN", disabledAt: null, deletedAt: null })) },
    category: { findFirst: vi.fn(async () => ({ id: "category" })) },
    region: { findFirst: vi.fn(async () => ({ id: "region" })) },
    attributeDefinition: { findMany: vi.fn(async () => []) },
    listing: { create: vi.fn(async () => ({ id: "listing" })) },
    listingImage: { createMany: vi.fn(async () => ({ count: 1 })) },
    dealerStockSourceIdentity: { updateMany: vi.fn(async () => ({ count: 1 })) },
    listingStatusEvent: { create: vi.fn(async () => ({ id: "event" })) },
    dealerStockSyncAudit: { create: vi.fn(async () => ({ id: "audit" })) },
  };
  const commits: Array<{ listings: number; audits: number; receiptClaims: number; reportWrites: number; jobWrites: number }> = [];
  const writeCounts = () => ({
    listings: tx.listing.create.mock.calls.length, audits: tx.dealerStockSyncAudit.create.mock.calls.length,
    receiptClaims: mocks.claim.mock.calls.length, reportWrites: tx.dealerStockSyncReport.updateMany.mock.calls.length,
    jobWrites: tx.dealerStockSyncJob.update.mock.calls.length,
  });
  const transact = async (work: (client: typeof tx) => Promise<unknown>, commitError?: Error) => {
    const before = writeCounts();
    const previousJobStatus = job.status;
    const previousReportStatus = freshReport.status;
    try {
      const result = await work(tx);
      if (commitError) throw commitError;
      const after = writeCounts();
      commits.push({
        listings: after.listings - before.listings, audits: after.audits - before.audits,
        receiptClaims: after.receiptClaims - before.receiptClaims, reportWrites: after.reportWrites - before.reportWrites,
        jobWrites: after.jobWrites - before.jobWrites,
      });
      return result;
    } catch (error) {
      job.status = previousJobStatus;
      freshReport.status = previousReportStatus;
      throw error;
    }
  };
  mocks.find.mockImplementation(async () => ({ ...job }));
  mocks.report.mockImplementation(async () => ({ ...report }));
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.update.mockImplementation(async ({ where, data }: { where: { leaseOwner: string }; data: { status: string } }) => {
    if (job.leaseOwner !== where.leaseOwner) return { count: 0 };
    job.status = data.status;
    return { count: 1 };
  });
  mocks.transaction.mockImplementation((work: (client: typeof tx) => Promise<unknown>) => transact(work));
  mocks.attached.mockResolvedValue([]);
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.claim.mockResolvedValue(undefined);
  mocks.apply.mockResolvedValue({ applied: 2 });
  const images: PreviewUploadedImage[] = actions.map((action, order) => {
    const publicId = "iommarket/listings/preview-packs/mikes-motors/" + action.sourceIdentityKey + "/job-attempt/" + order;
    const imageKitFilePath = "/iommarket-media/staging/imports/" + publicId.slice("iommarket/listings/".length) + ".jpg";
    return { provider: "IMAGEKIT", publicId, url: "imagekit-private:" + imageKitFilePath, order: 0,
      imageKitFilePath, imageKitFileId: "file-" + order, cleanupReceiptId: "receipt-" + order,
      width: 640, height: 480, format: "jpg", bytes: 100, assetId: "file-" + order, version: "1", ownership: null };
  });
  const upload = vi.fn<typeof uploadPreviewPackImages>(async request => [images[request.identityKey === "one" ? 0 : 1]!]);
  return { job, snapshot, images, tx, freshReport, upload, transact, commits };
}

function serializationConflict() {
  return new Prisma.PrismaClientKnownRequestError("private serialization detail", { code: "P2034", clientVersion: "test" });
}

async function useRealApply() {
  const { applyFrozenPlan } = await vi.importActual<typeof import("@/lib/dealer-stock-sync/apply")>("@/lib/dealer-stock-sync/apply");
  mocks.apply.mockImplementation(applyFrozenPlan);
}

describe("stock executor with persisted desktop photos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.delay.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["legacy", undefined, 30_000],
    ["desktop-step", { applyTransactionTimeoutMs: 180_000 as const }, 180_000],
  ] as const)("claims all receipts and applies the whole report in one transaction for %s", async (_kind, execution, timeout) => {
    const current = fixture();
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn(), async () => undefined, execution);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout });
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(current.tx, current.images);
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.apply.mock.calls[0]![0]).toMatchObject({
      client: current.tx, snapshot: current.snapshot, actorId: "admin", reportId: "report", jobId: "job",
    });
    expect(current.job.status).toBe("SUCCEEDED");
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("reports a transaction failure without exposing raw database details or claiming success", async () => {
    const current = fixture();
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "sensitive connection detail must never be logged", { code: "P2028", clientVersion: "test" },
    ));
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn(), async () => undefined,
      { applyTransactionTimeoutMs: 180_000 });
    expect(current.job.status).toBe("FAILED");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Stock sync atomic transaction failed.", {
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: 180_000, failureCode: "P2028", attempt: 1, maxAttempts: 3,
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.delay).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive connection");
  });

  it.each([30_000, 180_000] as const)("retries a commit conflict without reuploading and commits one set of writes with timeout %s", async timeout => {
    const current = fixture();
    await useRealApply();
    mocks.transaction.mockImplementation((work: (tx: typeof current.tx) => Promise<unknown>) =>
      current.transact(work, mocks.transaction.mock.calls.length === 1 ? serializationConflict() : undefined));
    const guard = vi.fn();
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, guard, undefined,
      timeout === 180_000 ? { applyTransactionTimeoutMs: timeout } : {});
    expect(current.job.status).toBe("SUCCEEDED");
    expect(current.commits).toEqual([{ listings: 2, audits: 2, receiptClaims: 1, reportWrites: 1, jobWrites: 1 }]);
    expect(current.freshReport.status).toBe("APPLIED");
    expect(current.upload).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    for (const [, options] of mocks.transaction.mock.calls) {
      expect(options).toEqual({ isolationLevel: "Serializable", timeout });
    }
    expect(current.tx.dealerStockSourceBinding.findUnique).toHaveBeenCalledTimes(2);
    expect(current.tx.dealerStockSyncJob.updateMany).toHaveBeenCalledTimes(2);
    expect(current.tx.dealerStockSyncReport.findUniqueOrThrow).toHaveBeenCalledTimes(2);
    expect(current.tx.user.findUnique).toHaveBeenCalledTimes(2);
    expect(mocks.snapshot).toHaveBeenCalledTimes(3);
    expect(mocks.claim.mock.calls.map(([tx, images]) => [tx === current.tx, images])).toEqual([
      [true, current.images], [true, current.images],
    ]);
    expect(current.tx.listing.create).toHaveBeenCalledTimes(4);
    expect(current.tx.dealerStockSyncAudit.create).toHaveBeenCalledTimes(4);
    expect(current.tx.dealerStockSyncReport.updateMany).toHaveBeenCalledTimes(2);
    expect(guard).toHaveBeenCalledTimes(4);
    expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(100);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Stock sync atomic transaction retrying.", {
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: timeout, failureCode: "P2034",
      attempt: 1, maxAttempts: 3, retryDelayMs: 100,
    });
    expect(console.info).toHaveBeenCalledExactlyOnceWith("Stock sync atomic transaction completed.", {
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: timeout, attempt: 2, maxAttempts: 3,
    });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private serialization");
  });

  it.each(["start", "commit"] as const)("exhausts three %s conflicts before legacy cleanup and leaves the approved report unapplied", async phase => {
    const current = fixture();
    await useRealApply();
    if (phase === "start") mocks.transaction.mockRejectedValue(serializationConflict());
    else mocks.transaction.mockImplementation((work: (tx: typeof current.tx) => Promise<unknown>) =>
      current.transact(work, serializationConflict()));
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn());
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.delay.mock.calls).toEqual([[100], [200]]);
    expect(current.upload).toHaveBeenCalledTimes(2);
    expect(current.freshReport.status).toBe("APPROVED");
    expect(current.job.status).toBe("FAILED");
    expect(current.commits).toEqual([]);
    expect(mocks.claim).toHaveBeenCalledTimes(phase === "start" ? 0 : 3);
    expect(mocks.apply).toHaveBeenCalledTimes(phase === "start" ? 0 : 3);
    expect(current.tx.dealerStockSyncJob.update).toHaveBeenCalledTimes(phase === "start" ? 0 : 3);
    expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(expect.anything(), current.images, "stock-sync-apply-failed");
    expect(mocks.cleanup.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.transaction.mock.invocationCallOrder[2]!);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Stock sync atomic transaction failed.", {
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: 30_000, failureCode: "P2034", attempt: 3, maxAttempts: 3,
    });
    expect(console.info).not.toHaveBeenCalled();
  });

  it.each([
    { scenario: "a slow first conflict", transactionMs: 180_000, timerMs: 100, attempts: 1, delays: [] },
    { scenario: "cumulative conflicts", transactionMs: 15_000, timerMs: 100, attempts: 2, delays: [[100]] },
    { scenario: "the exact retry-start deadline", transactionMs: 29_900, timerMs: 100, attempts: 1, delays: [[100]] },
    { scenario: "an overdue retry timer", transactionMs: 0, timerMs: 30_000, attempts: 1, delays: [[100]] },
  ])("starts no further transaction after the 30-second window with $scenario", async ({ transactionMs, timerMs, attempts, delays }) => {
    const enteredAt = Date.now();
    let elapsedMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => enteredAt + elapsedMs);
    const current = fixture();
    mocks.transaction.mockImplementation(async () => {
      elapsedMs += transactionMs;
      throw serializationConflict();
    });
    mocks.delay.mockImplementation(async () => { elapsedMs += timerMs; });
    const cleanup = vi.fn(async () => undefined);
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn(), cleanup,
      { applyTransactionTimeoutMs: 180_000 });
    expect(mocks.transaction).toHaveBeenCalledTimes(attempts);
    for (const [, options] of mocks.transaction.mock.calls) {
      expect(options).toEqual({ isolationLevel: "Serializable", timeout: 180_000 });
    }
    expect(mocks.delay.mock.calls).toEqual(delays);
    expect(current.upload).toHaveBeenCalledTimes(2);
    expect(current.job.status).toBe("FAILED");
    expect(current.freshReport.status).toBe("APPROVED");
    expect(current.commits).toEqual([]);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledExactlyOnceWith(current.images);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", error: "Stock sync job failed." }),
    }));
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Stock sync atomic transaction failed.", {
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: 180_000,
      failureCode: "P2034", attempt: attempts, maxAttempts: 3,
    });
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private serialization");
  });

  it.each([
    new Prisma.PrismaClientKnownRequestError("private unique detail", { code: "P2002", clientVersion: "test" }),
    new Error("private unknown detail"),
    Object.assign(new Error("not a known Prisma conflict"), { code: "P2034" }),
  ])("does not retry unrelated or unverified failures: %s", async error => {
    const current = fixture();
    mocks.transaction.mockRejectedValueOnce(error);
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn(), async () => undefined);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.delay).not.toHaveBeenCalled();
    expect(current.job.status).toBe("FAILED");
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it.each(["guard", "binding", "lease owner", "lease expiry", "approval", "approver", "fingerprint"] as const)(
    "revalidates %s after a conflict and stops before any new writes",
    async changed => {
      const current = fixture();
      await useRealApply();
      mocks.transaction.mockRejectedValueOnce(serializationConflict());
      const guard = vi.fn();
      mocks.delay.mockImplementationOnce(async () => {
        if (changed === "guard") guard.mockImplementation(() => { throw new Error("disabled"); });
        if (changed === "binding") current.tx.dealerStockSourceBinding.findUnique.mockResolvedValueOnce(null);
        if (changed === "lease owner") current.job.leaseOwner = "successor";
        if (changed === "lease expiry") current.tx.dealerStockSyncJob.updateMany.mockResolvedValueOnce({ count: 0 });
        if (changed === "approval") current.freshReport.status = "PENDING_REVIEW";
        if (changed === "approver") current.tx.user.findUnique.mockResolvedValueOnce({ role: "USER", disabledAt: null, deletedAt: null });
        if (changed === "fingerprint") mocks.snapshot.mockResolvedValueOnce({ ...current.snapshot, listingCap: 1 });
      });
      await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, guard, async () => undefined);
      expect(mocks.transaction).toHaveBeenCalledTimes(changed === "guard" ? 1 : 2);
      expect(current.upload).toHaveBeenCalledTimes(2);
      expect(current.tx.listing.create).not.toHaveBeenCalled();
      expect(current.tx.dealerStockSyncAudit.create).not.toHaveBeenCalled();
      expect(current.tx.dealerStockSyncJob.update).not.toHaveBeenCalled();
      expect(current.job.status).toBe(changed === "lease owner" ? "LEASED" : "FAILED");
      expect(mocks.delay).toHaveBeenCalledOnce();
      expect(console.info).not.toHaveBeenCalled();
    },
  );

  it("does not clean shared photos or fail a successor when ownership changes before the transaction", async () => {
    const current = fixture();
    const upload: typeof uploadPreviewPackImages = async request => {
      const result = await current.upload(request);
      if (request.identityKey === "two") current.job.leaseOwner = "successor";
      return result;
    };
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), upload, vi.fn(), async () => undefined);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.attached).not.toHaveBeenCalled();
    expect(current.job).toMatchObject({ status: "LEASED", leaseOwner: "successor" });
  });

  it("also defers shared-photo cleanup when preparation fails partway through the report", async () => {
    const current = fixture();
    const upload: typeof uploadPreviewPackImages = async request => {
      if (request.identityKey === "two") throw new Error("missing staged receipt");
      return current.upload(request);
    };
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), upload, vi.fn(), async () => undefined);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(current.job.status).toBe("FAILED");
  });

  it("preserves default cleanup for legacy per-invocation uploads", async () => {
    const current = fixture();
    const upload: typeof uploadPreviewPackImages = async request => {
      if (request.identityKey === "two") throw new Error("photo failed");
      return current.upload(request);
    };
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), upload, vi.fn());
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.cleanup.mock.calls[0]![1]).toEqual([current.images[0]]);
    expect(current.job.status).toBe("FAILED");
  });

  it.each(["approvedById", "fingerprint", "bindingId", "dealerId"] as const)("rechecks the report's %s inside the transaction before receipt claims or listing writes", async field => {
    const current = fixture();
    current.freshReport[field] = "changed";
    await runLeasedJob({ id: "job", owner: "busy" }, vi.fn(), current.upload, vi.fn(), async () => undefined);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(current.tx.dealerStockSyncJob.update).not.toHaveBeenCalled();
    expect(current.job.status).toBe("FAILED");
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
