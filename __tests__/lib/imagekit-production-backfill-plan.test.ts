import { describe, expect, it } from "vitest";
import { buildMigrationIndex } from "@/lib/media/migration-index";
import { createProductionBackfillPlan, verifyProductionBackfillPlan, classifyBackfillRow, conditionalBackfillStatement, assertProductionBackfillTarget } from "@/lib/media/production-backfill-plan";

const now = new Date("2026-10-05T00:00:00Z");
const asset = {
  assetId: "asset-1", sourcePublicId: "iommarket/listings/staging/user/photo", sourceVersion: "10",
  destinationFileId: "file-1", destinationPath: "/iommarket-migration/photo.jpg",
  resourceType: "image", format: "jpg", sourceBytes: 100, sourceSha256: "a".repeat(64), privateVerified: true,
};
const row = {
  table: "ListingImage" as const, id: "image-1", provider: "CLOUDINARY", assetId: "asset-1",
  publicId: asset.sourcePublicId, version: "10",
  url: "https://res.cloudinary.com/du3othqre/image/private/v10/iommarket/listings/staging/user/photo.jpg",
  imageKitFileId: null, imageKitFilePath: null,
};
const build = (rows = [row], entries = [asset]) => createProductionBackfillPlan({
  rows, index: buildMigrationIndex(entries), mapSha256: "b".repeat(64), now,
});

describe("digest-bound production ImageKit backfill planning", () => {
  it("proposes only identity writes and keeps the Cloudinary source untouched", () => {
    const plan = build();
    expect(plan.counts.write).toBe(1);
    expect(plan.entries[0]?.source).toEqual(row);
    expect(plan.entries[0]?.destination).toEqual({ fileId: "file-1", filePath: asset.destinationPath });
    expect(() => verifyProductionBackfillPlan(plan, plan.digest, now)).not.toThrow();
    const statement = conditionalBackfillStatement(plan.entries[0]!);
    expect(statement.text).toContain('UPDATE public."ListingImage" SET "imageKitFileId" = $1');
    expect(statement.text).toContain('"url" IS NOT DISTINCT FROM');
    expect(statement.values).toContain(row.url);
    expect(statement.text).not.toContain(row.url);
    expect(statement.text).not.toContain('SET "url"');
  });

  it("refuses missing, version-conflicting and already conflicting identities", () => {
    for (const changed of [
      { ...row, assetId: "missing", publicId: "absent" },
      { ...row, version: "9" },
      { ...row, imageKitFileId: "wrong", imageKitFilePath: asset.destinationPath },
    ]) expect(build([changed as typeof row]).counts.blocked).toBe(1);
  });

  it("does not accept an incomplete or non-private map as verified evidence", () => {
    for (const changed of [{ ...asset, privateVerified: false }, { ...asset, sourceSha256: "short" }]) {
      expect(() => build([row], [changed])).toThrow();
    }
    expect(() => build([row], [asset, { ...asset, assetId: "asset-2", sourcePublicId: "other" }])).toThrow(/destination/);
  });

  it("rejects an approved digest mismatch, altered plan or stale plan", () => {
    const plan = build();
    expect(() => verifyProductionBackfillPlan(plan, "c".repeat(64), now)).toThrow(/digest/);
    expect(() => verifyProductionBackfillPlan({ ...plan, mapSha256: "d".repeat(64) }, plan.digest, now)).toThrow(/digest/);
    expect(() => verifyProductionBackfillPlan(plan, plan.digest, new Date(now.getTime() + 25 * 3600_000))).toThrow(/expired/);
  });

  it("blocks apply when required references remain unresolved", () => {
    const plan = build([{ ...row, version: "9" }]);
    expect(() => verifyProductionBackfillPlan(plan, plan.digest, now)).toThrow(/unresolved/);
  });

  it("detects concurrent source changes and supports idempotent resume", () => {
    const entry = build().entries[0]!;
    expect(classifyBackfillRow(row, entry)).toBe("pending");
    expect(classifyBackfillRow({ ...row, imageKitFileId: "file-1", imageKitFilePath: asset.destinationPath }, entry)).toBe("already-applied");
    expect(() => classifyBackfillRow({ ...row, version: "11" }, entry)).toThrow(/changed/);
    expect(() => classifyBackfillRow({ ...row, imageKitFileId: "other" }, entry)).toThrow(/changed/);
  });

  it("rejects duplicate source rows", () => {
    expect(() => build([row, row])).toThrow(/duplicate/i);
  });

  it("never accepts local, preview or lookalike databases as production", () => {
    expect(() => assertProductionBackfillTarget("postgresql://postgres.snlqivvogfqesxpbjiei@aws-1-eu-west-2.pooler.supabase.com/postgres")).not.toThrow();
    for (const target of [
      "postgresql://user@localhost/test",
      "postgresql://postgres.syneonzucehwlghqmfbg@aws-0-eu-west-2.pooler.supabase.com/postgres",
      "postgresql://postgres.snlqivvogfqesxpbjiei@attacker.example/postgres",
    ]) expect(() => assertProductionBackfillTarget(target)).toThrow();
  });
});
