import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../../lib/listings/photo-limits";
import { isIgnoredImageUrl } from "../html-media";
import { uniqueImageUrls } from "../map-listing";
import type { ImageArchiveRecord } from "../types";

export async function archiveImages(input: {
  imageDir: string;
  imageUrls: string[];
  fetchImpl?: typeof fetch;
  enabled?: boolean;
}): Promise<ImageArchiveRecord[]> {
  if (input.enabled === false) {
    return uniqueImageUrls(input.imageUrls).map((url) => ({
      originalUrl: url,
      localPath: null,
      contentType: null,
      bytes: null,
      checksum: null,
      status: "skipped" as const,
      error: "image mirroring disabled",
    }));
  }

  await mkdir(input.imageDir, { recursive: true });
  const records: ImageArchiveRecord[] = [];
  const urls = uniqueImageUrls(input.imageUrls, FEATURED_LISTING_PHOTO_LIMIT);

  for (const [index, url] of urls.entries()) {
    if (isIgnoredImageUrl(url)) {
      records.push({
        originalUrl: url,
        localPath: null,
        contentType: null,
        bytes: null,
        checksum: null,
        status: "skipped",
        error: "ignored asset",
      });
      continue;
    }
    try {
      const response = await (input.fetchImpl ?? fetch)(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const extension = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const fileName = `${String(index).padStart(2, "0")}-${checksum.slice(0, 10)}.${extension}`;
      const localPath = join(input.imageDir, fileName);
      await writeFile(localPath, bytes);
      records.push({
        originalUrl: url,
        localPath,
        contentType,
        bytes: bytes.length,
        checksum,
        status: "ok",
        error: null,
      });
    } catch (error) {
      records.push({
        originalUrl: url,
        localPath: null,
        contentType: null,
        bytes: null,
        checksum: null,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return records;
}
