import { readFileSync, writeFileSync, existsSync } from "node:fs";

const sourceEnvPath = "D:/Websites/iommarket/.env.local";
const credentialPath = "D:/Websites/imagekit-credentials/itrader.env";
const targetPath = "D:/Websites/iommarket-imagekit/.env.local";
const developmentRef = "syneonzucehwlghqmfbg";
const productionRef = "snlqivvogfqesxpbjiei";
const expectedEndpoint = "https://ik.imagekit.io/itraderim";

const omitted = new Set([
  "VERCEL_BILLING_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "SUPABASE_ACCESS_TOKEN",
  "COST_SYNC_SECRET",
  "COST_LEDGER_INGEST_SECRET",
  "COST_LEDGER_READ_SECRET",
  "COST_LEDGER_REQUEST_SECRET",
  "DVLA_API_KEY",
  "MOT_API_CLIENT_SECRET",
  "MOT_API_KEY",
  "MOT_API_ACCESS_TOKEN_URL",
]);

function parseEnv(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    entries.push([line.slice(0, index).trim(), line.slice(index + 1)]);
  }
  return entries;
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

if (!existsSync(sourceEnvPath) || !existsSync(credentialPath)) {
  throw new Error("Required local env files are missing.");
}

const sourceText = readFileSync(sourceEnvPath, "utf8");
const source = parseEnv(sourceText);
const sourceMap = new Map(source.map(([key, value]) => [key, unquote(value)]));
const databaseUrl = sourceMap.get("DATABASE_URL") ?? "";
const supabaseUrl = sourceMap.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
if (!databaseUrl.includes(developmentRef) || !supabaseUrl.includes(developmentRef)) {
  throw new Error("Refusing to prepare an env that is not the verified development project.");
}
if (databaseUrl.includes(productionRef) || supabaseUrl.includes(productionRef)) {
  throw new Error("Refusing to prepare an env that points at production.");
}

const credentials = new Map(parseEnv(readFileSync(credentialPath, "utf8")).map(([key, value]) => [key, unquote(value)]));
const endpoint = credentials.get("IMAGEKIT_URL_ENDPOINT") ?? "";
if (endpoint !== expectedEndpoint) {
  throw new Error("ImageKit endpoint does not match the verified itraderim endpoint.");
}
for (const key of ["IMAGEKIT_PRIVATE_KEY", "IMAGEKIT_PUBLIC_KEY", "IMAGEKIT_URL_ENDPOINT"]) {
  if (!credentials.get(key)) throw new Error(`Missing ${key} in the credential file.`);
}

const overrides = new Map([
  ["RIPPLE_LIVE_CHECKOUT_ENABLED", "0"],
  ["RESEND_API_KEY", ""],
  ["POLICY_ENABLE_DELETION_WORKER", "false"],
  ["POLICY_RETENTION_MUTATE", "false"],
  ["COSTS_ENABLED", "0"],
  ["NEXT_PUBLIC_APP_URL", "http://localhost:4010"],
  ["MEDIA_PROVIDER", "imagekit"],
  ["NEXT_PUBLIC_MEDIA_PROVIDER", "imagekit"],
  ["MEDIA_IMAGEKIT_STRICT", "1"],
  ["IMAGEKIT_DEV_UPLOADS", "1"],
  ["IMAGEKIT_SIGNATURE_TTL_SECONDS", "300"],
  ["IMAGEKIT_URL_ENDPOINT", endpoint],
  ["IMAGEKIT_PUBLIC_KEY", credentials.get("IMAGEKIT_PUBLIC_KEY")],
  ["IMAGEKIT_PRIVATE_KEY", credentials.get("IMAGEKIT_PRIVATE_KEY")],
  ["IMAGEKIT_MIGRATION_MAP", "D:/Websites/iommarket-imagekit-migration/reports/source-destination-map.jsonl"],
  ["IMAGEKIT_METADATA_SIDECAR", "D:/Websites/iommarket-imagekit-migration/reports/source-metadata-sidecar.jsonl"],
  ["IMAGEKIT_DEV_MANIFEST", "D:/Websites/iommarket-imagekit/tmp/imagekit-dev-manifest.jsonl"],
  ["CLOUDINARY_BACKUP_INVENTORY", "D:/Websites/iommarket-cloudinary-backup/2026-10-03T15-37-21-919Z/inventory/resources.jsonl"],
  ["CLOUDINARY_BACKUP_INVENTORY_PASS2", "D:/Websites/iommarket-cloudinary-backup/2026-10-03T15-37-21-919Z/inventory/resources-pass2.jsonl"],
]);

const kept = sourceText
  .split(/\r?\n/)
  .filter((line) => {
    const key = line.split("=", 1)[0];
    return !omitted.has(key) && !overrides.has(key);
  });
const lines = [
  "# Isolated ImageKit worktree env. Generated locally. Do not commit.",
  "# Payments, email, cost sync and retention mutation are disabled.",
  ...kept,
  ...[...overrides].map(([key, value]) => `${key}=${value ?? ""}`),
];

writeFileSync(targetPath, `${lines.join("\n")}\n`, { flag: "w" });
console.log(`Prepared isolated env for development project ${developmentRef}.`);
console.log("Live checkout, email, cost sync and retention mutation are disabled.");
console.log("ImageKit private key loaded into the worktree env only.");
