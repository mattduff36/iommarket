import { createHash } from "node:crypto";
import { z } from "zod";
import { mediaDatabaseIdentity } from "@/lib/media/environment-boundary";
import { decideImageKitBackfill } from "@/lib/media/backfill-decision";
import { cloudinaryIdentityFromUrl, matchMediaReference } from "@/lib/media/match-reference";
import type { MigrationIndex } from "@/lib/media/migration-index";
import { isManagedListingPath, managedMediaPublicId } from "@/lib/media/managed-policy";

export const PRODUCTION_BACKFILL_PROJECT = "snlqivvogfqesxpbjiei";
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const REVIEWED_ADMIN_PREVIEW_CSV_SHA256 = "671f24c07a4f20b653dc9d17dcbda67929503b70007078237b0f400c2e50f0c4";
export const REVIEWED_ADMIN_PREVIEW_LISTING_IDS_SHA256 = "26d46f7b5e07be32a83d57e33f8b36d0439f317d98d5b89a34a70895e1856375";
export const REVIEWED_ADMIN_PREVIEW_ROW_IDS_SHA256 = "697a064c7561a5046d7f925f73a2ceec160adb4902016c14b80a0c989c363539";
export const ADMIN_PREVIEW_EXCLUSION_REASON = "reviewed-unpublished-admin-preview";
const sourceSchema = z.object({
  table: z.enum(["ListingImage", "ListingRevisionImage"]), id: z.string().min(1).max(80),
  provider: z.string().min(1).max(30), assetId: z.string().nullable(), publicId: z.string(),
  version: z.string().nullable(), url: z.string().max(6000),
  imageKitFileId: z.string().nullable(), imageKitFilePath: z.string().nullable(),
}).strict();
const destinationSchema = z.object({ fileId: z.string().regex(ID), filePath: z.string() }).strict();
const adminPreviewManifestRowSchema = z.object({
  id: z.string().min(1).max(80), listingId: z.string().min(1).max(80), status: z.literal("ADMIN_PREVIEW"),
  reviewState: z.literal("NONE"), source: sourceSchema,
}).strict();
const adminPreviewManifestBodySchema = z.object({
  version: z.literal(1), reviewedListingCsvSha256: z.literal(REVIEWED_ADMIN_PREVIEW_CSV_SHA256),
  reviewedListingIdsSha256: z.literal(REVIEWED_ADMIN_PREVIEW_LISTING_IDS_SHA256),
  reviewedRowIdsSha256: z.literal(REVIEWED_ADMIN_PREVIEW_ROW_IDS_SHA256),
  listingIds: z.array(z.string().min(1).max(80)).length(94), entries: z.array(adminPreviewManifestRowSchema).length(350),
}).strict();
export const adminPreviewExclusionManifestSchema = adminPreviewManifestBodySchema.extend({ digest: z.string().regex(SHA256) }).strict();
export type AdminPreviewExclusionManifest = z.infer<typeof adminPreviewExclusionManifestSchema>;
export const sourceVersionProofSchema = z.object({
  table: z.enum(["ListingImage", "ListingRevisionImage"]), id: z.string().min(1).max(80),
  assetId: z.string().min(1), storedVersion: z.string().regex(/^\d+$/), migratedVersion: z.string().regex(/^\d+$/),
  bytes: z.number().int().positive(), sha256: z.string().regex(SHA256), verifiedAt: z.string().datetime(),
}).strict();
export type SourceVersionProof = z.infer<typeof sourceVersionProofSchema>;
const entrySchema = z.object({
  source: sourceSchema,
  status: z.enum(["write", "unchanged", "external", "native", "blocked", "excluded"]),
  reason: z.string(), destination: destinationSchema.optional(),
  sourceVersionProof: sourceVersionProofSchema.optional(),
  exclusionProof: z.object({ listingId: z.string().min(1).max(80), reason: z.literal(ADMIN_PREVIEW_EXCLUSION_REASON), manifestSha256: z.string().regex(SHA256) }).strict().optional(),
}).strict();
const countsSchema = z.object({ write: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), external: z.number().int().nonnegative(), native: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), excluded: z.number().int().nonnegative() }).strict();
const planSchema = z.object({
  version: z.literal(2), project: z.literal(PRODUCTION_BACKFILL_PROJECT), createdAt: z.string().datetime(),
  mapSha256: z.string().regex(SHA256), entries: z.array(entrySchema), counts: countsSchema, digest: z.string().regex(SHA256),
}).strict();
export type ProductionBackfillSource = z.infer<typeof sourceSchema>;
export type ProductionBackfillEntry = z.infer<typeof entrySchema>;
export type ProductionBackfillPlan = z.infer<typeof planSchema>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }

