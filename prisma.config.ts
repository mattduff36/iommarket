import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { defineConfig } from "prisma/config";

// Load .env.local (Next.js convention) so CLI commands pick up dev credentials.
// dotenv/config above loads .env first; we now overwrite with .env.local values
// so that .env.local takes precedence, matching Next.js behaviour.
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const lines = fs.readFileSync(envLocalPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (key) process.env[key] = val;
  }
}

// Use the non-pooling direct URL for migrations (bypasses pgbouncer).
const migrationUrl =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
