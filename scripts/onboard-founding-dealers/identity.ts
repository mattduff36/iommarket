import { createHash } from "node:crypto";
import { LISTING_IMAGE_FOLDER } from "../../lib/images/constraints";

export function foundingListingSlug(dealerKey: string, identityKey: string) {
  const digest = createHash("sha256")
    .update(`founding-listing:${dealerKey}:${identityKey}`)
    .digest("hex")
    .slice(0, 32);
  return `fd-${dealerKey}-${digest}`;
}

export function foundingImagePublicId(dealerKey: string, listingSlug: string, order: number) {
  return `${LISTING_IMAGE_FOLDER}/founding/${dealerKey}/${listingSlug}/${order}`;
}

export function foundingArchiveChecksum(parts: Array<Buffer | string>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(typeof part === "string" ? part : part);
  }
  return hash.digest("hex");
}

export function fileSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
