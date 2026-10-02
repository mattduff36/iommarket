import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ErrorRootCauseCluster } from "./types";

export type FixerrorsDecisionAction = "auto-repair" | "pause-for-approval" | "report-only";

export interface FixerrorsDecision {
  clusterId: string;
  lane: string;
  action: FixerrorsDecisionAction;
  issueIds: string[];
}

const AUTO_REPAIR_LANES = new Set(["fast", "standard", "guarded"]);

export function buildFixerrorsDecisions(clusters: ErrorRootCauseCluster[]): FixerrorsDecision[] {
  return clusters.map((cluster) => ({
    clusterId: cluster.id,
    lane: cluster.lane,
    action: cluster.lane === "critical"
      ? "pause-for-approval"
      : AUTO_REPAIR_LANES.has(cluster.lane)
        ? "auto-repair"
        : "report-only",
    issueIds: cluster.issueIds,
  }));
}

export function writeFixerrorsDecisions(path: string, decisions: FixerrorsDecision[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, decisions }, null, 2)}\n`);
}
