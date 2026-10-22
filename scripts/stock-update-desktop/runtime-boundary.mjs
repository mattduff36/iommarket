/** Explicitly reviewed public scraping closure. New runtime dependencies require review. */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const CLIENT_VERSION = "1.1.0";
export const ALLOWED_RUNTIME_SOURCES = new Set([
  "scripts/dealer-stock-sync/desktop-worker.ts",
  "scripts/dealer-stock-sync/desktop-jobs-client.ts",
  "scripts/dealer-stock-sync/desktop-access.ts",
  "scripts/dealer-stock-sync/desktop-job-runner.ts",
  "scripts/dealer-stock-sync/registry.ts",
  "scripts/dealer-stock-sync/pipeline.ts",
  "scripts/dealer-stock-sync/connectors/detect.ts",
  "scripts/dealer-stock-sync/connectors/autoweb.ts",
  "scripts/dealer-stock-sync/connectors/html-extract.ts",
  "scripts/dealer-stock-sync/json.ts",
  "scripts/dealer-stock-sync/connectors/named-html.ts",
  "scripts/dealer-stock-sync/connectors/named-html-more.ts",
  "scripts/dealer-stock-sync/connectors/website-source.ts",
  "scripts/dealer-stock-sync/connectors/contract.ts",
  "scripts/dealer-stock-sync/html-media.ts",
  "lib/listings/photo-limits.ts",
  "scripts/dealer-stock-sync/image-urls.ts",
  "scripts/dealer-stock-sync/browse.ts",
  "scripts/dealer-stock-sync/rate-limit.ts",
  "scripts/dealer-stock-sync/connectors/click-dealer.ts",
  "scripts/dealer-stock-sync/connectors/csv.ts",
  "scripts/dealer-stock-sync/connectors/dealer-websites.ts",
  "scripts/dealer-stock-sync/connectors/dragon2000.ts",
  "scripts/dealer-stock-sync/connectors/html-structured.ts",
  "scripts/dealer-stock-sync/connectors/iomwebdesign.ts",
  "scripts/dealer-stock-sync/connectors/netdirector/index.ts",
  "scripts/dealer-stock-sync/connectors/netdirector/enrich.ts",
  "scripts/dealer-stock-sync/connectors/netdirector/normalize.ts",
  "scripts/dealer-stock-sync/connectors/netdirector/pagination.ts",
  "scripts/dealer-stock-sync/connectors/unknown.ts",
  "scripts/dealer-stock-sync/reconcile.ts",
  "scripts/import-ocean-inventory/locations.ts",
  "scripts/dealer-stock-sync/identity.ts"
]);
export const ALLOWED_RUNTIME_PACKAGES = new Set(["tsx", "sharp", "@playwright/test"]);
const FORBIDDEN_PACKAGE = /^(?:@prisma(?:\/|$)|prisma$|pg(?:-|$)|postgres(?:-|$)|mysql|mssql$|@supabase(?:\/|$)|cloudinary$|@cloudinary\/|imagekit$|@imagekit\/|server-only$|dotenv(?:-|$)|next$|@next\/|redis$|ioredis$|@upstash\/)/;
const SECRET_REFERENCE = /(?:DATABASE_URL|POSTGRES_URL|IMAGEKIT_PRIVATE_KEY|SUPABASE_SERVICE_ROLE_KEY|DEALER_STOCK_DESKTOP_CONFIG_JSON|postgres(?:ql)?:\/\/)/i;
const normal = value => value.replaceAll("\\", "/");

export function assertRuntimeSource(relativePath, text) {
  const file = normal(relativePath);
  if (!ALLOWED_RUNTIME_SOURCES.has(file)) throw new Error("Unreviewed desktop runtime source: " + file);
  if (SECRET_REFERENCE.test(text)) throw new Error("Secret or server credential reference in desktop source: " + file);
}
export function assertRuntimePackage(name) {
  if (!ALLOWED_RUNTIME_PACKAGES.has(name)) throw new Error("Unreviewed desktop runtime package: " + name);
}
export function assertRuntimeLock(lock) {
  for (const path of Object.keys(lock.packages ?? {})) {
    if (!path) continue;
    const name = path.split("node_modules/").at(-1);
    if (!name || FORBIDDEN_PACKAGE.test(name)) throw new Error("Server dependency in desktop runtime lock: " + path);
  }
}

function assertPublicEntry(path, relativePath, name) {
  const lower = name.toLowerCase();
  if (lower === ".git" || lower === "private" || lower === "sessions" || lower === "provisioning" ||
      /^\.env(?:\.|$)/.test(lower) || /\.dpapi$/.test(lower) ||
      /^(?:preview|production|session|sessions|credentials)\.(?:bin|json)$/.test(lower)) {
    throw new Error("Forbidden file in desktop runtime payload: " + relativePath);
  }
  if (lstatSync(path).isSymbolicLink()) throw new Error("Symlink in desktop runtime payload: " + relativePath);
}

/** Check native/runtime/browser siblings too, not just the JavaScript closure. */
export function verifyNoPrivateFiles(root) {
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const path = resolve(directory, entry.name);
      assertPublicEntry(path, rel, entry.name);
      if (entry.isDirectory()) visit(path, rel);
    }
  }
  visit(root);
}

/** Enumerate the actual export, including hidden/stale files and symlinks. */
export function verifyRuntimePayload(workerRoot, hashes) {
  const expected = new Set(Object.keys(hashes));
  const generated = new Set(["package.json", "package-lock.json", "tsconfig.json"]);
  const seen = new Set();
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const rel = prefix ? prefix + "/" + entry.name : entry.name;
      const path = resolve(directory, entry.name);
      assertPublicEntry(path, rel, entry.name);
      if (entry.isDirectory()) visit(path, rel);
      else if (!rel.startsWith("node_modules/")) {
        if (!expected.has(rel) && !generated.has(rel)) throw new Error("Untraced file in desktop runtime payload: " + rel);
        if (expected.has(rel)) {
          const bytes = readFileSync(path);
          assertRuntimeSource(rel, bytes.toString("utf8"));
          if (createHash("sha256").update(bytes).digest("hex") !== hashes[rel]) throw new Error("Desktop source hash mismatch: " + rel);
          seen.add(rel);
        }
      }
    }
  }
  visit(workerRoot);
  if (seen.size !== expected.size) throw new Error("Traced desktop source is missing from the payload.");
  assertRuntimeLock(JSON.parse(readFileSync(resolve(workerRoot, "package-lock.json"), "utf8")));
}
