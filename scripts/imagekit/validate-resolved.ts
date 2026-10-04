import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { loadMigrationIndex } from "@/lib/media/migration-index";
import { matchMediaReference } from "@/lib/media/match-reference";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";
import { imageKitDeliveryRelativePath, imageKitFitTransform } from "@/lib/media/imagekit-transforms";
import sharp from "sharp";
import { focalCoverCrop } from "@/lib/media/focal-crop";

const checkpointPath = "tmp/imagekit-validation-checkpoint.jsonl";

function checkedIds() {
  if (!existsSync(checkpointPath)) return new Set<string>();
  return new Set(
    readFileSync(checkpointPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { id: string }).id),
  );
}

async function statusOf(url: string) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
  await response.body?.cancel();
  return response.status;
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current) await worker(current);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
}

async function main() {
  const mapPath = process.env.IMAGEKIT_MIGRATION_MAP;
  if (!mapPath) throw new Error("IMAGEKIT_MIGRATION_MAP is not configured.");
  const index = loadMigrationIndex(mapPath);
  const images = await db.listingImage.findMany({
    select: {
      id: true,
      provider: true,
      assetId: true,
      publicId: true,
      version: true,
      url: true,
      width: true,
      height: true,
      format: true,
      bytes: true,
    },
  });
  const resolved = images.flatMap((image) => {
    const match = matchMediaReference(image, index);
    return match.asset ? [{ image, asset: match.asset }] : [];
  });
  const done = checkedIds();
  const pending = resolved.filter((item) => !done.has(item.image.id));
  mkdirSync("tmp", { recursive: true });
  let failed = 0;
  await mapPool(pending, 6, async (item) => {
    const transform = item.asset.resourceType === "video"
      ? undefined
      : imageKitFitTransform(160, 100);
    const url = signedImageKitDeliveryUrl({
      relativePath: imageKitDeliveryRelativePath(item.asset.destinationPath, transform),
    });
    const status = await statusOf(url);
    const row = { id: item.image.id, status, path: item.asset.destinationPath, at: new Date().toISOString() };
    appendFileSync(checkpointPath, `${JSON.stringify(row)}\n`);
    if (status !== 200) failed += 1;
  });

  const sample = resolved.find((item) => item.asset.resourceType === "image");
  let unsignedStatus: number | null = null;
  if (sample) {
    const endpoint = process.env.IMAGEKIT_URL_ENDPOINT ?? "";
    unsignedStatus = await statusOf(`${endpoint}${sample.asset.destinationPath}`);
  }

  const focalTarget = resolved.find((item) =>
    item.asset.resourceType === "image" &&
    item.image.width &&
    item.image.height &&
    item.image.bytes &&
    item.image.bytes < 1_500_000 &&
    (item.image.format === "jpg" || item.image.format === "png"),
  );
  let focal: Record<string, unknown> = { checked: false };
  if (focalTarget?.image.width && focalTarget.image.height) {
    const originalUrl = signedImageKitDeliveryUrl({
      relativePath: imageKitDeliveryRelativePath(focalTarget.asset.destinationPath, "orig-true"),
    });
    const originalResponse = await fetch(originalUrl, { redirect: "manual" });
    const original = Buffer.from(await originalResponse.arrayBuffer());
    const crop = focalCoverCrop({
      sourceWidth: focalTarget.image.width,
      sourceHeight: focalTarget.image.height,
      targetWidth: 320,
      targetHeight: 200,
      focalX: 0.15,
      focalY: 0.8,
    });
    const expected = await sharp(original).extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    }).resize(320, 200, { fit: "fill" }).raw().toBuffer();
    const transform = `x-${crop.x},y-${crop.y},w-${crop.width},h-${crop.height},cm-extract:w-320,h-200,c-force`;
    const actualResponse = await fetch(signedImageKitDeliveryUrl({
      relativePath: imageKitDeliveryRelativePath(focalTarget.asset.destinationPath, transform),
    }), { redirect: "manual" });
    const actualBytes = Buffer.from(await actualResponse.arrayBuffer());
    const actualMeta = await sharp(actualBytes).metadata();
    const actual = await sharp(actualBytes).resize(320, 200, { fit: "fill" }).raw().toBuffer();
    let drift = 0;
    const length = Math.min(expected.length, actual.length);
    for (let i = 0; i < length; i += 1) drift += Math.abs((expected[i] ?? 0) - (actual[i] ?? 0));
    const meanAbs = length ? drift / length : Number.POSITIVE_INFINITY;
    focal = {
      checked: true,
      imageId: focalTarget.image.id,
      status: actualResponse.status,
      width: actualMeta.width,
      height: actualMeta.height,
      crop,
      meanAbsoluteChannelDelta: Number(meanAbs.toFixed(2)),
      pass: actualResponse.status === 200 && actualMeta.width === 320 && actualMeta.height === 200 && meanAbs < 40,
    };
  }

  const video = [...index.byAssetId.values()].find((asset) => asset.resourceType === "video");
  let videoStatus: number | null = null;
  if (video) {
    videoStatus = await statusOf(signedImageKitDeliveryUrl({
      relativePath: imageKitDeliveryRelativePath(video.destinationPath),
    }));
  }

  const summary = {
    resolved: resolved.length,
    checked: pending.length,
    failed,
    unsignedStatus,
    videoStatus,
    focal,
  };
  console.log(JSON.stringify(summary, null, 2));
  await db.$disconnect();
  if (failed > 0 || unsignedStatus !== 401 || videoStatus !== 200 || (focal.checked && focal.pass !== true)) process.exit(1);
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Validation failed.");
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
