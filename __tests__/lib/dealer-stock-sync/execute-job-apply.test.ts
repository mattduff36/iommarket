/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), transaction: vi.fn(), report: vi.fn(), snapshot: vi.fn(),
  cleanup: vi.fn(), attached: vi.fn(), claim: vi.fn(), apply: vi.fn(),
}));
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
    dealerStockSourceBinding: { findUnique: vi.fn(async () => ({ dealerId: "dealer", verifiedAt: new Date(0) })) },
    dealerStockSyncJob: {
      updateMany: vi.fn(async ({ where }: { where: { leaseOwner: string } }) => ({ count: job.leaseOwner === where.leaseOwner ? 1 : 0 })),
      update: vi.fn(async ({ data }: { data: { status: string } }) => { job.status = data.status; return job; }),
    },
    dealerStockSyncReport: { findUniqueOrThrow: vi.fn(async () => freshReport) },
    user: { findUnique: vi.fn(async () => ({ role: "ADMIN", disabledAt: null, deletedAt: null })) },
  };
  mocks.find.mockImplementation(async () => ({ ...job }));
  mocks.report.mockImplementation(async () => ({ ...report }));
  mocks.snapshot.mockResolvedValue(snapshot);
  mocks.update.mockImplementation(async ({ where, data }: { where: { leaseOwner: string }; data: { status: string } }) => {
    if (job.leaseOwner !== where.leaseOwner) return { count: 0 };
    job.status = data.status;
    return { count: 1 };
  });
  mocks.transaction.mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
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
  const upload: typeof uploadPreviewPackImages = async request => [images[request.identityKey === "one" ? 0 : 1]!];
  return { job, snapshot, images, tx, freshReport, upload };
}

describe("stock executor with persisted desktop photos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
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
      jobId: "job", elapsedMs: expect.any(Number), timeoutMs: 180_000, failureCode: "P2028",
    });
    expect(console.info).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive connection");
  });

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
