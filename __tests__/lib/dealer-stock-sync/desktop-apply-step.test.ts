/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findJob: vi.fn(), update: vi.fn(), report: vi.fn(), actor: vi.fn(), snapshot: vi.fn(),
  download: vi.fn(), upload: vi.fn(), cleanup: vi.fn(), run: vi.fn(), configured: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  dealerStockSyncJob: { findUnique: mocks.findJob, updateMany: mocks.update },
  dealerStockSyncReport: { findUnique: mocks.report }, user: { findUnique: mocks.actor },
} }));
vi.mock("@/lib/dealer-stock-sync/snapshot", () => ({ loadStockSyncSnapshot: mocks.snapshot }));
vi.mock("@/lib/images/safe-remote-image", () => ({ downloadSafeRemoteImage: mocks.download }));
vi.mock("@/lib/media/managed-import", () => ({ uploadManagedImport: mocks.upload }));
vi.mock("@/lib/media/direct-upload-token", () => ({ assertManagedUploadsConfigured: mocks.configured }));
vi.mock("@/lib/media/managed-policy", async original => ({
  ...await original<typeof import("@/lib/media/managed-policy")>(),
  assertManagedMediaMutation: (path: string) => {
    if (!path.startsWith("/iommarket-media/staging/imports/")) throw new Error("wrong environment");
  },
}));
vi.mock("@/scripts/dealer-stock-sync/execute-job", () => ({ runLeasedJob: mocks.run }));
vi.mock("@/scripts/dealer-stock-sync/stock-images", () => ({ cleanupStockImages: mocks.cleanup }));
import { runDesktopApplyStep } from "@/lib/dealer-stock-sync/desktop-apply-step";
import { fingerprintSnapshot, type FingerprintSnapshot } from "@/lib/dealer-stock-sync/fingerprint";
import type { CreatePlanAction } from "@/lib/dealer-stock-sync/types";
import type { DesktopApplyStepInput } from "@/lib/dealer-stock-sync/desktop-jobs";
import type { PreviewUploadedImage, uploadPreviewPackImages } from "@/lib/preview-packs/upload";

const input: DesktopApplyStepInput = {
  jobId: "cjob000000000000000000001", reportId: "creport000000000000000001",
  bindingId: "binding", dealerId: "dealer", busyOwner: "busy-owner",
};
const sourceUrl = (index: number) => "https://images.clickdealer.co.uk/vehicles/8324/8324646/full/" + index + ".jpg";
function action(identity: string, count: number): CreatePlanAction {
  return { kind: "create", sourceIdentityKey: identity, listingId: null, title: "Ford Fiesta", description: "Approved stock",
    pricePence: 899500, categorySlug: "car", attributes: {}, ownedImages: [], changes: [],
    sourceImageUrls: Array.from({ length: count }, (_, index) => sourceUrl(index)),
    sourceUrl: "https://www.mikesmotors.im/used-cars/ford-fiesta-8324646",
  };
}
function image(publicId: string, order: number): PreviewUploadedImage {
  const path = "/iommarket-media/staging/imports/" + publicId.slice("iommarket/listings/".length) + ".jpg";
  return { provider: "IMAGEKIT", publicId, order, url: "imagekit-private:" + path,
    imageKitFilePath: path, imageKitFileId: "file-" + publicId, cleanupReceiptId: "receipt-" + publicId,
    assetId: "file-" + publicId, version: "1", width: 640, height: 480, format: "jpg", bytes: 1000, ownership: null };
}
interface Update {
  where: { id: string; status: string; leaseOwner: string; leaseExpiresAt: { gt: Date } };
  data: { status?: string; leaseExpiresAt?: Date | null; payload?: Record<string, unknown> };
}
interface Progress { photos: Array<{ image: PreviewUploadedImage; photoIndex: number }>; reportId: string }

