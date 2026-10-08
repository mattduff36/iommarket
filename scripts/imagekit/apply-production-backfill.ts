import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Client } from "pg";
import { databaseSslOptions, sanitiseConnectionString } from "@/lib/db/pool-options";
import { mediaDatabaseIdentity } from "@/lib/media/environment-boundary";
import { buildMigrationIndex } from "@/lib/media/migration-index";
import {
  censusAndClassify,
  createImageKitDestinationVerifier,
  executeProductionBackfillTransaction,
  validateProductionBackfillInputs,
  verifyProductionBackfillReceipt,
  verifyProductionDestinations,
} from "@/lib/media/production-backfill-apply";
import { assertProductionBackfillTarget } from "@/lib/media/production-backfill-plan";

type Settings = { apply: boolean; verifyOnly: boolean; plan: string; map: string; digest: string; verification?: string; output?: string; adminPreviewExclusions?: string };

function options(args: string[]): Settings {
  const values: Record<string, string> = {};
  let apply = false;
  let verifyOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]!;
    if (key === "--apply" || key === "--verify-destinations") {
      if (key === "--apply" ? apply : verifyOnly) throw new Error("Duplicate mode flag.");
      if (key === "--apply") apply = true; else verifyOnly = true;
      continue;
    }
    const value = args[++index];
    if (!["--plan", "--map", "--approved-digest", "--verification", "--output", "--admin-preview-exclusions"].includes(key) || !value || value.startsWith("--") || values[key]) {
      throw new Error("Invalid command options.");
    }
    values[key] = value;
  }
  if (apply && verifyOnly) throw new Error("Choose apply or destination verification, not both.");
  if (!values["--plan"] || !values["--map"] || !values["--approved-digest"]) throw new Error("--plan, --map and --approved-digest are required.");
  if (apply && !values["--verification"]) throw new Error("--apply requires a separately persisted --verification receipt.");
  if (verifyOnly && !values["--output"]) throw new Error("--verify-destinations requires --output for its receipt.");
  if (values["--output"]) {
    const output = resolve(values["--output"]);
    if (!output.startsWith(resolve("tmp") + sep)) throw new Error("Evidence output must be inside the ignored tmp directory.");
    values["--output"] = output;
  }
  return { apply, verifyOnly, plan: resolve(values["--plan"]), map: resolve(values["--map"]), digest: values["--approved-digest"],
    verification: values["--verification"] ? resolve(values["--verification"]) : undefined, output: values["--output"],
    adminPreviewExclusions: values["--admin-preview-exclusions"] ? resolve(values["--admin-preview-exclusions"]) : undefined };
}

function loadInputs(settings: Settings) {
  const mapBytes = readFileSync(settings.map);
  const mapRows = mapBytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Record<string, unknown>);
  const mapSha256 = createHash("sha256").update(mapBytes).digest("hex");
  const planValue: unknown = JSON.parse(readFileSync(settings.plan, "utf8"));
  const adminPreviewExclusions = settings.adminPreviewExclusions
    ? JSON.parse(readFileSync(settings.adminPreviewExclusions, "utf8")) as unknown
    : undefined;
  const verified = validateProductionBackfillInputs({ planValue, approvedDigest: settings.digest, mapRows, mapSha256, adminPreviewExclusions });
  return { ...verified, index: buildMigrationIndex(mapRows) };
}

function productionConnection() {
  const urls = [process.env.POSTGRES_URL_NON_POOLING, process.env.POSTGRES_URL, process.env.DATABASE_URL].filter((value): value is string => Boolean(value));
  if (!urls.length) throw new Error("Production database configuration is missing.");
  const identities = new Set<string | null>();
  for (const raw of urls) {
    assertProductionBackfillTarget(raw);
    identities.add(mediaDatabaseIdentity(raw));
  }
  if (identities.size !== 1 || identities.has(null)) throw new Error("Configured database URLs disagree on production identity.");
  const raw = urls[0]!;
  return {
    connectionString: sanitiseConnectionString(raw), ssl: databaseSslOptions(raw, { ...process.env, NODE_ENV: "production" }),
    connectionTimeoutMillis: 10_000, application_name: "imagekit_production_identity_apply",
  };
}

async function main() {
  const settings = options(process.argv.slice(2));
  const { plan, index } = loadInputs(settings);
  const verifier = createImageKitDestinationVerifier();
  if (settings.verifyOnly) {
    const receipt = await verifyProductionDestinations({ plan, index, verifier });
    const output = settings.output!;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ mode: "destination-verification", receipt: output, planDigest: plan.digest, destinations: receipt.destinations.length }));
    return;
  }

  const client = new Client(productionConnection());
  try {
    await client.connect();
    if (settings.apply) {
      const receiptValue: unknown = JSON.parse(readFileSync(settings.verification!, "utf8"));
      verifyProductionBackfillReceipt(receiptValue, plan, index);
      // The separate persisted receipt is supplemented by live provider checks immediately before locking.
      await verifyProductionDestinations({ plan, index, verifier });
      const result = await executeProductionBackfillTransaction(client, plan);
      console.log(JSON.stringify({ mode: "applied", planDigest: plan.digest, ...result }));
      return;
    }

    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const mode = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
    if (mode.rows[0]?.read_only !== "on") throw new Error("Dry-run transaction is not read-only.");
    const states = await censusAndClassify(client, plan);
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ mode: "read-only-dry-run", planDigest: plan.digest,
      pending: states.filter((state) => state.state === "pending").length,
      alreadyApplied: states.filter((state) => state.state === "already-applied").length,
      unchanged: states.filter((state) => state.state === "unchanged").length }));
  } finally { await client.end().catch(() => undefined); }
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "APPLY_PREFLIGHT_FAILED";
  console.error(`ImageKit identity runner stopped (${code}). No result should be treated as a completed migration.`);
  process.exitCode = 1;
});
