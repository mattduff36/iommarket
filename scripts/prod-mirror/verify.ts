import { KEEP_ACCOUNT_EMAILS, PREVIEW_PROJECT_REF, PRODUCTION_PROJECT_REF } from "./constants";
import { loadMirrorEnvs, previewCandidates, productionCandidates } from "./cli-env";
import { createReadPool, listAuthEmails, snapshotWaitlist, tableCounts, publicTableNames } from "./db";
import { assertMirrorSafety } from "./safety";
import {
  chooseDirectConnectionString,
  chooseRestoreConnectionString,
  redactedConfirmDb,
} from "./target";
import { rewritePreviewUserAvatarsUrl } from "./urls";
import { assertProductionWaitlistCopied, waitlistEmailSet } from "./waitlist";

export async function runVerify(argv: string[], cwd = process.cwd()) {
  const envs = loadMirrorEnvs(argv, cwd);
  const previewUrl = chooseDirectConnectionString(previewCandidates(envs.preview), "preview");
  const productionUrl = chooseRestoreConnectionString(productionCandidates(envs.production));
  const confirmDb = redactedConfirmDb(productionUrl);
  assertMirrorSafety({
    argv,
    writeConfirmDb: confirmDb,
    backupId: "verify",
    backupConfirmDb: confirmDb,
  });

  const previewPool = createReadPool(previewUrl);
  const productionPool = createReadPool(productionUrl);
  try {
    const [previewWaitlist, productionWaitlist, previewAuth, productionAuth, previewTables, productionTables] =
      await Promise.all([
        snapshotWaitlist(previewPool),
        snapshotWaitlist(productionPool),
        listAuthEmails(previewPool),
        listAuthEmails(productionPool),
        publicTableNames(previewPool).then((tables) => tableCounts(previewPool, tables)),
        publicTableNames(productionPool).then((tables) => tableCounts(productionPool, tables)),
      ]);

    assertProductionWaitlistCopied(previewWaitlist, productionWaitlist);
    const previewEmails = [...waitlistEmailSet(previewWaitlist)].sort();
    const productionEmails = [...waitlistEmailSet(productionWaitlist)].sort();
    if (previewEmails.join("\n") !== productionEmails.join("\n")) {
      throw new Error("Verify failed: waitlist email sets differ.");
    }

    const missingKept = KEEP_ACCOUNT_EMAILS.filter((email) => !productionAuth.includes(email));
    if (missingKept.length > 0) {
      throw new Error(`Verify failed: production Auth missing ${missingKept.join(", ")}`);
    }
    if (previewAuth.slice().sort().join("\n") !== productionAuth.slice().sort().join("\n")) {
      throw new Error("Verify failed: Auth email sets differ.");
    }

    const previewCountKey = Object.keys(previewTables).sort().join(",");
    const productionCountKey = Object.keys(productionTables).sort().join(",");
    if (previewCountKey !== productionCountKey) {
      throw new Error("Verify failed: public table lists differ.");
    }
    for (const table of Object.keys(previewTables)) {
      if (previewTables[table] !== productionTables[table]) {
        throw new Error(
          `Verify failed: ${table} count ${previewTables[table]} != ${productionTables[table]}`,
        );
      }
    }

    const logos = await productionPool.query(
      `SELECT "logoUrl" FROM "DealerProfile" WHERE "logoUrl" IS NOT NULL`,
    );
    const leaked = logos.rows.filter((row) => {
      const rewritten = rewritePreviewUserAvatarsUrl(row.logoUrl);
      return rewritten !== row.logoUrl;
    });
    if (leaked.length > 0) {
      throw new Error(`Verify failed: ${leaked.length} logo URLs still point at preview.`);
    }

    process.stdout.write(
      [
        "Mirror verify passed.",
        `source=${PREVIEW_PROJECT_REF}`,
        `dest=${PRODUCTION_PROJECT_REF}`,
        `waitlist=${productionWaitlist.length}`,
        `auth_users=${productionAuth.length}`,
        "",
      ].join("\n"),
    );
  } finally {
    await previewPool.end();
    await productionPool.end();
  }
}

