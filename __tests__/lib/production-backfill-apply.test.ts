import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildMigrationIndex } from "@/lib/media/migration-index";
import {
  censusAndClassify,
  createImageKitDestinationVerifier,
  executeProductionBackfillTransaction,
  validateProductionBackfillInputs,
  verifyProductionBackfillReceipt,
  verifyProductionDestinations,
  type BackfillClient,
  type BackfillQueryResult,
} from "@/lib/media/production-backfill-apply";
import { createProductionBackfillPlan } from "@/lib/media/production-backfill-plan";

const instant = new Date("2026-10-07T12:00:00.000Z");
const asset = {
  assetId: "asset-1", sourcePublicId: "iommarket/listings/staging/user/photo", sourceVersion: "10",
  destinationFileId: "file-1", destinationPath: "/iommarket-migration/photo.jpg", resourceType: "image", format: "jpg",
  sourceBytes: 3, sourceSha256: createHash("sha256").update("abc").digest("hex"), privateVerified: true,
};
const source = {
  table: "ListingImage" as const, id: "image-1", provider: "CLOUDINARY", assetId: "asset-1", publicId: asset.sourcePublicId,
  version: "10", url: "https://res.cloudinary.com/du3othqre/image/private/v10/iommarket/listings/staging/user/photo.jpg",
  imageKitFileId: null, imageKitFilePath: null,
};
const mapRows = [asset];
const mapBytesHash = "b".repeat(64);
const index = buildMigrationIndex(mapRows);
const plan = createProductionBackfillPlan({ rows: [source], index, mapSha256: mapBytesHash, now: instant });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function redigest(value: Record<string, unknown>) {
  const { digest: _digest, ...body } = value;
  return { ...body, digest: createHash("sha256").update(canonical(body)).digest("hex") };
}
function inputs(planValue: unknown = plan, overrides: Partial<{ approvedDigest: string; mapSha256: string; rows: Array<Record<string, unknown>> }> = {}) {
  return validateProductionBackfillInputs({ planValue, approvedDigest: overrides.approvedDigest ?? plan.digest,
    mapRows: overrides.rows ?? mapRows, mapSha256: overrides.mapSha256 ?? mapBytesHash, now: instant });
}
function fixtureReceipt() {
  return verifyProductionDestinations({ plan, index, now: instant, verifier: { verify: async () => ({ size: asset.sourceBytes, sha256: asset.sourceSha256, isPrivate: true }) } });
}

class CensusClient implements BackfillClient {
  statements: string[] = [];
  constructor(public rows: Array<Record<string, unknown>>, private updateRows?: Array<Record<string, unknown>>) {}
  async query(text: string, _values?: unknown[]): Promise<BackfillQueryResult> {
    this.statements.push(text);
    if (text.startsWith("SELECT id, provider")) {
      const table = text.includes('"ListingRevisionImage"') ? "ListingRevisionImage" : "ListingImage";
      return { rows: this.rows.filter((row) => row.table === table) };
    }
    if (text.startsWith("WITH proposed")) {
      if (this.updateRows) return { rows: this.updateRows };
      const proposed = JSON.parse(String(_values?.[0] ?? "[]")) as Array<{ id: string; destinationFileId: string; destinationFilePath: string }>;
      this.rows = this.rows.map((row) => {
        const target = proposed.find((entry) => entry.id === row.id);
        return target ? { ...row, imageKitFileId: target.destinationFileId, imageKitFilePath: target.destinationFilePath } : row;
      });
      return { rows: proposed.map(({ id }) => ({ id })) };
    }
    return { rows: [] };
  }
}

