import { isSampleDestinationPath } from "@/lib/media/config";
import {
  publicVersionKey,
  type MigrationAsset,
  type MigrationIndex,
} from "@/lib/media/migration-index";

export type ReferenceMatchKind =
  | "exact-asset-id"
  | "exact-public-id-version"
  | "ambiguous"
  | "missing"
  | "not-cloudinary";

export interface MediaReference {
  provider?: string | null;
  assetId?: string | null;
  publicId?: string | null;
  version?: string | null;
  url?: string | null;
}

export interface ReferenceMatch {
  kind: ReferenceMatchKind;
  asset?: MigrationAsset;
  reason: string;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function cloudinaryIdentityFromUrl(url: string | null | undefined) {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host !== "res.cloudinary.com") return null;
  const marker = parsed.pathname.includes("/image/private/")
    ? "/image/private/"
    : parsed.pathname.includes("/image/upload/")
      ? "/image/upload/"
      : null;
  if (!marker) return null;
  let rest = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length));
  rest = rest.replace(/^s--[A-Za-z0-9_-]+--\//, "");
  const versionMatch = /^v(\d+)\//.exec(rest);
  const version = versionMatch?.[1] ?? "";
  if (versionMatch) rest = rest.slice(versionMatch[0].length);
  const publicId = rest.replace(/\.[a-z0-9]+$/i, "");
  if (!publicId || publicId.includes("..")) return null;
  return { publicId, version };
}

function matchPublicVersion(publicId: string, version: string, index: MigrationIndex): ReferenceMatch {
  if (version) {
    const asset = index.byPublicVersion.get(publicVersionKey(publicId, version));
    if (asset) {
      return { kind: "exact-public-id-version", asset, reason: "Public id and version matched one migrated original." };
    }
  }
  const versions = index.byPublicId.get(publicId) ?? [];
  if (versions.length === 0) return { kind: "missing", reason: "Public id is not in the migrated snapshot." };
  return {
    kind: "ambiguous",
    reason: version
      ? "Public id exists, but the version does not match a migrated original."
      : "Public id matches more than one migrated version.",
  };
}

export function matchMediaReference(reference: MediaReference, index: MigrationIndex): ReferenceMatch {
  const provider = reference.provider ?? "CLOUDINARY";
  if (reference.publicId?.startsWith("demo/") || reference.publicId?.startsWith("imagekit-dev/")) {
    return { kind: "not-cloudinary", reason: "Reference is not a Cloudinary original." };
  }

  const assetId = clean(reference.assetId);
  if (assetId && index.byAssetId.has(assetId)) {
    return {
      kind: "exact-asset-id",
      asset: index.byAssetId.get(assetId),
      reason: "Asset id matched one migrated original.",
    };
  }

  const publicId = clean(reference.publicId);
  const version = clean(reference.version);
  if (publicId && (provider === "CLOUDINARY" || provider === "EXTERNAL")) {
    const direct = matchPublicVersion(publicId, version ?? "", index);
    if (provider === "CLOUDINARY" || direct.kind === "exact-public-id-version") return direct;
  }

  const fromUrl = cloudinaryIdentityFromUrl(reference.url);
  if (fromUrl) return matchPublicVersion(fromUrl.publicId, fromUrl.version, index);

  if (provider === "EXTERNAL" || reference.publicId?.startsWith("demo/")) {
    return { kind: "not-cloudinary", reason: "Reference is not a Cloudinary original." };
  }
  if (!publicId) return { kind: "missing", reason: "Reference has no asset id or public id." };
  return matchPublicVersion(publicId, version ?? "", index);
}

export function referenceUsesSample(match: ReferenceMatch) {
  return Boolean(match.asset && isSampleDestinationPath(match.asset.destinationPath));
}
