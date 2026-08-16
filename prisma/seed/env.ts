import * as fs from "fs";
import * as path from "path";

const DB_KEYS = new Set([
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_HOST",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
  "POSTGRES_DATABASE",
]);

function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return {} as Record<string, string>;
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key) values[key] = val;
  }
  return values;
}

function applyEnv(values: Record<string, string>, keys?: Set<string>) {
  for (const [key, value] of Object.entries(values)) {
    if (keys && !keys.has(key)) continue;
    process.env[key] = value;
  }
}

export function loadSeedEnv(cwd = process.cwd()) {
  // Destructive confirmations must be supplied explicitly per invocation.
  // Environment files may provide connection details only.
  applyEnv(parseEnvFile(path.resolve(cwd, ".env")), DB_KEYS);
  applyEnv(parseEnvFile(path.resolve(cwd, ".env.local")), DB_KEYS);
  const seedEnvFile = process.env.SEED_ENV_FILE;
  if (seedEnvFile) {
    const resolved = path.isAbsolute(seedEnvFile)
      ? seedEnvFile
      : path.resolve(cwd, seedEnvFile);
    applyEnv(parseEnvFile(resolved), DB_KEYS);
  }
}

export function getSeedConnectionString() {
  return (
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ""
  );
}
