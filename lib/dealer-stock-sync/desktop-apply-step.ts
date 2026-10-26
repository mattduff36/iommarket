import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { downloadSafeRemoteImage } from "@/lib/images/safe-remote-image";
import { assertManagedUploadsConfigured } from "@/lib/media/direct-upload-token";
import { uploadManagedImport } from "@/lib/media/managed-import";
import { assertManagedMediaMutation } from "@/lib/media/managed-policy";
import { PREVIEW_PACK_PHOTO_LIMIT } from "@/lib/preview-packs/limits";
import { previewImagePublicId, type PreviewUploadedImage, type uploadPreviewPackImages } from "@/lib/preview-packs/upload";
import { getDealer } from "@/scripts/dealer-stock-sync/registry";
import { runLeasedJob, type DealerStockSyncGuard } from "@/scripts/dealer-stock-sync/execute-job";
import { cleanupStockImages } from "@/scripts/dealer-stock-sync/stock-images";
import { assertDesktopSourceUrl, desktopImageUrlRules } from "./desktop-source-policy";
import { DESKTOP_JOB_LEASE_MS, type DesktopApplyStepInput, type DesktopApplyStepResult } from "./desktop-jobs";
import { fingerprintSnapshot, type FingerprintSnapshot } from "./fingerprint";
import { isOwnedListingImage } from "./images";
import { dealerSyncBlockReason } from "./eligibility";
import { loadStockSyncSnapshot } from "./snapshot";

