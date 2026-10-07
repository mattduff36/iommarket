import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Client } from "pg";
import { databaseSslOptions, sanitiseConnectionString } from "@/lib/db/pool-options";
import { buildMigrationIndex } from "@/lib/media/migration-index";
import { findMigratedDealerLogo } from "@/lib/media/migrated-dealer-logos";
import { assertProductionBackfillTarget, createProductionBackfillPlan, sourceVersionProofSchema, type ProductionBackfillSource } from "@/lib/media/production-backfill-plan";

// This command cannot apply changes. There is no apply flag or mutation path.
// Example: node --env-file=<verified-production-env> --import tsx scripts/imagekit/plan-production-backfill.ts --map <retained-map.jsonl>
function options() {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key || !["--map", "--output", "--version-proofs"].includes(key) || !value || value.startsWith("--") || values[key]) {
      throw new Error("Only --map, optional --version-proofs and --output paths are accepted. This command is read-only.");
    }
    values[key] = value;
  }
  if (!values["--map"]) throw new Error("A retained, verified migration map must be supplied with --map.");
  const output = resolve(values["--output"] ?? `tmp/imagekit-production-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  if (!output.startsWith(resolve("tmp") + sep)) throw new Error("Backfill plans must be written inside the ignored tmp directory.");
  return { map: resolve(values["--map"]), output, versionProofs: values["--version-proofs"] };
}

function sourceConnection() {
  const urls = [process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL, process.env.DATABASE_URL].filter((value): value is string => Boolean(value));
  if (!urls.length) throw new Error("An explicitly configured production database connection is required.");
  urls.forEach(assertProductionBackfillTarget);
  const raw = urls[0]!;
  return {
    connectionString: sanitiseConnectionString(raw),
    ssl: databaseSslOptions(raw, { ...process.env, NODE_ENV: "production" }),
    connectionTimeoutMillis: 10_000,
    application_name: "imagekit_production_readonly_plan",
  };
}

function logoReadiness(rows: Array<{ id: string; logoUrl: string | null }>) {
  return rows.map((row) => {
    const referenceHash = createHash("sha256").update(row.logoUrl ?? "").digest("hex");
    try {
      const url = new URL(row.logoUrl ?? "");
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid logo");
      if (url.hostname !== "res.cloudinary.com") return { id: row.id, referenceHash, status: "external" };
      url.hash = "";
      const matched = findMigratedDealerLogo(url.toString());
      return { id: row.id, referenceHash, status: matched?.resourceType === "image" ? "mapped" : "blocked" };
    } catch { return { id: row.id, referenceHash, status: "blocked" }; }
  });
}

async function main() {
  const settings = options();
  const bytes = readFileSync(settings.map);
  const index = buildMigrationIndex(bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)));
  const mapSha256 = createHash("sha256").update(bytes).digest("hex");
  const versionProofs = settings.versionProofs
    ? sourceVersionProofSchema.array().parse(JSON.parse(readFileSync(resolve(settings.versionProofs), "utf8")))
    : [];
  const client = new Client(sourceConnection());
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const mode = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
    if (mode.rows[0]?.read_only !== "on") throw new Error("The audit transaction is not read-only.");
    const rows: ProductionBackfillSource[] = [];
    for (const table of ["ListingImage", "ListingRevisionImage"] as const) {
      const result = await client.query(`SELECT id, provider::text AS provider, "assetId", "publicId", version, url, "imageKitFileId", "imageKitFilePath" FROM public."${table}" ORDER BY id`);
      rows.push(...result.rows.map((row) => ({ ...row, table })));
    }
    const logos = await client.query('SELECT id, "logoUrl" FROM public."DealerProfile" WHERE "logoUrl" IS NOT NULL');
    const avatars = await client.query('SELECT count(*)::integer AS count FROM public."User" WHERE "avatarUrl" LIKE $1', ["%res.cloudinary.com/%"]);
    const plan = createProductionBackfillPlan({ rows, index, mapSha256, versionProofs });
    const dealerLogos = logoReadiness(logos.rows);
    const readiness = {
      at: new Date().toISOString(), transactionReadOnly: true, planDigest: plan.digest,
      listingAndRevisionCounts: plan.counts, dealerLogos,
      potentialCloudinaryAvatars: avatars.rows[0]?.count ?? 0,
      note: "This is an identity plan, not proof of live destination availability, production approval or a completed cutover. No database or cloud assets were changed.",
    };
    await client.query("ROLLBACK");
    mkdirSync(dirname(settings.output), { recursive: true });
    writeFileSync(settings.output, JSON.stringify(plan, null, 2), { flag: "wx", mode: 0o600 });
    writeFileSync(settings.output + ".readiness.json", JSON.stringify(readiness, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({
      mode: "read-only-plan", output: settings.output, digest: plan.digest, counts: plan.counts,
      blockedDealerLogos: dealerLogos.filter((logo) => logo.status === "blocked").length,
      potentialCloudinaryAvatars: readiness.potentialCloudinaryAvatars,
    }));
  } finally { await client.end().catch(() => undefined); }
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "PLAN_FAILED";
  // Database/library errors may contain connection details. Reports never print those values.
  console.error(`Read-only ImageKit planning stopped (${code}). Verify the supplied map, target identity and TLS configuration. No apply operation exists in this command.`);
  process.exitCode = 1;
});
