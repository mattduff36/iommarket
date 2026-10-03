import { createHash } from "node:crypto";
import { buildCanonicalListingImageUrl, isTrustedListingPublicId } from "@/lib/images/cloudinary-url";
import { signCloudinaryDeliveryPath } from "@/lib/upload/cloudinary";
import { isIP } from "node:net";
import { isPublicIpAddress } from "@/lib/images/safe-remote-image";
import { markDatabaseSyncReference } from "@/lib/images/database-sync-reference";
import { DatabaseSyncError } from "./snapshot";
import type { SyncDataset, SyncRow } from "./types";

const IMPORT_PREFIX = "database-sync/";

function safePublicUrl(value: unknown): URL {
  try {
    const url = new URL(String(value));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      host !== "localhost" && !host.endsWith(".local") && (!isIP(host) || isPublicIpAddress(host))) return url;
  } catch { /* Fail closed below without exposing source row details. */ }
  throw new DatabaseSyncError("A production image has an unsupported delivery URL. No images were copied.");
}

function readonlyImage(row: SyncRow, env: NodeJS.ProcessEnv): SyncRow {
  const sourceUrl = safePublicUrl(row.url);
  const originalPublicId = typeof row.publicId === "string" ? row.publicId : "";
  let deliveryUrl = sourceUrl.toString();
  if (row.provider === "CLOUDINARY") {
    const cloud = env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const secret = env.CLOUDINARY_API_SECRET;
    if (!cloud || !secret || sourceUrl.hostname !== "res.cloudinary.com" ||
      sourceUrl.pathname.split("/")[1] !== cloud || !isTrustedListingPublicId(originalPublicId)) {
      throw new DatabaseSyncError("Production image delivery could not be verified for the configured media account.");
    }
    const version = row.version == null ? null : String(row.version);
    const format = row.format == null ? null : String(row.format);
    if ((version && !/^\d+$/.test(version)) || (format && !/^[a-z0-9]+$/i.test(format))) {
      throw new DatabaseSyncError("A production image has unsupported delivery metadata.");
    }
    const canonical = buildCanonicalListingImageUrl({
      provider: "CLOUDINARY", publicId: originalPublicId, version, format, url: sourceUrl.toString(),
    }, env);
    const prefix = `https://res.cloudinary.com/${cloud}/image/private/`;
    const path = canonical.slice(prefix.length);
    deliveryUrl = `${prefix}s--${signCloudinaryDeliveryPath(path, secret)}--/${path}`;
  } else if (row.provider !== "EXTERNAL") {
    throw new DatabaseSyncError("A production image has an unsupported storage provider.");
  }
  const publicId = row.provider === "EXTERNAL" && /^database-sync\/[a-f0-9]{64}$/.test(originalPublicId)
    ? originalPublicId
    : `${IMPORT_PREFIX}${createHash("sha256").update(`${row.provider}\0${originalPublicId || row.id}`).digest("hex")}`;
  // The namespace and EXTERNAL provider independently exclude production assets from cleanup.
  return { ...row, provider: "EXTERNAL", publicId, url: deliveryUrl, assetId: null, uploadIntentId: null };
}

/** Copy only read-only delivery references. Never create ownership of a production asset in staging. */
export function sanitiseSourceMedia(dataset: SyncDataset, env: NodeJS.ProcessEnv = process.env, importableDealerIds?: ReadonlySet<string>): SyncDataset {
  const DealerProfile = dataset.DealerProfile.map((dealer) => ({ ...dealer }));
  for (const dealer of DealerProfile) {
    if (!dealer.logoUrl || dealer.isAdminPreview === true) continue;
    if (importableDealerIds && !importableDealerIds.has(String(dealer.id))) continue;
    const logo = safePublicUrl(dealer.logoUrl);
    if (logo.hostname.endsWith("res.cloudinary.com")) {
      const cloud = env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (logo.hostname !== "res.cloudinary.com" || !cloud || logo.pathname.split("/")[1] !== cloud ||
        !/^\/[^/]+\/image\/(?:upload|private)\//.test(logo.pathname)) {
        throw new DatabaseSyncError("A production dealer logo could not be verified for the configured media account.");
      }
      dealer.logoUrl = markDatabaseSyncReference(logo.toString());
    }
  }
  return { ...dataset, DealerProfile, ListingImage: dataset.ListingImage.map((row) => readonlyImage(row, env)) };
}
