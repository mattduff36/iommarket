import { findBackupDir, readManifest } from "./backup-fs";
import { createReadPool, createWritePool, snapshotWaitlist } from "./db";
import { loadMirrorEnvs, previewCandidates, productionCandidates } from "./cli-env";
import { assertBackupMatchesConfirmation } from "./manifest";
import { assertMirrorSafety } from "./safety";
import {
  chooseDirectConnectionString,
  chooseWaitlistWriteConnectionString,
  redactedConfirmDb,
} from "./target";
import {
  assertProductionWaitlistCopied,
  mergeWaitlistRows,
  type WaitlistSnapshotRow,
} from "./waitlist";

function asDate(value: string | null) {
  return value ? new Date(value) : null;
}

async function applyWaitlistMerge(
  pool: ReturnType<typeof createWritePool>,
  inserts: WaitlistSnapshotRow[],
  updates: Array<{ previewId: string; row: WaitlistSnapshotRow }>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of inserts) {
      await client.query(
        `INSERT INTO "WaitlistUser" (
           id, email, interests, source, "deletedAt", "deletedByAdminId", "deletionReason",
           "marketingConsentAt", "marketingPolicyVersion", "marketingWithdrawnAt",
           "createdAt", "updatedAt"
         ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id,
          row.email,
          JSON.stringify(row.interests),
          row.source,
          asDate(row.deletedAt),
          row.deletedByAdminId,
          row.deletionReason,
          asDate(row.marketingConsentAt),
          row.marketingPolicyVersion,
          asDate(row.marketingWithdrawnAt),
          asDate(row.createdAt),
          asDate(row.updatedAt),
        ],
      );
    }
    for (const update of updates) {
      const row = update.row;
      await client.query(
        `UPDATE "WaitlistUser" SET
           email=$2, interests=$3::jsonb, source=$4, "deletedAt"=$5, "deletedByAdminId"=$6,
           "deletionReason"=$7, "marketingConsentAt"=$8, "marketingPolicyVersion"=$9,
           "marketingWithdrawnAt"=$10, "createdAt"=$11, "updatedAt"=$12
         WHERE id=$1`,
        [
          update.previewId,
          row.email,
          JSON.stringify(row.interests),
          row.source,
          asDate(row.deletedAt),
          row.deletedByAdminId,
          row.deletionReason,
          asDate(row.marketingConsentAt),
          row.marketingPolicyVersion,
          asDate(row.marketingWithdrawnAt),
          asDate(row.createdAt),
          asDate(row.updatedAt),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runCopyWaitlist(argv: string[], cwd = process.cwd()) {
  const envs = loadMirrorEnvs(argv, cwd);
  const previewUrl = chooseWaitlistWriteConnectionString(previewCandidates(envs.preview));
  const productionUrl = chooseDirectConnectionString(
    productionCandidates(envs.production),
    "production",
  );
  const confirmDb = redactedConfirmDb(previewUrl);
  const backupId = argv.find((arg) => arg.startsWith("--backup-id="))?.slice("--backup-id=".length);
  if (!backupId) {
    throw new Error("Refusing waitlist copy: --backup-id is required.");
  }
  const manifest = readManifest(findBackupDir(backupId, cwd));
  assertBackupMatchesConfirmation(manifest, backupId, confirmDb);
  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId: manifest.id,
    backupConfirmDb: manifest.confirmDb,
  });

  const previewPool = createWritePool(previewUrl);
  const productionPool = createReadPool(productionUrl);
  try {
    const [preview, production] = await Promise.all([
      snapshotWaitlist(previewPool),
      snapshotWaitlist(productionPool),
    ]);
    const merged = mergeWaitlistRows(preview, production);
    await applyWaitlistMerge(previewPool, merged.inserts, merged.updates);
    const after = await snapshotWaitlist(previewPool);
    assertProductionWaitlistCopied(production, after);
    process.stdout.write(
      [
        "Waitlist copy complete.",
        `production=${production.length}`,
        `inserted=${merged.inserts.length}`,
        `updated=${merged.updates.length}`,
        `preview_after=${after.length}`,
        "",
      ].join("\n"),
    );
    return { inserted: merged.inserts.length, updated: merged.updates.length, after: after.length };
  } finally {
    await previewPool.end();
    await productionPool.end();
  }
}
