/**
 * Fixerrors - export OPEN monitoring issues, repair them on staging, and
 * resolve them only after that commit is deployed to production.
 *
 * Usage:
 *   npm run fixerrors
 *   npm run fixerrors -- --database=preview
 *   npm run fixerrors -- --acknowledge --snapshot-id=... --apply
 *   npm run fixerrors -- --prepare-repair --paths=<files>
 *   npm run fixerrors -- --commit-cluster --cluster-id=... --lane=... --issue-ids=... --paths=... --review=...
 *   npm run fixerrors -- --close --close-manifest=private/fixerrors/close.json --snapshot-id=... --apply
 *   npm run fixerrors -- --verify-release --cluster-id=... --apply
 *   npm run fixerrors -- --reopen --run-id=... --apply
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acknowledgeSnapshotIssues } from "./fixerrors/acknowledge";
import {
  appendAlertLog,
  applyAlertHistory,
  loadAlertHistory,
  newSeenEvents,
  recallOpenIssues,
  renderAlertHistory,
} from "./fixerrors/alert-log";
import { clusterErrorPatterns, generateAnalysisReport, groupOpenIssues, summarizeClusterLanes } from "./fixerrors/analysis";
import { assertBindingMatches, formatSnapshotBinding, getArgumentValue, readSnapshotBinding } from "./fixerrors/binding";
import { closeSnapshotIssues, readCloseManifest } from "./fixerrors/close-out";
import { commitVerifiedCluster, readClusterReview } from "./fixerrors/commit-cluster";
import { assertAutoRepairDecision, buildFixerrorsDecisions, writeFixerrorsDecisions, type FixerrorsDecision } from "./fixerrors/decision";
import { asPgClient, createFixerrorsClient } from "./fixerrors/db";
import { createDatabaseTargetFingerprint, loadFixerrorsDatabase, parseFixerrorsDatabaseTarget } from "./fixerrors/env";
import { assessExplicitRepairPaths, assessRepairWorkspace, compareRepairPaths, fetchReleaseRefs, readRepairWorkspace } from "./fixerrors/git-policy";
import { clusterFingerprint, readReleaseManifest, verifyProductionRelease } from "./fixerrors/release";
import { reopenResolvedByRun, resolveActorAdminId } from "./fixerrors/resolve";
import { reopenMutedByRun } from "./fixerrors/unmute";
import {
  ERROR_ANALYSIS_PATH,
  ERROR_SNAPSHOT_PATH,
  fetchOpenIssueSnapshot,
  markSnapshotAnalysisCompleted,
  readAndVerifySnapshot,
  writeAndVerifySnapshot,
  writeAndVerifyTextArtifactAtomic,
} from "./fixerrors/snapshot";
import { type CodeBaseline, type OpenIssueSnapshot, type PgClientLike } from "./fixerrors/types";

const MODES = ["--commit-cluster", "--prepare-repair", "--reopen", "--reopen-muted", "--acknowledge", "--close", "--verify-release"] as const;
const CLUSTER_ID = /^cluster-[0-9]+$/u;

export function getSnapshotIssueIds(snapshot: Pick<OpenIssueSnapshot, "issues">): string[] {
  return snapshot.issues.map((issue) => issue.id);
}

export function parseFixerrorsInvocation(args: string[]) {
  const selected = MODES.filter((flag) => args.includes(flag));
  if (selected.length > 1) throw new Error("Choose one fixerrors mode");
  if (args.includes("--resolve")) {
    throw new Error("fixerrors cannot resolve an issue before production deployment. Use pending-release, then --verify-release.");
  }
  return {
    database: parseFixerrorsDatabaseTarget(getArgumentValue(args, "--database")),
    binding: readSnapshotBinding(args),
    mode: selected[0] ?? "export",
  };
}

function commitFromArguments(args: string[]) {
  const reviewPath = getArgumentValue(args, "--review");
  const lane = getArgumentValue(args, "--lane") ?? "";
  const clusterId = getArgumentValue(args, "--cluster-id") ?? "";
  const issueIds = splitList(getArgumentValue(args, "--issue-ids"));
  const paths = splitList(getArgumentValue(args, "--paths"));
  if (!reviewPath || !CLUSTER_ID.test(clusterId)) {
    throw new Error("Commit requires --review and --cluster-id");
  }
  const snapshot = readAndVerifySnapshot();
  const decisionFile = JSON.parse(readFileSync(resolve(process.cwd(), "private", "fixerrors", "decision.json"), "utf8")) as {
    version: number;
    codeBaseline: CodeBaseline | null;
    decisions: FixerrorsDecision[];
  };
  if (decisionFile.version !== 2) throw new Error("Decision manifest version mismatch");
  assertAutoRepairDecision(decisionFile.decisions, clusterId, issueIds);
  const selectedDecision = decisionFile.decisions.find((decision) => decision.clusterId === clusterId);
  if (!issueIds.length || new Set(issueIds).size !== issueIds.length
    || issueIds.some((id) => !selectedDecision?.issueIds.includes(id) || !getSnapshotIssueIds(snapshot).includes(id))) {
    throw new Error("Repair issue IDs must be a unique non-empty subset of the signed cluster");
  }
  const baseline = snapshot.analysis.codeBaseline;
  if (
    !baseline
    || decisionFile.codeBaseline?.productionSha !== baseline.productionSha
    || decisionFile.codeBaseline?.stagingSha !== baseline.stagingSha
  ) {
    throw new Error("Decision manifest does not match the signed snapshot code baseline");
  }
  const pathAssessment = assessExplicitRepairPaths({
    paths, newPaths: splitList(getArgumentValue(args, "--new-paths")), baseline, cwd: process.cwd(),
  });
  if (!pathAssessment.ok) throw new Error(pathAssessment.reason);
  const issueFingerprints = issueIds.map((issueId) => {
    const issue = snapshot.issues.find((entry) => entry.id === issueId);
    if (!issue) throw new Error("Cluster issue is not in the signed snapshot");
    return issue.fingerprint;
  });
  const derived = clusterFingerprint(issueFingerprints);
  const requested = getArgumentValue(args, "--fingerprint");
  if (requested && requested !== derived) {
    throw new Error("Cluster fingerprint does not match the signed issue fingerprints");
  }
  return commitVerifiedCluster({
    lane,
    clusterId,
    fingerprint: derived,
    review: readClusterReview(reviewPath),
    clusterIssueIds: issueIds,
    snapshotIssueIds: getSnapshotIssueIds(snapshot),
    paths: pathAssessment.paths,
    workspace: readRepairWorkspace(process.cwd()),
    issueFingerprints,
    release: {
      safetyContract: snapshot.safetyContract,
      snapshotId: snapshot.snapshotId,
      snapshotChecksum: snapshot.checksum,
      productionSha: baseline.productionSha,
      stagingSha: baseline.stagingSha,
    },
    apply: args.includes("--apply"),
    pushRequested: args.includes("--push"),
  });
}

function prepareFromArguments(args: string[]) {
  const paths = splitList(getArgumentValue(args, "--paths"));
  if (paths.length === 0) throw new Error("--prepare-repair requires --paths");
  const snapshot = readAndVerifySnapshot();
  const baseline = snapshot.analysis.codeBaseline;
  if (!baseline) throw new Error("Snapshot has no production and staging code baseline");
  const pathAssessment = assessExplicitRepairPaths({
    paths, newPaths: splitList(getArgumentValue(args, "--new-paths")), baseline, cwd: process.cwd(),
  });
  if (!pathAssessment.ok) return pathAssessment;
  return assessRepairWorkspace(readRepairWorkspace(process.cwd()), pathAssessment.paths);
}

function requireBinding(args: string[], message: string) {
  const binding = readSnapshotBinding(args);
  if (!binding) throw new Error(message);
  const snapshot = readAndVerifySnapshot();
  assertBindingMatches(snapshot, binding);
  return snapshot;
}

async function acknowledgeFromArguments(args: string[], client: PgClientLike, databaseTargetFingerprint: string) {
  const snapshot = requireBinding(args, "Acknowledge requires the exact snapshot binding printed by export");
  const actorAdminId = await resolveActorAdminId(client);
  const result = await acknowledgeSnapshotIssues({
    client,
    snapshot,
    apply: args.includes("--apply"),
    databaseTargetFingerprint,
    actorAdminId,
  });
  console.log(JSON.stringify({ mode: "acknowledge", dryRun: !args.includes("--apply"), ...result }, null, 2));
}

async function closeFromArguments(args: string[], client: PgClientLike, databaseTargetFingerprint: string) {
  const manifestPath = getArgumentValue(args, "--close-manifest");
  if (!manifestPath) {
    throw new Error("Close requires --close-manifest and the exact snapshot binding printed by export");
  }
  const snapshot = requireBinding(args, "Close requires --close-manifest and the exact snapshot binding printed by export");
  const actorAdminId = await resolveActorAdminId(client);
  const result = await closeSnapshotIssues({
    client,
    snapshot,
    entries: readCloseManifest(manifestPath, getSnapshotIssueIds(snapshot)),
    apply: args.includes("--apply"),
    databaseTargetFingerprint,
    actorAdminId,
  });
  console.log(JSON.stringify({ mode: "close", dryRun: !args.includes("--apply"), ...result }, null, 2));
}

async function verifyFromArguments(args: string[], client: PgClientLike, databaseTargetFingerprint: string) {
  const clusterId = getArgumentValue(args, "--cluster-id") ?? "";
  if (!CLUSTER_ID.test(clusterId)) throw new Error("--verify-release requires --cluster-id");
  const snapshot = readAndVerifySnapshot();
  const manifest = readReleaseManifest(resolve(process.cwd(), "private", "fixerrors", "runs", clusterId, "release.json"));
  const actorAdminId = await resolveActorAdminId(client);
  const result = await verifyProductionRelease({
    client,
    snapshot,
    manifest,
    databaseTargetFingerprint,
    apply: args.includes("--apply"),
    actorAdminId,
  });
  if (args.includes("--apply") && result.applied && result.recurred.length > 0) {
    const recordedAt = new Date().toISOString();
    appendAlertLog(result.recurred.flatMap((issueId) => {
      const issue = snapshot.issues.find((entry) => entry.id === issueId);
      if (!issue) return [];
      return [{
        at: recordedAt,
        fingerprint: issue.fingerprint,
        normalizedMessage: "",
        source: issue.source,
        route: issue.sampleRoute,
        action: issue.sampleAction,
        severity: issue.severity,
        occurrences: issue.occurrences,
        lastSeenAt: issue.lastSeenAt,
        outcome: "recurred" as const,
        summary: "The error came back after the fix was deployed.",
      }];
    }));
  }
  console.log(JSON.stringify({ mode: "verify-release", dryRun: !args.includes("--apply"), ...result }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

function printExportFollowUp(snapshot: OpenIssueSnapshot) {
  const binding = formatSnapshotBinding(snapshot);
  console.log("  Acknowledge unchanged OPEN issues before investigation. Dry-run:");
  console.log(`npm run fixerrors -- --acknowledge ${binding}`);
  console.log("  Add --apply only after the dry-run output looks correct.");
  console.log("  Repair on the staging branch. Check the paths before editing:");
  console.log("npm run fixerrors -- --prepare-repair --paths=<files>");
  console.log("  Commit the reviewed repair locally. Push only with /fap or /ffap.");
  console.log("  Close a fixed issue as pending-release. Resolve it with --verify-release after production deployment.");
  console.log(`  Snapshot issue IDs: ${getSnapshotIssueIds(snapshot).join(",")}`);
}

async function exportOpenIssues(client: PgClientLike, databaseTargetFingerprint: string) {
  console.log("FIXERRORS - OPEN monitoring export");
  let snapshot = await fetchOpenIssueSnapshot(client, databaseTargetFingerprint);
  const patterns = groupOpenIssues(snapshot.issues);
  const clusters = clusterErrorPatterns(patterns);
  let baseline: CodeBaseline | null = null;
  if (snapshot.issues.length > 0) {
    const refs = fetchReleaseRefs(process.cwd());
    const files = clusters.flatMap((cluster) => cluster.patterns.flatMap((pattern) => pattern.sourceFiles.map((ref) => ref.file)));
    baseline = compareRepairPaths({
      files,
      productionSha: refs.productionSha,
      stagingSha: refs.stagingSha,
      cwd: process.cwd(),
    });
  }
  const history = loadAlertHistory();
  const recalls = recallOpenIssues(snapshot.issues, history);
  const decisions = applyAlertHistory(buildFixerrorsDecisions(clusters, baseline), recalls);
  writeFixerrorsDecisions(resolve(process.cwd(), "private", "fixerrors", "decision.json"), decisions, baseline);
  const report = generateAnalysisReport(
    snapshot.issues,
    patterns,
    clusters,
    baseline,
    renderAlertHistory(recalls),
  );
  appendAlertLog(newSeenEvents(snapshot.issues, history));
  writeAndVerifyTextArtifactAtomic(ERROR_ANALYSIS_PATH, report);
  snapshot = markSnapshotAnalysisCompleted(
    snapshot,
    report,
    summarizeClusterLanes(clusters),
    clusters.length,
    clusters.filter((cluster) => cluster.action === "report-only").flatMap((cluster) => cluster.issueIds),
    baseline,
  );
  snapshot = writeAndVerifySnapshot(snapshot, ERROR_SNAPSHOT_PATH);
  writeAndVerifySnapshot(snapshot, resolve(process.cwd(), "private", "fixerrors", "snapshots", `${snapshot.snapshotId}.json`));

  console.log(`  OPEN issues: ${snapshot.issues.length}`);
  console.log(`  Patterns: ${patterns.length}`);
  console.log(`  Clusters: ${clusters.length}`);
  if (baseline) {
    console.log(`  origin/main: ${baseline.productionSha}`);
    console.log(`  origin/staging: ${baseline.stagingSha}`);
  }
  console.log("  Report: private/fixerrors/error-analysis.md");
  console.log("  Snapshot: private/fixerrors/error-snapshot.json");
  console.log(`  Report checksum: ${createHash("sha256").update(report).digest("hex")}`);
  if (snapshot.issues.length === 0) {
    console.log("  No OPEN issues; acknowledgement is not required.");
    return;
  }
  printExportFollowUp(snapshot);
}

function splitList(value: string | null): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const invocation = parseFixerrorsInvocation(args);
  if (invocation.mode === "--commit-cluster") {
    const result = commitFromArguments(args);
    console.log(JSON.stringify(result, null, 2));
    if (!("ok" in result) || !result.ok) process.exitCode = 1;
    return;
  }
  if (invocation.mode === "--prepare-repair") {
    const result = prepareFromArguments(args);
    console.log(JSON.stringify({ mode: "prepare-repair", ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const database = loadFixerrorsDatabase(invocation.database);
  console.log(`Database: ${database.target} (${database.host})`);
  const databaseTargetFingerprint = createDatabaseTargetFingerprint(database.connectionString);
  const client = createFixerrorsClient();
  await client.connect();
  const databaseClient = asPgClient(client);

  try {
    if (invocation.mode === "--reopen-muted") {
      const runId = getArgumentValue(args, "--run-id");
      const snapshotFile = getArgumentValue(args, "--snapshot-file");
      const evidence = getArgumentValue(args, "--evidence");
      if (!runId || !snapshotFile || !evidence) {
        throw new Error("--reopen-muted requires --run-id, --snapshot-file, --issue-ids and --evidence");
      }
      const result = await reopenMutedByRun({
        client: databaseClient, snapshot: readAndVerifySnapshot(snapshotFile),
        databaseTargetFingerprint, runId, issueIds: splitList(getArgumentValue(args, "--issue-ids")),
        evidence, actorAdminId: await resolveActorAdminId(databaseClient), apply: args.includes("--apply"),
      });
      console.log(JSON.stringify({ mode: "reopen-muted", ...result }, null, 2));
      return;
    }
    if (invocation.mode === "--reopen") {
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
    if (invocation.mode === "--acknowledge") {
      await acknowledgeFromArguments(args, databaseClient, databaseTargetFingerprint);
      return;
    }
    if (invocation.mode === "--close") {
      await closeFromArguments(args, databaseClient, databaseTargetFingerprint);
      return;
    }
    if (invocation.mode === "--verify-release") {
      await verifyFromArguments(args, databaseClient, databaseTargetFingerprint);
      return;
    }
    await exportOpenIssues(databaseClient, databaseTargetFingerprint);
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