describe("safe production identity apply gates", () => {
  it("requires exact map bytes and canonical recomputation of destinations and counts", () => {
    expect(() => inputs(plan, { mapSha256: "c".repeat(64) })).toThrow(/map bytes/i);
    const forged = redigest({ ...plan, entries: [{ ...plan.entries[0]!, destination: { fileId: "file-2", filePath: "/iommarket-migration/other.jpg" } }] });
    expect(() => inputs(forged, { approvedDigest: forged.digest })).toThrow(/canonical planning/i);
    const wrongCounts = redigest({ ...plan, counts: { ...plan.counts, write: 0 } });
    expect(() => inputs(wrongCounts, { approvedDigest: wrongCounts.digest })).toThrow(/canonical planning/i);
  });

  it("rejects stale approval and remains blocked when planner has unresolved references", () => {
    expect(() => validateProductionBackfillInputs({ planValue: plan, approvedDigest: "d".repeat(64), mapRows, mapSha256: mapBytesHash, now: instant })).toThrow(/digest/i);
    const blocked = createProductionBackfillPlan({ rows: [{ ...source, version: "9" }], index, mapSha256: mapBytesHash, now: instant });
    expect(() => validateProductionBackfillInputs({ planValue: blocked, approvedDigest: blocked.digest, mapRows, mapSha256: mapBytesHash, now: instant })).toThrow(/unresolved/i);
  });

  it("checks the complete source keyset and each non-write row against the approved census", async () => {
    const twoRowPlan = createProductionBackfillPlan({ rows: [source, { ...source, id: "image-2", provider: "EXTERNAL", assetId: null,
      publicId: "external", version: null, url: "https://images.example/photo.jpg" }], index, mapSha256: mapBytesHash, now: instant });
    const nonWrite = twoRowPlan.entries.find((entry) => entry.source.id === "image-2")!.source;
    const fixture = (rows: Array<Record<string, unknown>>) => new CensusClient(rows);
    const valid = await censusAndClassify(fixture([{ ...source, table: "ListingImage" }, { ...nonWrite, table: "ListingImage" }]), twoRowPlan);
    expect(valid.map((state) => state.state)).toEqual(["pending", "unchanged"]);
    await expect(censusAndClassify(fixture([{ ...source, table: "ListingImage" }]), twoRowPlan)).rejects.toThrow(/count/i);
    await expect(censusAndClassify(fixture([{ ...source, table: "ListingImage" }, { ...nonWrite, table: "ListingImage" },
      { ...nonWrite, id: "added", table: "ListingImage" }]), twoRowPlan)).rejects.toThrow(/count/i);
    await expect(censusAndClassify(fixture([{ ...source, table: "ListingImage" }, { ...nonWrite, url: "https://images.example/changed.jpg", table: "ListingImage" }]), twoRowPlan)).rejects.toThrow(/non-write/i);
  });

  it("binds persisted destination receipts to exact private destination, size and checksum", async () => {
    const receipt = await fixtureReceipt();
    expect(() => verifyProductionBackfillReceipt(receipt, plan, index, instant)).not.toThrow();
    const forged = redigest({ ...receipt, destinations: [{ ...receipt.destinations[0]!, sha256: "e".repeat(64) }] });
    expect(() => verifyProductionBackfillReceipt(forged, plan, index, instant)).toThrow(/exact planned write set/i);
    expect(() => verifyProductionBackfillReceipt(receipt, plan, index, new Date(instant.getTime() + 31 * 60_000))).toThrow(/stale/i);
    const incomplete = { ...receipt, destinations: [] };
    expect(() => verifyProductionBackfillReceipt(redigest(incomplete), plan, index, instant)).toThrow(/exact planned write set/i);
  });

  it("bounds independent destination checks to three and propagates a verification failure", async () => {
    const manyAssets = Array.from({ length: 5 }, (_, n) => ({ ...asset, assetId: `asset-${n}`, sourcePublicId: `iommarket/listings/staging/user/photo-${n}`,
      destinationFileId: `file-${n}`, destinationPath: `/iommarket-migration/photo-${n}.jpg` }));
    const manySources = manyAssets.map((item, n) => ({ ...source, id: `image-${n}`, assetId: item.assetId, publicId: item.sourcePublicId }));
    const multiIndex = buildMigrationIndex(manyAssets);
    const multiPlan = createProductionBackfillPlan({ rows: manySources, index: multiIndex, mapSha256: mapBytesHash, now: instant });
    let active = 0; let peak = 0;
    const verifier = { verify: async () => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; return { size: asset.sourceBytes, sha256: asset.sourceSha256, isPrivate: true as const }; } };
    await verifyProductionDestinations({ plan: multiPlan, index: multiIndex, verifier, now: instant });
    expect(peak).toBeLessThanOrEqual(3);
    await expect(verifyProductionDestinations({ plan, index, now: instant, verifier: { verify: async () => { throw new Error("bad original"); } } })).rejects.toThrow(/bad original/);
  });

  it("rolls back when a conditional batch update returns an incomplete identity set", async () => {
    const client = new CensusClient([{ ...source, table: "ListingImage" }], []);
    await expect(executeProductionBackfillTransaction(client, plan)).rejects.toThrow(/conditional production update count/i);
    expect(client.statements).toContain("ROLLBACK");
    expect(client.statements).not.toContain("COMMIT");
    expect(client.statements.some((statement) => statement.startsWith("WITH proposed"))).toBe(true);
  });

  it("rolls back if the post-update census still sees a pending row", async () => {
    const client = new CensusClient([{ ...source, table: "ListingImage" }], [{ id: source.id }]);
    await expect(executeProductionBackfillTransaction(client, plan)).rejects.toThrow(/post-update census/i);
    expect(client.statements).toContain("ROLLBACK");
    expect(client.statements).not.toContain("COMMIT");
  });

  it("rechecks the complete census after updates before committing", async () => {
    const client = new CensusClient([{ ...source, table: "ListingImage" }]);
    await expect(executeProductionBackfillTransaction(client, plan)).resolves.toEqual({ updatedCount: 1, resumedCount: 0 });
    expect(client.statements.filter((statement) => statement.startsWith("SELECT id, provider"))).toHaveLength(4);
    expect(client.statements).toContain("COMMIT");
  });

  it("allows exact resume but does not update already-applied rows", async () => {
    const applied = { ...source, imageKitFileId: asset.destinationFileId, imageKitFilePath: asset.destinationPath, table: "ListingImage" };
    const client = new CensusClient([applied]);
    await expect(executeProductionBackfillTransaction(client, plan)).resolves.toEqual({ updatedCount: 0, resumedCount: 1 });
    expect(client.statements.some((statement) => statement.startsWith("WITH proposed"))).toBe(false);
    expect(client.statements).toContain("COMMIT");
  });

  it("keeps the ImageKit verifier private: exact live identity and signed original checksum are required", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url.includes("api.imagekit.io/v1/files?") ? "inventory" : "delivery");
      if (url.includes("api.imagekit.io/v1/files?")) return Response.json([{ type: "file", fileType: "image", fileId: asset.destinationFileId,
        filePath: asset.destinationPath, size: asset.sourceBytes, isPrivateFile: true }]);
      return new Response("abc", { status: 200 });
    }) as typeof fetch;
    const verified = await createImageKitDestinationVerifier({ env: { NODE_ENV: "test", IMAGEKIT_PRIVATE_KEY: "test", IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/test" }, fetchImpl }).verify(asset);
    expect(verified).toEqual({ size: 3, sha256: asset.sourceSha256, isPrivate: true });
    expect(calls).toEqual(["inventory", "delivery"]);
    expect(calls.join(" ")).not.toContain("ik-s");
  });
});
