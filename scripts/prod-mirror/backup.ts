import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  WORKSTREAM_ID,
} from "./constants";
import { createBackupDir, createBackupManifestForDir, writeBackupFile } from "./backup-fs";
import {
  createReadPool,
  publicTableNames,
  readAuthInstanceId,
  snapshotWaitlist,
  tableCounts,
} from "./db";
import { pgDumpDataArgs, resolvePgBin, truncatePublicAndAuthSql, withRequiredSsl } from "./dump";
import { parseArgValue, assertMirrorSafety } from "./safety";
import {
  chooseDirectConnectionString,
  chooseRestoreConnectionString,
  redactedConfirmDb,
} from "./target";
import { loadMirrorEnvs, productionCandidates, previewCandidates } from "./cli-env";

export async function runBackup(argv: string[], cwd = process.cwd()) {
  const target = parseArgValue(argv, "target");
  if (target !== "preview" && target !== "production") {
    throw new Error("Refusing backup: --target=preview|production is required.");
  }

  const envs = loadMirrorEnvs(argv, cwd);
  const urls =
    target === "preview" ? previewCandidates(envs.preview) : productionCandidates(envs.production);
  const connectionString =
    target === "production"
      ? chooseRestoreConnectionString(urls)
      : chooseDirectConnectionString(urls, "preview");
  const confirmDb = redactedConfirmDb(connectionString);
  const backupId = `pmr-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;

  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId,
    backupConfirmDb: confirmDb,
  });

  const dir = createBackupDir(backupId, cwd);
  const pool = createReadPool(connectionString);
  try {
    const waitlist = await snapshotWaitlist(pool);
    const tables = await publicTableNames(pool);
    const counts = await tableCounts(pool, tables);
    const instanceId = await readAuthInstanceId(pool);
    const waitlistFile = writeBackupFile(dir, "waitlist.json", `${JSON.stringify(waitlist, null, 2)}\n`);
    const countsFile = writeBackupFile(dir, "counts.json", `${JSON.stringify(counts, null, 2)}\n`);
    const instanceFile = writeBackupFile(
      dir,
      "auth-instance.json",
      `${JSON.stringify({ instanceId, target, confirmDb }, null, 2)}\n`,
    );
    const truncateFile = writeBackupFile(
      dir,
      "truncate.sql",
      `${truncatePublicAndAuthSql(tables)}\n`,
    );

    const dumpPath = `${dir}/public-auth.data.sql`;
    const dump = spawnSync(resolvePgBin("pg_dump"), pgDumpDataArgs(withRequiredSsl(connectionString), dumpPath), {
      encoding: "utf8",
    });
    if (dump.status !== 0) {
      throw new Error(`pg_dump failed: ${dump.stderr || dump.stdout || "unknown error"}`);
    }
    const { readFileSync } = await import("node:fs");
    const dumpRecord = writeBackupFile(dir, "public-auth.data.sql", readFileSync(dumpPath));

    const manifest = createBackupManifestForDir({
      id: backupId,
      targetRef: target === "preview" ? PREVIEW_PROJECT_REF : PRODUCTION_PROJECT_REF,
      confirmDb,
      dir,
      files: [waitlistFile, countsFile, instanceFile, truncateFile, dumpRecord],
    });

    process.stdout.write(
      [
        `${WORKSTREAM_ID} backup complete.`,
        `target=${target}`,
        `backup_id=${manifest.id}`,
        `confirm_db=${confirmDb}`,
        `waitlist=${waitlist.length}`,
        `tables=${tables.length}`,
        `dump=${dumpPath}`,
        "",
      ].join("\n"),
    );
    return manifest;
  } finally {
    await pool.end();
  }
}
