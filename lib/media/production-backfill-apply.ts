import { createHash } from "node:crypto";
import { z } from "zod";
import { imageKitDeliveryRelativePath } from "@/lib/media/imagekit-transforms";
import { signedImageKitDeliveryUrl } from "@/lib/media/imagekit-api";
import { buildMigrationIndex, type MigrationAsset, type MigrationIndex } from "@/lib/media/migration-index";
import {
  classifyBackfillRow,
  createProductionBackfillPlan,
  verifyProductionBackfillPlan,
  type ProductionBackfillEntry,
  type ProductionBackfillPlan,
  type ProductionBackfillSource,
} from "@/lib/media/production-backfill-plan";

const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({
  version: z.literal(1), planDigest: shaSchema, mapSha256: shaSchema,
  checkedAt: z.string().datetime(), destinations: z.array(z.object({
    table: z.enum(["ListingImage", "ListingRevisionImage"]), id: z.string(), fileId: z.string(), filePath: z.string(),
    size: z.number().int().positive(), sha256: shaSchema, isPrivate: z.literal(true),
  }).strict()), digest: shaSchema,
}).strict();

export type ProductionBackfillReceipt = z.infer<typeof receiptSchema>;
export type BackfillQueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
export interface BackfillClient {
  query(text: string, values?: unknown[]): Promise<BackfillQueryResult>;
}
export interface DestinationVerifier {
  verify(asset: MigrationAsset): Promise<{ size: number; sha256: string; isPrivate: true }>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }

export function validateProductionBackfillInputs(input: {
  planValue: unknown; approvedDigest: string; mapRows: Array<Record<string, unknown>>; mapSha256: string; now?: Date;
}) {
  shaSchema.parse(input.mapSha256);
  const index = buildMigrationIndex(input.mapRows);
  const plan = verifyProductionBackfillPlan(input.planValue, input.approvedDigest, input.now);
  if (plan.mapSha256 !== input.mapSha256) throw new Error("The migration map bytes differ from the approved plan.");
  const recomputed = createProductionBackfillPlan({
    rows: plan.entries.map((entry) => entry.source), index, mapSha256: input.mapSha256,
    now: new Date(plan.createdAt), versionProofs: plan.entries.flatMap((entry) => entry.sourceVersionProof ? [entry.sourceVersionProof] : []),
  });
  if (recomputed.digest !== plan.digest || canonical(recomputed.entries) !== canonical(plan.entries) || canonical(recomputed.counts) !== canonical(plan.counts)) {
    throw new Error("The plan destinations or counts do not match canonical planning from the supplied map.");
  }
  if (plan.counts.write <= 0) throw new Error("The approved plan contains no identity writes.");
  return { plan, index };
}

function writeAssets(plan: ProductionBackfillPlan, index: MigrationIndex) {
  return plan.entries.filter((entry) => entry.status === "write").map((entry) => {
    const asset = entry.source.assetId ? index.byAssetId.get(entry.source.assetId) : undefined;
    const byVersion = index.byPublicVersion.get(`${entry.source.publicId}\n${entry.source.version ?? ""}`);
    const match = asset ?? byVersion;
    if (!entry.destination || !match || match.destinationFileId !== entry.destination.fileId || match.destinationPath !== entry.destination.filePath) {
      throw new Error("A planned write is not bound to an exact migration-map destination.");
    }
    return { entry, asset: match };
  });
}

async function mapConcurrent<T>(values: T[], limit: number, work: (value: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      await work(values[index]!);
    }
  }));
}