const SAFE_FAILURE = "Stock sync job failed.";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
interface PhotoTask { identityKey: string; photoIndex: number; sourceUrl: string }
interface StagedPhoto extends PhotoTask { attemptId: string; image: PreviewUploadedImage }
interface ApplyProgress {
  version: 1; jobId: string; reportId: string; fingerprint: string; photos: StagedPhoto[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function leaseWhere(input: DesktopApplyStepInput) {
  return { id: input.jobId, status: "LEASED" as const, leaseOwner: input.busyOwner, leaseExpiresAt: { gt: new Date() } };
}
function ownedImage(image: PreviewUploadedImage): boolean {
  return image.provider === "IMAGEKIT" && image.ownership === null &&
    isOwnedListingImage({ ...image, width: image.width ?? 0, height: image.height ?? 0 });
}

/** Only URLs from the stored approved plan and exact registry policy can become tasks. */
function photoTasks(snapshot: FingerprintSnapshot): PhotoTask[] {
  const dealer = getDealer(snapshot.binding.registryKey);
  if (dealer.status !== "confirmed" || snapshot.actions.length > 2000) throw new Error(SAFE_FAILURE);
  const rules = dealer.sources.flatMap(source =>
    source.startUrl ? desktopImageUrlRules(dealer.key, source.connectorKey, source.startUrl) : []);
  const identities = new Set<string>();
  const tasks: PhotoTask[] = [];
  for (const action of snapshot.actions) {
    if (action.kind !== "create") continue;
    if (!action.sourceIdentityKey || identities.has(action.sourceIdentityKey) ||
        !Array.isArray(action.sourceImageUrls) || !action.sourceImageUrls.length ||
        action.sourceImageUrls.length > 20) throw new Error(SAFE_FAILURE);
    identities.add(action.sourceIdentityKey);
    for (const url of action.sourceImageUrls) assertDesktopSourceUrl(url, rules);
    action.sourceImageUrls.slice(0, PREVIEW_PACK_PHOTO_LIMIT).forEach((sourceUrl, photoIndex) => {
      tasks.push({ identityKey: action.sourceIdentityKey, sourceUrl, photoIndex });
    });
  }
  return tasks;
}

function progressFor(
  payload: Record<string, unknown>, input: DesktopApplyStepInput, fingerprint: string,
  registryKey: string, tasks: PhotoTask[],
): ApplyProgress {
  const raw = payload.desktopApply;
  if (raw === undefined) return { version: 1, jobId: input.jobId, reportId: input.reportId!, fingerprint, photos: [] };
  const progress = object(raw);
  if (!progress || progress.version !== 1 || progress.jobId !== input.jobId ||
      progress.reportId !== input.reportId || progress.fingerprint !== fingerprint ||
      !Array.isArray(progress.photos) || progress.photos.length > tasks.length) throw new Error(SAFE_FAILURE);
  const photos: StagedPhoto[] = [];
  const receipts = new Set<string>();
  for (let index = 0; index < progress.photos.length; index += 1) {
    const photo = object(progress.photos[index]);
    const task = tasks[index]!;
    const image = object(photo?.image) as unknown as PreviewUploadedImage | null;
    if (!photo || photo.identityKey !== task.identityKey || photo.photoIndex !== task.photoIndex ||
        photo.sourceUrl !== task.sourceUrl || typeof photo.attemptId !== "string" || !UUID.test(photo.attemptId) ||
        !image || !ownedImage(image) || image.order !== task.photoIndex ||
        image.publicId !== previewImagePublicId(registryKey, task.identityKey, input.jobId + "-" + photo.attemptId, task.photoIndex) ||
        receipts.has(image.cleanupReceiptId!)) throw new Error(SAFE_FAILURE);
    assertManagedMediaMutation(image.imageKitFilePath!);
    receipts.add(image.cleanupReceiptId!);
    photos.push({ ...task, attemptId: photo.attemptId, image });
  }
  return { version: 1, jobId: input.jobId, reportId: input.reportId!, fingerprint, photos };
}

async function cleanup(images: PreviewUploadedImage[]) {
  if (images.length) await cleanupStockImages(images).catch(() => undefined);
  // Every managed import already has a durable abandoned-import receipt.
  // That receipt remains available if immediate cleanup cannot be enqueued.
}

/**
 * One call imports at most one photo. Listing writes happen only through the
 * existing whole-report executor, after every photo has a persisted receipt.
 */
export async function runDesktopApplyStep(
  input: DesktopApplyStepInput,
  guard: DealerStockSyncGuard,
): Promise<DesktopApplyStepResult> {
  let persisted: PreviewUploadedImage[] = [];
  let unrecorded: PreviewUploadedImage[] = [];
  try {
    guard();
    const job = await db.dealerStockSyncJob.findUnique({ where: { id: input.jobId } });
    if (!job || job.kind !== "APPLY" || job.status !== "LEASED" || job.leaseOwner !== input.busyOwner ||
        !job.leaseExpiresAt || job.leaseExpiresAt <= new Date()) return { outcome: "unavailable" };
    const payload = object(job.payload);
    if (!input.reportId || job.reportId !== input.reportId || job.bindingId !== input.bindingId ||
        job.dealerId !== input.dealerId || payload?.reportId !== input.reportId ||
        typeof payload.fingerprint !== "string") throw new Error(SAFE_FAILURE);
    const report = await db.dealerStockSyncReport.findUnique({ where: { id: input.reportId } });
    const plan = object(report?.plan);
    if (!report || report.id !== input.reportId || report.bindingId !== input.bindingId ||
        report.dealerId !== input.dealerId || report.fingerprint !== payload.fingerprint ||
        !plan || !Array.isArray(plan.actions)) throw new Error(SAFE_FAILURE);
    const snapshot = await loadStockSyncSnapshot(input.dealerId, plan.actions as FingerprintSnapshot["actions"]);
    if (!snapshot || snapshot.dealer.id !== input.dealerId || snapshot.binding.id !== input.bindingId ||
        !snapshot.binding.verifiedAt) throw new Error(SAFE_FAILURE);
    const tasks = photoTasks(snapshot);
    const progress = progressFor(payload, input, report.fingerprint, snapshot.binding.registryKey, tasks);
    persisted = progress.photos.map(photo => photo.image);
    if (report.status !== "APPROVED" || !report.approvedById ||
        dealerSyncBlockReason({ ...snapshot.dealer, role: snapshot.dealer.role as "USER" | "DEALER" | "ADMIN" }) ||
        fingerprintSnapshot(snapshot) !== report.fingerprint) throw new Error(SAFE_FAILURE);
    const actor = await db.user.findUnique({
      where: { id: report.approvedById }, select: { role: true, disabledAt: true, deletedAt: true },
    });
    if (!actor || actor.role !== "ADMIN" || actor.disabledAt || actor.deletedAt) throw new Error(SAFE_FAILURE);
    guard();
    const renewed = await db.dealerStockSyncJob.updateMany({
      where: leaseWhere(input), data: { leaseExpiresAt: new Date(Date.now() + DESKTOP_JOB_LEASE_MS) },
    });
    if (renewed.count !== 1) return { outcome: "unavailable" };

    const task = tasks[progress.photos.length];
    if (task) {
      assertManagedUploadsConfigured();
      const attemptId = randomUUID();
      const publicId = previewImagePublicId(snapshot.binding.registryKey, task.identityKey, input.jobId + "-" + attemptId, task.photoIndex);
      const downloaded = await downloadSafeRemoteImage({ url: task.sourceUrl });
      guard();
      const image: PreviewUploadedImage = await uploadManagedImport({
        publicId, bytes: downloaded.bytes, contentType: downloaded.contentType ?? "", order: task.photoIndex,
      });
      unrecorded = [image];
      if (!ownedImage(image) || image.publicId !== publicId || image.order !== task.photoIndex) throw new Error(SAFE_FAILURE);
      const next: ApplyProgress = { ...progress, photos: [...progress.photos, { ...task, attemptId, image }] };
      const recorded = await db.dealerStockSyncJob.updateMany({
        where: leaseWhere(input),
        data: { payload: { ...payload, desktopApply: next } as unknown as Prisma.InputJsonValue },
      });
      if (recorded.count !== 1) {
        await cleanup(unrecorded);
        return { outcome: "unavailable" };
      }
      unrecorded = [];
      return { outcome: "continue" };
    }

    const used = new Set<string>();
    const stagedUpload: typeof uploadPreviewPackImages = async (request) => {
      const action = snapshot.actions.find(action => action.kind === "create" && action.sourceIdentityKey === request.identityKey);
      if (!action || action.kind !== "create" || request.dealerKey !== snapshot.binding.registryKey ||
          used.has(request.identityKey) || request.sources.length !== action.sourceImageUrls!.slice(0, 20).length ||
          request.sources.some((source, index) => source.localPath !== null || source.order !== index ||
            source.url !== action.sourceImageUrls![index])) throw new Error(SAFE_FAILURE);
      used.add(request.identityKey);
      const images = progress.photos.filter(photo => photo.identityKey === request.identityKey).map(photo => photo.image);
      if (images.length !== Math.min(action.sourceImageUrls!.length, PREVIEW_PACK_PHOTO_LIMIT)) throw new Error(SAFE_FAILURE);
      return images;
    };
    guard();
    // These images are durable job progress, shared with a successor after lease expiry.
    // Only this step's terminal owner fence may enqueue their failure cleanup.
    await runLeasedJob({ id: input.jobId, owner: input.busyOwner }, async () => { throw new Error(SAFE_FAILURE); },
      stagedUpload, guard, async () => undefined, { applyTransactionTimeoutMs: 180_000 });
    const terminal = await db.dealerStockSyncJob.findUnique({
      where: { id: input.jobId }, select: { status: true, leaseOwner: true },
    });
    if (terminal?.leaseOwner === input.busyOwner && terminal.status === "SUCCEEDED") return { outcome: "succeeded" };
    if (terminal?.leaseOwner === input.busyOwner && terminal.status === "FAILED") {
      await cleanup(persisted);
      return { outcome: "failed" };
    }
    return { outcome: "unavailable" };
  } catch {
    // A thrown payload write may have committed. Do not clean its photo until
    // terminal ownership is established; a successor may already be using it.
    let failed = false;
    try {
      const changed = await db.dealerStockSyncJob.updateMany({
        where: leaseWhere(input),
        data: { status: "FAILED", finishedAt: new Date(), leaseExpiresAt: null, error: SAFE_FAILURE },
      });
      failed = changed.count === 1;
    } catch { /* Keep the busy lease and durable receipts when the database is unavailable. */ }
    // Do not remove earlier staged photos after losing ownership to another worker.
    if (failed) await cleanup([...persisted, ...unrecorded]);
    return { outcome: failed ? "failed" : "unavailable" };
  }
}
