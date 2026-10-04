import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { IMAGEKIT_DISPOSABLE_PREFIX } from "@/lib/media/config";
import { deleteDisposableImageKitFile, uploadDisposableImage } from "@/lib/media/disposable-media";
import { getImageKitFileDetails } from "@/lib/media/imagekit-api";
import { stripListingImageMetadata } from "@/lib/media/strip-metadata";

async function raster(format: "jpeg" | "png" | "webp") {
  const image = sharp({
    create: { width: 800, height: 480, channels: 3, background: { r: 20, g: 80, b: 140 } },
  });
  if (format === "jpeg") return image.jpeg().withMetadata({ exif: { IFD0: { ImageDescription: "strip-me" } } }).toBuffer();
  if (format === "png") return image.png().toBuffer();
  return image.webp().toBuffer();
}

async function main() {
  const runId = randomUUID();
  const folder = `${IMAGEKIT_DISPOSABLE_PREFIX}tests/${runId}`;
  const results: Record<string, string> = {};
  for (const format of ["jpg", "png", "webp"] as const) {
    const source = await raster(format === "jpg" ? "jpeg" : format);
    const stripped = await stripListingImageMetadata({ bytes: source, format });
    const metadata = await sharp(stripped.bytes).metadata();
    if (metadata.exif) throw new Error(`${format} metadata was not stripped.`);
    results[format] = "stripped";
  }
  await expectUnsupported("mp4");
  await expectUnsupported("heic");

  const first = await stripListingImageMetadata({ bytes: await raster("jpeg"), format: "jpg" });
  const uploaded = await uploadDisposableImage({
    bytes: first.bytes,
    fileName: "replace-me.jpg",
    folder,
    purpose: "mutation-test",
  });
  const replacement = await stripListingImageMetadata({ bytes: await raster("png"), format: "png" });
  const replaced = await uploadDisposableImage({
    bytes: replacement.bytes,
    fileName: "replacement.png",
    folder,
    purpose: "mutation-test",
  });
  await deleteDisposableImageKitFile({ fileId: uploaded.fileId });
  await deleteDisposableImageKitFile({ fileId: replaced.fileId });
  const gone = await getImageKitFileDetails({ fileId: replaced.fileId });
  if (gone) throw new Error("Disposable file was still present after deletion.");
  results.replacement = "uploaded-replaced-deleted";
  console.log(JSON.stringify({ runId, results }));
}

async function expectUnsupported(format: string) {
  await stripListingImageMetadata({ bytes: Buffer.from("unsupported"), format }).then(
    () => {
      throw new Error(`${format} should be unsupported.`);
    },
    () => undefined,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Disposable media test failed.");
  process.exit(1);
});
