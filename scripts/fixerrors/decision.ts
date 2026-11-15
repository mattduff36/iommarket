import { createHash } from "node:crypto";
import { z } from "zod";
import { assertSnapshotUsable, writeAndVerifyTextArtifactAtomic } from "./snapshot";
import { canonicalJson } from "./integrity";
import type { CodeBaseline, ErrorRootCauseCluster, OpenIssueSnapshot } from "./types";

export type FixerrorsDecisionAction = "auto-repair" | "pause-for-approval" | "mute-noise" | "needs-person";

export interface FixerrorsDecision {
  clusterId: string;
  lane: string;
  action: FixerrorsDecisionAction;
  issueIds: string[];
  blockReason: string | null;
}

const AUTO_REPAIR_LANES = new Set(["fast", "standard", "guarded"]);

export function suggestClusterDisposition(cluster: ErrorRootCauseCluster): FixerrorsDecisionAction {
  if (cluster.lane === "critical") return "pause-for-approval";
  if (AUTO_REPAIR_LANES.has(cluster.lane)) return "auto-repair";
  if (cluster.rootCauseFamily === "user-input") return "mute-noise";
  return "needs-person";
}

export function clusterRepairBlockReason(
  cluster: ErrorRootCauseCluster,
  baseline: CodeBaseline | null,
): string | null {
  if (suggestClusterDisposition(cluster) !== "auto-repair") return null;
  const files = [...new Set(cluster.patterns.flatMap((pattern) => pattern.sourceFiles.map((ref) => ref.file)))];
  if (!baseline) return "Production and staging code refs were not compared";
  if (files.length === 0) {
    return "Auto-repair requires a source file present in both origin/main and origin/staging";
  }
  for (const file of files) {
    const path = baseline.paths.find((entry) => entry.file === file);
    if (!path?.productionBlob || !path.stagingBlob) {
      return `${file} is not present in both origin/main and origin/staging`;
    }
  }
  for (const id of cluster.issueIds) {
    const evidence = cluster.patterns.find(pattern => pattern.issueIds.includes(id))?.issueEvidence?.[id];
    if (!evidence?.sourceFiles.some(ref => ref.confidence === "high"
      && (ref.provenance === "client-stack" || ref.provenance === "server-stack"))) {
      return `Issue ${id} lacks its own original source frame; inferred locations are hints only`;
    }
  }
  return null;
}

export function buildFixerrorsDecisions(
  clusters: ErrorRootCauseCluster[],
  baseline: CodeBaseline | null = null,
): FixerrorsDecision[] {
  return clusters.map((cluster) => {
    const blockReason = clusterRepairBlockReason(cluster, baseline);
    return {
      clusterId: cluster.id,
      lane: cluster.lane,
      action: blockReason ? "needs-person" : suggestClusterDisposition(cluster),
      issueIds: cluster.issueIds,
      blockReason,
    };
  });
}

export function assertAutoRepairDecision(
  decisions: FixerrorsDecision[],
  clusterId: string,
  issueIds: string[],
): void {
  const decision = decisions.find((entry) => entry.clusterId === clusterId);
  const requested = new Set(issueIds);
  const decided = new Set(decision?.issueIds ?? []);
  if (
    !decision
    || issueIds.length === 0
    || requested.size !== issueIds.length
    || decided.size !== decision.issueIds.length
    || issueIds.some((issueId) => !decided.has(issueId))
  ) {
    throw new Error("Requested issue IDs are not a unique subset of the signed decision manifest");
  }
  if (decision.action !== "auto-repair" || decision.blockReason) {
    throw new Error(decision.blockReason ?? "Cluster is not an unblocked auto-repair");
  }
}

export function writeFixerrorsDecisions(
  path: string,
  decisions: FixerrorsDecision[],
  codeBaseline: CodeBaseline | null,
  snapshot: OpenIssueSnapshot,
) {
  const text = serializeDecisionManifest(snapshot, decisions, codeBaseline);
  writeAndVerifyTextArtifactAtomic(path, text);
  return text;
}

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const baselineSchema = z.object({ productionSha: sha, stagingSha: sha, paths: z.array(z.object({
  file: z.string().min(1), productionBlob: sha.nullable(), stagingBlob: sha.nullable(),
}).strict()) }).strict().nullable();
const decisionManifestSchema = z.object({
  version: z.literal(3), snapshotId: z.string().min(1), issueChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  codeBaseline: baselineSchema,
  decisions: z.array(z.object({
    clusterId: z.string().regex(/^cluster-\d+$/), lane: z.enum(["fast", "standard", "guarded", "critical", "report-only"]),
    action: z.enum(["auto-repair", "pause-for-approval", "mute-noise", "needs-person"]),
    issueIds: z.array(z.string().min(1)).min(1), blockReason: z.string().nullable(),
  }).strict()),
}).strict();

export function serializeDecisionManifest(snapshot: OpenIssueSnapshot, decisions: FixerrorsDecision[], codeBaseline: CodeBaseline | null): string {
  return `${JSON.stringify({ version: 3, snapshotId: snapshot.snapshotId, issueChecksum: snapshot.checksum, codeBaseline, decisions }, null, 2)}\n`;
}

export function assertBoundRepairDecision(snapshot: OpenIssueSnapshot, text: string, clusterId: string, issueIds: string[], lane: string, now = new Date()): void {
  if (!snapshot.analysis.decisionChecksum) throw new Error("Unbound decision manifest; re-export before committing");
  if (createHash("sha256").update(text).digest("hex") !== snapshot.analysis.decisionChecksum) throw new Error("Decision manifest checksum mismatch");
  const manifest = decisionManifestSchema.parse(JSON.parse(text));
  if (manifest.snapshotId !== snapshot.snapshotId || manifest.issueChecksum !== snapshot.checksum
    || snapshot.analysis.status !== "completed"
    || canonicalJson(manifest.codeBaseline) !== canonicalJson(snapshot.analysis.codeBaseline)) {
    throw new Error("Decision manifest does not match the snapshot ID, issues or code baseline");
  }
  const members = manifest.decisions.flatMap(decision => decision.issueIds);
  if (new Set(members).size !== members.length
    || canonicalJson([...members].sort()) !== canonicalJson(snapshot.issues.map(issue => issue.id).sort())
    || new Set(manifest.decisions.map(decision => decision.clusterId)).size !== manifest.decisions.length) {
    throw new Error("Decision manifest issue membership is invalid");
  }
  const selected = manifest.decisions.find(decision => decision.clusterId === clusterId);
  if (selected?.lane !== lane || !AUTO_REPAIR_LANES.has(lane)) throw new Error("Requested repair lane does not match the bound decision");
  if (snapshot.issues.some(issue => selected.issueIds.includes(issue.id) && issue.severity === "CRITICAL")) throw new Error("CRITICAL issue requires approval gates");
  assertSnapshotUsable(snapshot, snapshot.databaseTargetFingerprint, now);
  assertAutoRepairDecision(manifest.decisions, clusterId, issueIds);
}