export function createImageKitDestinationVerifier(input: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): DestinationVerifier {
  const fetcher = input.fetchImpl ?? fetch;
  const env = input.env ?? process.env;
  let inventoryPromise: Promise<Map<string, { fileId: string; filePath: string; size: number; isPrivateFile: boolean; fileType: string; type: string }>> | null = null;
  const inventory = () => {
    if (!inventoryPromise) inventoryPromise = (async () => {
      const privateKey = env.IMAGEKIT_PRIVATE_KEY;
      if (!privateKey) throw new Error("ImageKit private API key is not configured.");
      const authorization = `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;
      const files = new Map<string, { fileId: string; filePath: string; size: number; isPrivateFile: boolean; fileType: string; type: string }>();
      const limit = 1000;
      for (let skip = 0; skip < 100_000; skip += limit) {
        const target = new URL("https://api.imagekit.io/v1/files");
        target.searchParams.set("limit", String(limit));
        target.searchParams.set("skip", String(skip));
        target.searchParams.set("type", "file");
        const response = await fetcher(target, { headers: { Authorization: authorization }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`ImageKit inventory request failed: ${response.status}`);
        const page: unknown = await response.json();
        if (!Array.isArray(page)) throw new Error("ImageKit inventory response was incomplete.");
        for (const value of page) {
          if (!value || typeof value !== "object") throw new Error("ImageKit inventory contains an invalid record.");
          const file = value as Record<string, unknown>;
          if (typeof file.fileId !== "string" || typeof file.filePath !== "string" || typeof file.size !== "number" ||
            typeof file.isPrivateFile !== "boolean" || typeof file.fileType !== "string" || typeof file.type !== "string") {
            throw new Error("ImageKit inventory omitted required identity or file verification fields.");
          }
          const record = { fileId: file.fileId, filePath: file.filePath, size: file.size,
            isPrivateFile: file.isPrivateFile, fileType: file.fileType, type: file.type };
          const existing = files.get(file.fileId);
          if (existing && canonical(existing) !== canonical(record)) throw new Error("ImageKit inventory repeats a file identity with conflicting metadata.");
          files.set(file.fileId, record);
        }
        if (page.length < limit) return files;
      }
      throw new Error("ImageKit inventory exceeded the bounded 100-page scan.");
    })();
    return inventoryPromise;
  };
  return {
    async verify(asset) {
      const files = await inventory();
      const details = files.get(asset.destinationFileId);
      if (!details || details.fileId !== asset.destinationFileId || details.filePath !== asset.destinationPath ||
        details.size !== asset.sourceBytes || details.isPrivateFile !== true || details.fileType !== "image" || details.type !== "file") {
        throw new Error("A destination's live ImageKit inventory does not match the private image migration map.");
      }
      const url = signedImageKitDeliveryUrl({ relativePath: imageKitDeliveryRelativePath(asset.destinationPath), env });
      const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new Error("A signed destination original could not be fetched for checksum verification.");
      const digest = createHash("sha256");
      const reader = response.body.getReader();
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > asset.sourceBytes) throw new Error("A destination original exceeds its verified source size.");
          digest.update(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const sha256 = digest.digest("hex");
      if (size !== asset.sourceBytes || sha256 !== asset.sourceSha256) throw new Error("A destination original checksum differs from the verified migration map.");
      return { size, sha256, isPrivate: true };
    },
  };
}

export async function verifyProductionDestinations(input: {
  plan: ProductionBackfillPlan; index: MigrationIndex; verifier: DestinationVerifier; now?: Date;
}) {
  const checkedAt = (input.now ?? new Date()).toISOString();
  const destinations: ProductionBackfillReceipt["destinations"] = [];
  const writes = writeAssets(input.plan, input.index);
  const unique = new Map<string, MigrationAsset>();
  for (const { asset } of writes) {
    const key = `${asset.destinationFileId}\n${asset.destinationPath}`;
    const previous = unique.get(key);
    if (previous && (previous.sourceBytes !== asset.sourceBytes || previous.sourceSha256 !== asset.sourceSha256)) {
      throw new Error("One ImageKit destination is mapped to conflicting source checksums.");
    }
    unique.set(key, asset);
  }
  const verified = new Map<string, { size: number; sha256: string; isPrivate: true }>();
  await mapConcurrent([...unique.entries()], 3, async ([key, asset]) => {
    const result = await input.verifier.verify(asset);
    if (result.size !== asset.sourceBytes || result.sha256 !== asset.sourceSha256 || result.isPrivate !== true) {
      throw new Error("Destination verification did not prove the expected private original.");
    }
    verified.set(key, result);
  });
  for (const { entry, asset } of writes) {
    const result = verified.get(`${asset.destinationFileId}\n${asset.destinationPath}`)!;
    destinations.push({ table: entry.source.table, id: entry.source.id, fileId: asset.destinationFileId, filePath: asset.destinationPath,
      size: result.size, sha256: result.sha256, isPrivate: true });
  }
  destinations.sort((a, b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`));
  const body = { version: 1 as const, planDigest: input.plan.digest, mapSha256: input.plan.mapSha256, checkedAt, destinations };
  return { ...body, digest: hash(body) };
}

export function verifyProductionBackfillReceipt(value: unknown, plan: ProductionBackfillPlan, index: MigrationIndex, now = new Date()) {
  const receipt = receiptSchema.parse(value);
  const { digest, ...body } = receipt;
  if (digest !== hash(body) || receipt.planDigest !== plan.digest || receipt.mapSha256 !== plan.mapSha256) throw new Error("Destination receipt is not bound to this approved plan and map.");
  const age = now.getTime() - new Date(receipt.checkedAt).getTime();
  if (age < -60_000 || age > 30 * 60_000) throw new Error("Destination verification receipt is stale.");
  const expected = writeAssets(plan, index)
    .map(({ entry, asset }) => `${entry.source.table}:${entry.source.id}:${asset.destinationFileId}:${asset.destinationPath}:${asset.sourceBytes}:${asset.sourceSha256}:true`).sort();
  const actual = receipt.destinations.map((item) => `${item.table}:${item.id}:${item.fileId}:${item.filePath}:${item.size}:${item.sha256}:${item.isPrivate}`).sort();
  if (canonical(expected) !== canonical(actual)) throw new Error("Destination receipt does not cover the exact planned write set.");
  return receipt;
}

function sourceRows(rows: Array<Record<string, unknown>>, table: ProductionBackfillSource["table"]): ProductionBackfillSource[] {
  return rows.map((row) => ({ ...row, table }) as ProductionBackfillSource);
}

export async function censusAndClassify(client: BackfillClient, plan: ProductionBackfillPlan) {
  const current: ProductionBackfillSource[] = [];
  for (const table of ["ListingImage", "ListingRevisionImage"] as const) {
    const result = await client.query(`SELECT id, provider::text AS provider, "assetId", "publicId", version, url, "imageKitFileId", "imageKitFilePath" FROM public."${table}" ORDER BY id`);
    current.push(...sourceRows(result.rows, table));
  }
  const expected = new Map(plan.entries.map((entry) => [`${entry.source.table}:${entry.source.id}`, entry]));
  if (current.length !== expected.size) throw new Error("Production source census count differs from the approved plan.");
  const states: Array<{ entry: ProductionBackfillEntry; state: "pending" | "already-applied" | "unchanged" }> = [];
  for (const row of current) {
    const key = `${row.table}:${row.id}`;
    const entry = expected.get(key);
    if (!entry) throw new Error("Production contains a row outside the approved source census.");
    expected.delete(key);
    if (entry.status === "write") states.push({ entry, state: classifyBackfillRow(row, entry) });
    else if (canonical(row) !== canonical(entry.source)) throw new Error("A non-write production row changed after planning.");
    else states.push({ entry, state: "unchanged" });
  }
  if (expected.size) throw new Error("Approved source rows are missing from the production census.");
  return states;
}

function batchUpdateStatement(table: ProductionBackfillSource["table"]) {
  return `WITH proposed AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text, provider text, "assetId" text, "publicId" text, version text, url text, "imageKitFileId" text, "imageKitFilePath" text, "destinationFileId" text, "destinationFilePath" text)) UPDATE public."${table}" AS current SET "imageKitFileId" = proposed."destinationFileId", "imageKitFilePath" = proposed."destinationFilePath" FROM proposed WHERE current.id = proposed.id AND current.provider::text IS NOT DISTINCT FROM proposed.provider AND current."assetId" IS NOT DISTINCT FROM proposed."assetId" AND current."publicId" IS NOT DISTINCT FROM proposed."publicId" AND current.version IS NOT DISTINCT FROM proposed.version AND current.url IS NOT DISTINCT FROM proposed.url AND current."imageKitFileId" IS NOT DISTINCT FROM proposed."imageKitFileId" AND current."imageKitFilePath" IS NOT DISTINCT FROM proposed."imageKitFilePath" RETURNING current.id`;
}

export async function executeProductionBackfillTransaction(client: BackfillClient, plan: ProductionBackfillPlan) {
  let began = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); began = true;
    await client.query("SET LOCAL statement_timeout = '30000ms'");
    await client.query("SET LOCAL lock_timeout = '10000ms'");
    await client.query('LOCK TABLE public."ListingImage", public."ListingRevisionImage" IN SHARE ROW EXCLUSIVE MODE');
    const states = await censusAndClassify(client, plan);
    const pending = states.filter((state) => state.state === "pending").map((state) => state.entry);
    const updated: string[] = [];
    for (const table of ["ListingImage", "ListingRevisionImage"] as const) {
      const entries = pending.filter((entry) => entry.source.table === table);
      if (!entries.length) continue;
      const values = entries.map(({ source, destination }) => ({ ...source, destinationFileId: destination!.fileId, destinationFilePath: destination!.filePath }));
      const result = await client.query(batchUpdateStatement(table), [JSON.stringify(values)]);
      const expectedIds = entries.map((entry) => entry.source.id).sort();
      const returnedIds = result.rows.map((row) => String(row.id)).sort();
      if (canonical(expectedIds) !== canonical(returnedIds)) throw new Error("Conditional production update count differed from the approved write set.");
      updated.push(...returnedIds);
    }
    const postflight = await censusAndClassify(client, plan);
    if (postflight.some((state) => state.state === "pending")) throw new Error("Post-update census found an unapplied approved identity.");
    await client.query("COMMIT"); began = false;
    return { updatedCount: updated.length, resumedCount: states.filter((state) => state.state === "already-applied").length };
  } catch (error) {
    if (began) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