function fixture(actions: CreatePlanAction[] = [action("vehicle-one", 2)]) {
  const snapshot: FingerprintSnapshot = {
    dealer: { id: "dealer", userId: "dealer-user", regionId: "region", tier: "BASIC", isAdminPreview: false,
      role: "DEALER", disabledAt: null, deletedAt: null },
    binding: { id: "binding", registryKey: "mikes-motors", enabled: true, verifiedAt: "2026-10-01T00:00:00.000Z" },
    activeListingCount: 0, listingCap: 100, listings: [], identities: [], actions,
  };
  const fingerprint = fingerprintSnapshot(snapshot);
  const report = { id: input.reportId, bindingId: input.bindingId, dealerId: input.dealerId, fingerprint,
    status: "APPROVED", approvedById: "admin", plan: { actions } };
  const state = {
    job: { id: input.jobId, kind: "APPLY", status: "LEASED", bindingId: input.bindingId, dealerId: input.dealerId,
      reportId: input.reportId, leaseOwner: input.busyOwner, leaseExpiresAt: new Date(Date.now() + 900000) as Date | null,
      payload: { fingerprint, reportId: input.reportId } as Record<string, unknown> },
    recordMode: "ok" as "ok" | "lost" | "ambiguous" | "ambiguous-reclaimed",
    actor: { role: "ADMIN", disabledAt: null as Date | null, deletedAt: null as Date | null },
    report, snapshot, received: [] as PreviewUploadedImage[][],
  };
  mocks.findJob.mockImplementation(async () => state.job);
  mocks.report.mockImplementation(async () => state.report);
  mocks.actor.mockImplementation(async () => state.actor);
  mocks.snapshot.mockImplementation(async () => state.snapshot);
  mocks.update.mockImplementation(async ({ where, data }: Update) => {
    if (state.job.id !== where.id || state.job.status !== where.status || state.job.leaseOwner !== where.leaseOwner ||
        !state.job.leaseExpiresAt || state.job.leaseExpiresAt <= where.leaseExpiresAt.gt) return { count: 0 };
    if (data.payload && state.recordMode === "lost") {
      state.job.leaseOwner = "successor";
      return { count: 0 };
    }
    Object.assign(state.job, data);
    if (data.payload && state.recordMode !== "ok") {
      if (state.recordMode === "ambiguous-reclaimed") state.job.leaseOwner = "successor";
      throw new Error("database response lost");
    }
    return { count: 1 };
  });
  mocks.download.mockResolvedValue({ bytes: Buffer.from([255, 216, 255]), contentType: "image/jpeg" });
  mocks.upload.mockImplementation(async ({ publicId, order }: { publicId: string; order: number }) => image(publicId, order));
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.run.mockImplementation(async (_lease: unknown, _scrape: unknown, upload: typeof uploadPreviewPackImages) => {
    for (const item of actions) {
      state.received.push(await upload({ dealerKey: "mikes-motors", identityKey: item.sourceIdentityKey,
        attemptId: "executor-attempt", sources: item.sourceImageUrls!.slice(0, 20).map((url, order) => ({ url, order, localPath: null })) }));
    }
    state.job.status = "SUCCEEDED";
    state.job.leaseExpiresAt = null;
  });
  return { state, step: (owner = input.busyOwner) => runDesktopApplyStep({ ...input, busyOwner: owner }, vi.fn()),
    progress: () => state.job.payload.desktopApply as Progress };
}

