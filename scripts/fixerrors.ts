/**
 * Fixerrors - export OPEN monitoring issues, cluster them, and optionally
 * resolve snapshot-bound unchanged issues after evidenced code fixes.
 *
 * Usage:
 *   npm run fixerrors
 *   npm run fixerrors -- --resolve --issue-ids=... --snapshot-id=... --apply --evidence=...
 *   npm run fixerrors -- --reopen --run-id=... --apply
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { clusterErrorPatterns, generateAnalysisReport, groupOpenIssues, summarizeClusterLanes } from "./fixerrors/analysis";
import { asPgClient, createFixerrorsClient } from "./fixerrors/db";
import { createDatabaseTargetFingerprint, loadFixerrorsEnv, requireNonPoolingConnectionString } from "./fixerrors/env";
import {
  reopenResolvedByRun,
  resolveActorAdminId,
  resolveSnapshotIssues,
} from "./fixerrors/resolve";
import {
  ERROR_ANALYSIS_PATH,
  ERROR_SNAPSHOT_PATH,
  fetchOpenIssueSnapshot,
  markSnapshotAnalysisCompleted,
  readAndVerifySnapshot,
  writeAndVerifySnapshot,
  writeAndVerifyTextArtifactAtomic,
} from "./fixerrors/snapshot";
import { FIXERRORS_SAFETY_CONTRACT, type ResolveConfirmation } from "./fixerrors/types";

function getArgumentValue(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function parseResolveConfirmation(args: string[]): ResolveConfirmation | null {
  if (!args.includes("--resolve")) return null;
  const snapshotId = getArgumentValue(args, "--snapshot-id");
  const checksum = getArgumentValue(args, "--checksum");
  const databaseTargetFingerprint = getArgumentValue(args, "--target");
  const expiresAt = getArgumentValue(args, "--expires-at");
  const safetyContract = getArgumentValue(args, "--safety-contract");
  const manifestChecksum = getArgumentValue(args, "--manifest");
  const issueIds = (getArgumentValue(args, "--issue-ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const evidence = getArgumentValue(args, "--evidence") ?? "";
  if (
    !snapshotId ||
    !checksum ||
    !/^[a-f0-9]{64}$/u.test(checksum) ||
    !databaseTargetFingerprint ||
    !/^[a-f0-9]{64}$/u.test(databaseTargetFingerprint) ||
    !expiresAt ||
    !safetyContract ||
    !manifestChecksum ||
    !/^[a-f0-9]{64}$/u.test(manifestChecksum) ||
    issueIds.length === 0 ||
    !evidence.trim()
  ) {
    throw new Error(
      "Resolve requires --issue-ids, --evidence, and the exact snapshot binding printed by export",
    );
  }
  return {
    snapshotId,
    checksum,
    databaseTargetFingerprint,
    expiresAt,
    safetyContract,
    manifestChecksum,
    issueIds,
    evidence,
    apply: args.includes("--apply"),
  };
}

export function getResolvableSnapshotIssueIds(
  snapshot: Pick<ReturnType<typeof readAndVerifySnapshot>, "issues" | "analysis">,
): string[] {
  const reportOnly = new Set(snapshot.analysis.reportOnlyIssueIds);
  return snapshot.issues
    .map((issue) => issue.id)
    .filter((issueId) => !reportOnly.has(issueId));
}

async function main() {
  loadFixerrorsEnv();
  const args = process.argv.slice(2);
  const connectionString = requireNonPoolingConnectionString();
  const databaseTargetFingerprint = createDatabaseTargetFingerprint(connectionString);
  const client = createFixerrorsClient();
  await client.connect();
  const databaseClient = asPgClient(client);

  try {
    if (args.includes("--reopen")) {
      const runId = getArgumentValue(args, "--run-id");
      if (!runId) throw new Error("--reopen requires --run-id");
      const actorAdminId = await resolveActorAdminId(databaseClient);
      const result = await reopenResolvedByRun({
        client: databaseClient,
        runId,
        apply: args.includes("--apply"),
        actorAdminId,
      });
      console.log(JSON.stringify({ mode: "reopen", ...result }, null, 2));
      return;
    }

    const resolveConfirmation = parseResolveConfirmation(args);
    if (resolveConfirmation) {
      const snapshot = readAndVerifySnapshot();
      if (
        snapshot.snapshotId !== resolveConfirmation.snapshotId ||
        snapshot.checksum !== resolveConfirmation.checksum ||
        snapshot.manifestChecksum !== resolveConfirmation.manifestChecksum ||
        snapshot.expiresAt !== resolveConfirmation.expiresAt ||
        snapshot.safetyContract !== resolveConfirmation.safetyContract ||
        snapshot.databaseTargetFingerprint !== resolveConfirmation.databaseTargetFingerprint
      ) {
        throw new Error("Resolve confirmation does not match the verified snapshot artifact");
      }
      const actorAdminId = await resolveActorAdminId(databaseClient);
      const result = await resolveSnapshotIssues({
        client: databaseClient,
        snapshot,
        issueIds: resolveConfirmation.issueIds,
        evidence: resolveConfirmation.evidence,
        apply: resolveConfirmation.apply,
        databaseTargetFingerprint,
        actorAdminId,
      });
      console.log(JSON.stringify({ mode: "resolve", dryRun: !resolveConfirmation.apply, ...result }, null, 2));
      return;
    }

    console.log("FIXERRORS - OPEN monitoring export");
    let snapshot = await fetchOpenIssueSnapshot(databaseClient, databaseTargetFingerprint);
    const patterns = groupOpenIssues(snapshot.issues);
    const clusters = clusterErrorPatterns(patterns);
    const report = generateAnalysisReport(snapshot.issues, patterns, clusters);
    writeAndVerifyTextArtifactAtomic(ERROR_ANALYSIS_PATH, report);
    snapshot = markSnapshotAnalysisCompleted(
      snapshot,
      report,
      summarizeClusterLanes(clusters),
      clusters.length,
      clusters
        .filter((cluster) => cluster.action === "report-only")
        .flatMap((cluster) => cluster.issueIds),
    );
    snapshot = writeAndVerifySnapshot(snapshot, ERROR_SNAPSHOT_PATH);
    writeAndVerifySnapshot(snapshot, resolve(process.cwd(), "private", "fixerrors", "snapshots", `${snapshot.snapshotId}.json`));

    console.log(`  OPEN issues: ${snapshot.issues.length}`);
    console.log(`  Patterns: ${patterns.length}`);
    console.log(`  Clusters: ${clusters.length}`);
    console.log(`  Report: private/fixerrors/error-analysis.md`);
    console.log(`  Snapshot: private/fixerrors/error-snapshot.json`);
    console.log(`  Report checksum: ${createHash("sha256").update(report).digest("hex")}`);
    if (snapshot.issues.length === 0) {
      console.log("  No OPEN issues; resolution is not required.");
      return;
    }
    console.log("  Resolution is dry-run unless --apply is provided.");
    console.log("  After evidenced fixes, first run this dry-run command:");
    const resolvableIssueIds = getResolvableSnapshotIssueIds(snapshot);
    if (resolvableIssueIds.length === 0) {
      console.log("  All OPEN issues are report-only; no resolution command was generated.");
      return;
    }
    console.log(
      `npm run fixerrors -- --resolve --issue-ids=${resolvableIssueIds.join(",")} --snapshot-id=${snapshot.snapshotId} --checksum=${snapshot.checksum} --target=${snapshot.databaseTargetFingerprint} --expires-at=${snapshot.expiresAt} --safety-contract=${FIXERRORS_SAFETY_CONTRACT} --manifest=${snapshot.manifestChecksum} --evidence=checks-passed`,
    );
    console.log("  Add --apply only after the dry-run output looks correct.");
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
