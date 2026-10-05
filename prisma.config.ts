import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { defineConfig } from "prisma/config";

// Load .env.local by default. Production operations must opt in explicitly to
// the separately maintained main environment rather than swapping files.
const prismaEnvFile =
  process.env.PRISMA_ENV_FILE === ".env.local.main"
    ? ".env.local.main"
    : ".env.local";
const envLocalPath = path.resolve(process.cwd(), prismaEnvFile);
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (!key) continue;
    if (
      process.env.IMAGEKIT_LOCAL_DATABASE === "1" &&
      (key === "DATABASE_URL" || key === "POSTGRES_URL" || key === "POSTGRES_URL_NON_POOLING")
    ) {
      continue;
    }
    process.env[key] = val;
  }
}

// Use the non-pooling direct URL for migrations (bypasses pgbouncer).
const migrationUrl =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;

if (process.env.IMAGEKIT_LOCAL_DATABASE === "1") {
  const localUrl = migrationUrl ?? "";
  let host = "";
  try {
    host = new URL(localUrl).hostname;
  } catch {
    host = "";
  }
  if (
    (host !== "127.0.0.1" && host !== "localhost") ||
    localUrl.includes("syneonzucehwlghqmfbg") ||
    localUrl.includes("snlqivvogfqesxpbjiei")
  ) {
    throw new Error("ImageKit schema changes require the isolated local database.");
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