export function validateAdminPreviewExclusionManifest(value: unknown): AdminPreviewExclusionManifest {
  const manifest = adminPreviewExclusionManifestSchema.parse(value);
  const { digest: supplied, ...body } = manifest;
  if (supplied !== digest(body)) throw new Error("Reviewed ADMIN_PREVIEW exclusion manifest digest is invalid.");
  const listingIds = [...new Set(manifest.listingIds)].sort();
  if (listingIds.length !== 94 || canonical(listingIds) !== canonical(manifest.listingIds)) throw new Error("Reviewed ADMIN_PREVIEW listing allowlist is duplicated or unsorted.");
  if (createHash("sha256").update(listingIds.join("\n")).digest("hex") !== REVIEWED_ADMIN_PREVIEW_LISTING_IDS_SHA256) throw new Error("Reviewed ADMIN_PREVIEW listing IDs do not match the approved CSV scope.");
  const entries = [...manifest.entries].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(entries.map((entry) => entry.id)).size !== 350 || canonical(entries.map(({ id }) => id)) !== canonical(manifest.entries.map(({ id }) => id))) {
    throw new Error("Reviewed ADMIN_PREVIEW row allowlist is duplicated or unsorted.");
  }
  if (createHash("sha256").update(entries.map((entry) => entry.id).join("\n")).digest("hex") !== REVIEWED_ADMIN_PREVIEW_ROW_IDS_SHA256) throw new Error("Reviewed ADMIN_PREVIEW row IDs do not match the approved source scope.");
  if (entries.some((entry) => entry.source.table !== "ListingImage" || entry.source.id !== entry.id || !listingIds.includes(entry.listingId))) {
    throw new Error("Reviewed ADMIN_PREVIEW manifest contains a row outside its exact listing scope.");
  }
  if (new Set(entries.map((entry) => entry.listingId)).size !== 94) throw new Error("Reviewed ADMIN_PREVIEW manifest does not cover the exact listing scope.");
  return manifest;
}

function assertReviewedMap(index: MigrationIndex) {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of index.byAssetId.values()) {
    // The first slash is intentional; check the remaining path segments for traversal.
    const safePath = /^\/iommarket-migration(?:-sample)?\/[A-Za-z0-9_./-]+$/.test(asset.destinationPath) &&
      !asset.destinationPath.slice(1).split("/").some((segment) => !segment || segment === "." || segment === "..");
    if (!safePath || !ID.test(asset.destinationFileId) || !SHA256.test(asset.sourceSha256) ||
      !Number.isSafeInteger(asset.sourceBytes) || asset.sourceBytes <= 0 || !asset.privateVerified) {
      throw new Error("Production backfill requires a complete checksummed private migration map.");
    }
    if (ids.has(asset.destinationFileId) || paths.has(asset.destinationPath)) throw new Error("Migration map repeats a destination identity.");
    ids.add(asset.destinationFileId); paths.add(asset.destinationPath);
  }
}

