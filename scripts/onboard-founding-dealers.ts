import { existsSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  chooseWipeConnectionString as choosePreviewConnectionString,
} from "./wipe-preview-marketplace/target";
import { applyMikeMotorsPreviewRename, assertPreviewRenameSafety, PREVIEW_CONFIRM_DB } from "./onboard-founding-dealers/preview-rename";
import { assertNoAmbientPreviewOverride, chooseFoundingConnectionString, loadFoundingProductionEnv } from "./onboard-founding-dealers/env";
import { runFoundingOnboard } from "./onboard-founding-dealers/run";
import { PRODUCTION_ENV_FILE } from "./onboard-founding-dealers/safety";
import { createClient } from "@supabase/supabase-js";

function cleanUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    return parsed.toString();
  } catch {
    return raw.trim();
  }
}

function parseEnvFile(filePath: string) {
  const values: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    values[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function createPrisma(connectionString: string) {
  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  return {
    prisma: new PrismaClient({ adapter: new PrismaPg(pool) }),
    pool,
  };
}

function redactResult(result: unknown) {
  return JSON.parse(
    JSON.stringify(result, (key, value) => (key === "password" || key === "credentials" ? "[redacted]" : value)),
  );
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--preview-rename")) {
    const args = assertPreviewRenameSafety(argv, PREVIEW_CONFIRM_DB);
    if (!args.apply) {
      process.stdout.write(`${JSON.stringify({ dryRun: true, plan: "Mike's Motors" }, null, 2)}\n`);
      return;
    }
    if (!existsSync(".env.local")) {
      throw new Error("Refusing preview rename: .env.local is required.");
    }
    const parsed = parseEnvFile(".env.local");
    const connectionString = choosePreviewConnectionString({
      databaseUrl: parsed.DATABASE_URL,
      postgresUrlNonPooling: parsed.POSTGRES_URL_NON_POOLING,
      supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL ?? parsed.SUPABASE_URL,
    });
    const { prisma, pool } = createPrisma(connectionString);
    try {
      const result = await applyMikeMotorsPreviewRename(prisma);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
    return;
  }

  assertNoAmbientPreviewOverride(process.env);
  const env = loadFoundingProductionEnv(PRODUCTION_ENV_FILE);
  const { prisma, pool } = createPrisma(chooseFoundingConnectionString(env));
  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const result = await runFoundingOnboard({ argv, env, prisma, admin });
    process.stdout.write(`${JSON.stringify(redactResult(result), null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Founding onboard failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
