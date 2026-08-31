import { findBackupDir, readManifest, readStorageCopyProof } from "./backup-fs";
import { loadMirrorEnvs, productionCandidates } from "./cli-env";
import { createWritePool } from "./db";
import { assertBackupMatchesConfirmation } from "./manifest";
import { parseArgValue, assertMirrorSafety } from "./safety";
import { assertStorageProofReady } from "./storage-proof";
import { chooseRestoreConnectionString, redactedConfirmDb } from "./target";
import { rewritePreviewUserAvatarsUrl } from "./urls";

export async function runRewriteMediaUrls(argv: string[], cwd = process.cwd()) {
  const envs = loadMirrorEnvs(argv, cwd);
  const destUrl = chooseRestoreConnectionString(productionCandidates(envs.production));
  const confirmDb = redactedConfirmDb(destUrl);
  const backupId = parseArgValue(argv, "backup-id");
  if (!backupId) throw new Error("Refusing URL rewrite: --backup-id is required.");
  const backupDir = findBackupDir(backupId, cwd);
  const manifest = readManifest(backupDir);
  assertBackupMatchesConfirmation(manifest, backupId, confirmDb);
  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId: manifest.id,
    backupConfirmDb: manifest.confirmDb,
  });
  assertStorageProofReady(readStorageCopyProof(backupDir));

  const pool = createWritePool(destUrl);
  try {
    const avatars = await pool.query(`SELECT id, "avatarUrl" FROM "User" WHERE "avatarUrl" IS NOT NULL`);
    let avatarUpdates = 0;
    for (const row of avatars.rows) {
      const next = rewritePreviewUserAvatarsUrl(row.avatarUrl);
      if (next && next !== row.avatarUrl) {
        await pool.query(`UPDATE "User" SET "avatarUrl"=$2 WHERE id=$1`, [row.id, next]);
        avatarUpdates += 1;
      }
    }
    const logos = await pool.query(
      `SELECT id, "logoUrl" FROM "DealerProfile" WHERE "logoUrl" IS NOT NULL`,
    );
    let logoUpdates = 0;
    for (const row of logos.rows) {
      const next = rewritePreviewUserAvatarsUrl(row.logoUrl);
      if (next && next !== row.logoUrl) {
        await pool.query(`UPDATE "DealerProfile" SET "logoUrl"=$2 WHERE id=$1`, [row.id, next]);
        logoUpdates += 1;
      }
    }
    process.stdout.write(
      `Media URL rewrite complete. avatars=${avatarUpdates} logos=${logoUpdates}\n`,
    );
    return { avatarUpdates, logoUpdates };
  } finally {
    await pool.end();
  }
}