function planEntry(source: ProductionBackfillSource, index: MigrationIndex, proof: SourceVersionProof | undefined, now: Date): ProductionBackfillEntry {
  const blocked = (reason: string): ProductionBackfillEntry => ({ source, status: "blocked", reason });
  if (source.provider === "IMAGEKIT") {
    const path = source.imageKitFilePath;
    if (path && source.imageKitFileId && ID.test(source.imageKitFileId) && isManagedListingPath(path) &&
      path.startsWith("/iommarket-media/production/") && managedMediaPublicId(path) === source.publicId) {
      return { source, status: "native", reason: "Production-native ImageKit identity is already stored.", destination: { fileId: source.imageKitFileId, filePath: path } };
    }
    return blocked("Native media does not have a complete production identity.");
  }
  const match = matchMediaReference(source, index);
  if (match.kind === "not-cloudinary" && source.provider === "EXTERNAL") {
    try {
      const external = new URL(source.url);
      if (external.protocol !== "https:" || external.username || external.password || external.hostname === "res.cloudinary.com") {
        return blocked("External or demo metadata still points to an unverified or Cloudinary source.");
      }
    } catch { return blocked("External source URL is invalid."); }
    return { source, status: "external", reason: "Non-Cloudinary reference remains on its existing provider." };
  }
  if (!match.asset) return blocked(match.reason);
  let url: URL;
  try { url = new URL(source.url); } catch { return blocked("Stored source URL is invalid."); }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.username || url.password || url.port || url.pathname.split("/")[1] !== "du3othqre") {
    return blocked("Cloudinary source account is not the verified migration account.");
  }
  const fromUrl = cloudinaryIdentityFromUrl(source.url);
  if (!fromUrl || fromUrl.publicId !== match.asset.sourcePublicId || !/^\d+$/.test(fromUrl.version)) {
    return blocked("Stored source URL does not identify the migrated original.");
  }
  const version = source.version || fromUrl?.version;
  if (!version || (fromUrl?.version && fromUrl.version !== version)) {
    return blocked("Source version is missing or conflicts with the migrated original.");
  }
  if (source.provider === "CLOUDINARY" && source.publicId !== match.asset.sourcePublicId) return blocked("Source public id conflicts with its migrated asset identity.");
  const versionDiffers = version !== match.asset.sourceVersion;
  if (versionDiffers) {
    const age = proof ? now.getTime() - new Date(proof.verifiedAt).getTime() : Infinity;
    if (!proof || age < -60_000 || age > 24 * 3600_000 || proof.table !== source.table || proof.id !== source.id ||
      proof.assetId !== source.assetId || proof.assetId !== match.asset.assetId || source.publicId !== match.asset.sourcePublicId ||
      proof.storedVersion !== version || proof.migratedVersion !== match.asset.sourceVersion ||
      proof.bytes !== match.asset.sourceBytes || proof.sha256 !== match.asset.sourceSha256) {
      return blocked("Source version is missing or conflicts with the migrated original.");
    }
  }
  if (source.imageKitFileId === "" || source.imageKitFilePath === "") return blocked("Stored ImageKit identity is malformed.");
  // Only the identity decision uses the byte-proven equivalent version. Stored source fields remain untouched.
  const decision = decideImageKitBackfill({ match, reference: { ...source, version: match.asset.sourceVersion } });
  if (decision.action === "refuse") return blocked(decision.reason);
  return { source, status: decision.action, reason: versionDiffers ? "Stored source version has a reviewed identical-original checksum proof." : match.reason,
    destination: { fileId: decision.fileId, filePath: decision.filePath }, ...(versionDiffers ? { sourceVersionProof: proof } : {}) };
}

export function createProductionBackfillPlan(input: { rows: ProductionBackfillSource[]; index: MigrationIndex; mapSha256: string; now?: Date; versionProofs?: SourceVersionProof[]; adminPreviewExclusions?: unknown }): ProductionBackfillPlan {
  if (!SHA256.test(input.mapSha256)) throw new Error("Migration map digest is invalid.");
  assertReviewedMap(input.index);
  const now = input.now ?? new Date();
  const proofs = new Map<string, SourceVersionProof>();
  for (const value of input.versionProofs ?? []) {
    const proof = sourceVersionProofSchema.parse(value);
    const key = `${proof.table}:${proof.id}`;
    if (proofs.has(key)) throw new Error("Source version evidence repeats a row.");
    proofs.set(key, proof);
  }
  const exclusions = input.adminPreviewExclusions === undefined ? undefined : validateAdminPreviewExclusionManifest(input.adminPreviewExclusions);
  const exclusionById = new Map(exclusions?.entries.map((entry) => [entry.id, entry]) ?? []);
  const foundExclusions = new Set<string>();
  const seen = new Set<string>();
  const entries = input.rows.map((raw) => {
    const row = sourceSchema.parse(raw);
    const key = `${row.table}:${row.id}`;
    if (seen.has(key)) throw new Error("Production backfill contains a duplicate source row.");
    seen.add(key);
    const planned = planEntry(row, input.index, proofs.get(key), now);
    const reviewed = exclusionById.get(row.id);
    if (!reviewed) return planned;
    if (row.table !== "ListingImage" || canonical(row) !== canonical(reviewed.source) || planned.status !== "blocked") {
      throw new Error("Reviewed ADMIN_PREVIEW source identity no longer matches the blocked plan row.");
    }
    foundExclusions.add(row.id);
    return { source: row, status: "excluded" as const, reason: ADMIN_PREVIEW_EXCLUSION_REASON,
      exclusionProof: { listingId: reviewed.listingId, reason: ADMIN_PREVIEW_EXCLUSION_REASON as typeof ADMIN_PREVIEW_EXCLUSION_REASON, manifestSha256: exclusions!.digest } };
  }).sort((a, b) => `${a.source.table}:${a.source.id}`.localeCompare(`${b.source.table}:${b.source.id}`));
  if (foundExclusions.size !== exclusionById.size) throw new Error("The source census does not contain every exact reviewed ADMIN_PREVIEW row.");
  const counts = entries.reduce((value, entry) => ({ ...value, [entry.status]: value[entry.status] + 1 }), { write: 0, unchanged: 0, external: 0, native: 0, blocked: 0, excluded: 0 });
  const body: Omit<ProductionBackfillPlan, "digest"> = { version: 2, project: PRODUCTION_BACKFILL_PROJECT, createdAt: now.toISOString(), mapSha256: input.mapSha256, entries, counts };
  return { ...body, digest: digest(body) };
}