describe("bounded desktop APPLY staging", () => {
  beforeEach(() => vi.resetAllMocks());

  it("stages exactly one approved photo with job-bound progress and no listing commit", async () => {
    const api = fixture();
    expect(await api.step()).toEqual({ outcome: "continue" });
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith({ url: sourceUrl(0) });
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(api.state.job.payload.desktopApply).toMatchObject({
      version: 1, jobId: input.jobId, reportId: input.reportId, fingerprint: api.state.report.fingerprint,
      photos: [{ identityKey: "vehicle-one", sourceUrl: sourceUrl(0), photoIndex: 0,
        image: { provider: "IMAGEKIT", cleanupReceiptId: expect.any(String) } }],
    });
    expect(JSON.stringify(api.state.job.payload)).not.toMatch(/accessToken|DATABASE_URL|PRIVATE_KEY/);
  });

  it("stages eight photos per vehicle at most, then commits the entire report once without more downloads", async () => {
    const api = fixture([action("first", 10), action("second", 2)]);
    for (let index = 0; index < 10; index += 1) {
      expect(await api.step()).toEqual({ outcome: "continue" });
      expect(mocks.upload).toHaveBeenCalledTimes(index + 1);
      expect(mocks.run).not.toHaveBeenCalled();
    }
    expect(await api.step()).toEqual({ outcome: "succeeded" });
    expect(mocks.download).toHaveBeenCalledTimes(10);
    expect(mocks.run).toHaveBeenCalledOnce();
    expect(api.state.received.map(images => images.length)).toEqual([8, 2]);
    expect(mocks.run.mock.calls[0]?.[4]).toEqual(expect.any(Function));
    expect(mocks.run.mock.calls[0]?.[5]).toEqual({ applyTransactionTimeoutMs: 180_000 });
    await mocks.run.mock.calls[0]![4]!(api.progress().photos.map(photo => photo.image));
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(["approval", "fingerprint", "approver"] as const)("revalidates %s before the next import and cleans only after terminal fencing", async change => {
    const api = fixture();
    await api.step();
    if (change === "approval") api.state.report.status = "PENDING_REVIEW";
    if (change === "fingerprint") api.state.snapshot.listingCap += 1;
    if (change === "approver") api.state.actor.disabledAt = new Date();
    expect(await api.step()).toEqual({ outcome: "failed" });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(api.state.job.status).toBe("FAILED");
    expect(mocks.cleanup).toHaveBeenCalledWith(api.progress().photos.map(photo => photo.image));
  });

  it.each(["foreign", "expired"] as const)("does no work for a %s busy lease", async mode => {
    const api = fixture();
    if (mode === "foreign") api.state.job.leaseOwner = "other";
    else api.state.job.leaseExpiresAt = new Date(0);
    expect(await api.step()).toEqual({ outcome: "unavailable" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it.each(["missing", "untrusted host"] as const)("fails closed for %s photos without any listing apply", async mode => {
    const candidate = action("first", 1);
    candidate.sourceImageUrls = mode === "missing" ? [] : ["https://attacker.example/photo.jpg"];
    const api = fixture([candidate]);
    expect(await api.step()).toEqual({ outcome: "failed" });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("fails a photo network error without claiming that listings were applied", async () => {
    const api = fixture();
    await api.step();
    mocks.download.mockRejectedValue(new Error("secret remote detail"));
    expect(await api.step()).toEqual({ outcome: "failed" });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(api.state.job.status).toBe("FAILED");
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans only the new unique attempt after a confirmed lost progress fence", async () => {
    const api = fixture();
    await api.step();
    const earlier = api.progress().photos[0]!.image;
    api.state.recordMode = "lost";
    expect(await api.step()).toEqual({ outcome: "unavailable" });
    const cleaned = mocks.cleanup.mock.calls[0]![0] as PreviewUploadedImage[];
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]!.publicId).not.toBe(earlier.publicId);
    expect(api.state.job.leaseOwner).toBe("successor");
    expect(api.state.job.status).toBe("LEASED");
  });

  it("preserves an ambiguously recorded photo for a successor and resumes it without reimport", async () => {
    const api = fixture();
    await api.step();
    api.state.recordMode = "ambiguous-reclaimed";
    expect(await api.step()).toEqual({ outcome: "unavailable" });
    expect(api.progress().photos).toHaveLength(2);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    api.state.recordMode = "ok";
    expect(await api.step("successor")).toEqual({ outcome: "succeeded" });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });

  it("cleans ambiguous progress only when the same owner can make the job terminal", async () => {
    const api = fixture();
    await api.step();
    api.state.recordMode = "ambiguous";
    expect(await api.step()).toEqual({ outcome: "failed" });
    expect(api.state.job.status).toBe("FAILED");
    expect((mocks.cleanup.mock.calls[0]![0] as PreviewUploadedImage[])).toHaveLength(2);
  });

  it("rejects replayed progress for another report or photo index", async () => {
    const api = fixture();
    await api.step();
    api.progress().photos[0]!.photoIndex = 8;
    expect(await api.step()).toEqual({ outcome: "failed" });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("trusts the terminal database row, not a returned executor promise", async () => {
    const api = fixture([action("first", 1)]);
    await api.step();
    mocks.run.mockResolvedValue(undefined);
    expect(await api.step()).toEqual({ outcome: "unavailable" });
    expect(api.state.job.status).toBe("LEASED");
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
