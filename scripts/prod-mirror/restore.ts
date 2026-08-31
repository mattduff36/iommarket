import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTH_INSTANCE_REWRITE_SQL, resolveAuthInstanceIdPlan } from "./auth-instance";
import { findBackupDir, readManifest } from "./backup-fs";
import { loadMirrorEnvs, productionCandidates } from "./cli-env";
import {
  appliedPrismaMigrationNames,
  createWritePool,
  publicTableNames,
  readAuthInstanceId,
} from "./db";
import {
  restoreSessionEndSql,
  restoreSessionSql,
  resolvePgBin,
  truncatePublicAndAuthSql,
  withRequiredSsl,
} from "./dump";
import { assertBackupMatchesConfirmation } from "./manifest";
import { listPrismaMigrations, pendingPrismaMigrations } from "./migrations";
import { parseArgValue, assertMirrorSafety } from "./safety";
import { assertRestoreNotPooler, chooseRestoreConnectionString, redactedConfirmDb } from "./target";

function runPsql(psql: string, url: string, extra: string[]) {
  const result = spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", ...extra], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result;
}

export async function runRestore(argv: string[], cwd = process.cwd()) {
  const envs = loadMirrorEnvs(argv, cwd);
  const destUrl = chooseRestoreConnectionString(productionCandidates(envs.production));
  assertRestoreNotPooler(destUrl);
  const confirmDb = redactedConfirmDb(destUrl);
  const backupId = parseArgValue(argv, "backup-id");
  const sourceBackupId = parseArgValue(argv, "source-backup-id");
  if (!backupId) throw new Error("Refusing restore: --backup-id is required.");
  if (!sourceBackupId) throw new Error("Refusing restore: --source-backup-id is required.");

  const productionBackup = readManifest(findBackupDir(backupId, cwd));
  assertBackupMatchesConfirmation(productionBackup, backupId, confirmDb);
  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId: productionBackup.id,
    backupConfirmDb: productionBackup.confirmDb,
  });

  const sourceDir = findBackupDir(sourceBackupId, cwd);
  const sourceManifest = readManifest(sourceDir);
  const dumpPath = join(sourceDir, "public-auth.data.sql");
  const sourceInstance = JSON.parse(
    readFileSync(join(sourceDir, "auth-instance.json"), "utf8"),
  ) as { instanceId: string | null };

  const pool = createWritePool(destUrl);
  const psqlUrl = withRequiredSsl(destUrl);
  const psql = resolvePgBin("psql");
  try {
    const destInstanceId = await readAuthInstanceId(pool);
    const plan = resolveAuthInstanceIdPlan(sourceInstance.instanceId, destInstanceId);
    if (plan.action === "fail") {
      throw new Error(`Refusing restore: ${plan.reason}`);
    }

    const available = listPrismaMigrations(join(cwd, "prisma/migrations"));
    const applied = await appliedPrismaMigrationNames(pool);
    const pending = pendingPrismaMigrations(available, applied);
    for (const migration of pending) {
      const sqlPath = join(cwd, "prisma/migrations", migration.name, "migration.sql");
      runPsql(psql, psqlUrl, ["-f", sqlPath]);
      await pool.query(
        `INSERT INTO _prisma_migrations (
           id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
         ) VALUES (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)`,
        [migration.checksum, migration.name],
      );
      process.stdout.write(`Applied destination migration ${migration.name}\n`);
    }

    const tables = await publicTableNames(pool);
    runPsql(psql, psqlUrl, [
      "-c",
      "BEGIN;",
      "-c",
      restoreSessionSql(),
      "-c",
      truncatePublicAndAuthSql(tables),
      "-f",
      dumpPath,
      "-c",
      "COMMIT;",
      "-c",
      restoreSessionEndSql(),
    ]);

    if (plan.action === "rewrite") {
      const rewrite = await pool.query(AUTH_INSTANCE_REWRITE_SQL, [plan.to]);
      process.stdout.write(`auth.users instance_id rewritten rows=${rewrite.rowCount ?? 0}\n`);
    } else {
      process.stdout.write("auth.users instance_id preserved (source matches destination).\n");
    }

    runPsql(psql, psqlUrl, ["-c", restoreSessionEndSql()]);

    process.stdout.write(
      [
        "Production restore complete.",
        `rollback_backup=${productionBackup.id}`,
        `source_backup=${sourceManifest.id}`,
        `pending_migrations=${pending.length}`,
        `dump=${dumpPath}`,
        "",
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}