export function verifyProductionBackfillPlan(value: unknown, approvedDigest: string, now = new Date()) {
  const plan = planSchema.parse(value);
  const { digest: supplied, ...body } = plan;
  if (supplied !== digest(body) || approvedDigest !== supplied) throw new Error("Approved backfill digest does not match this plan.");
  const age = now.getTime() - new Date(plan.createdAt).getTime();
  if (age < -60_000 || age > 24 * 3600_000) throw new Error("The backfill plan expired or has an invalid timestamp.");
  if (plan.entries.some((entry) => entry.status === "blocked") || plan.counts.blocked !== 0) throw new Error("Required production references remain unresolved.");
  if (plan.counts.excluded !== plan.entries.filter((entry) => entry.status === "excluded").length || plan.entries.some((entry) => entry.status === "excluded" && (!entry.exclusionProof || entry.destination))) {
    throw new Error("Reviewed ADMIN_PREVIEW exclusions are malformed.");
  }
  const keys = plan.entries.map((entry) => `${entry.source.table}:${entry.source.id}`);
  if (new Set(keys).size !== keys.length) throw new Error("Backfill plan contains duplicate rows.");
  return plan;
}

export function assertProductionBackfillTarget(databaseUrl: string) {
  if (mediaDatabaseIdentity(databaseUrl) !== PRODUCTION_BACKFILL_PROJECT) throw new Error("Backfill target is not the verified production project.");
}

export function classifyBackfillRow(current: ProductionBackfillSource, entry: ProductionBackfillEntry) {
  const source = sourceSchema.parse(current);
  if (!entry.destination || entry.status !== "write") throw new Error("This plan entry is not an approved write.");
  const core = (row: ProductionBackfillSource) => ({ ...row, imageKitFileId: null, imageKitFilePath: null });
  if (canonical(core(source)) !== canonical(core(entry.source))) throw new Error("The production source row changed after planning.");
  if (source.imageKitFileId === entry.destination.fileId && source.imageKitFilePath === entry.destination.filePath) return "already-applied";
  if (canonical(source) !== canonical(entry.source)) throw new Error("The production mapping changed after planning.");
  return "pending";
}

export function conditionalBackfillStatement(entry: ProductionBackfillEntry) {
  const parsed = entrySchema.parse(entry);
  if (parsed.status !== "write" || !parsed.destination || parsed.source.imageKitFileId !== null || parsed.source.imageKitFilePath !== null) throw new Error("Entry is not an empty, approved identity write.");
  const { source, destination } = parsed;
  const safePath = /^\/iommarket-migration(?:-sample)?\/[A-Za-z0-9_./-]+$/.test(destination.filePath) &&
    !destination.filePath.slice(1).split("/").some((segment) => !segment || segment === "." || segment === "..");
  if (!safePath) throw new Error("Backfill destination path is invalid.");
  const columns = ["provider", "assetId", "publicId", "version", "url", "imageKitFileId", "imageKitFilePath"] as const;
  return {
    text: `UPDATE public."${source.table}" SET "imageKitFileId" = $1, "imageKitFilePath" = $2 WHERE id = $3 AND ${columns.map((column, index) => `"${column}"${column === "provider" ? "::text" : ""} IS NOT DISTINCT FROM $${index + 4}`).join(" AND ")} RETURNING id`,
    values: [destination.fileId, destination.filePath, source.id, ...columns.map((column) => source[column])],
  };
}
