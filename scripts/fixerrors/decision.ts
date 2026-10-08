import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CodeBaseline, ErrorRootCauseCluster } from "./types";

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
) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 2, codeBaseline, decisions }, null, 2)}\n`);
}
