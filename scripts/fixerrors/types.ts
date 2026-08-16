export const FIXERRORS_COMMAND_ID = "fixerrors" as const;
export const FIXERRORS_SAFETY_CONTRACT = "fixerrors-open-issues-v1";
export const FIXERRORS_SNAPSHOT_VERSION = 1;
export const ERROR_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
export const EVENTS_PER_ISSUE = 10;

export type MonitoringIssueStatus = "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
export type ErrorClusterLane = "fast" | "standard" | "guarded" | "critical" | "report-only";
export type ErrorClusterAction = "fix" | "investigate" | "report-only" | "critical-gates";

export type SourceFileRef = {
  file: string;
  line?: number;
  column?: number;
};

export type SnapshotEvent = {
  id: string;
  source: string;
  severity: string;
  environment: string;
  message: string;
  stack: string | null;
  route: string | null;
  action: string | null;
  component: string | null;
  requestPath: string | null;
  occurredAt: string;
};

export type SnapshotIssue = {
  id: string;
  fingerprint: string;
  title: string;
  status: "OPEN";
  severity: string;
  source: string;
  lastSeenAt: string;
  occurrences: number;
  sampleMessage: string;
  sampleRoute: string | null;
  sampleAction: string | null;
  sampleComponent: string | null;
  events: SnapshotEvent[];
};

export type ErrorPattern = {
  patternKey: string;
  issueIds: string[];
  errorType: string;
  component: string;
  normalizedMessage: string;
  occurrences: number;
  sourceFiles: SourceFileRef[];
  affectedPages: string[];
  firstSeen: string;
  lastSeen: string;
};

export type ErrorRootCauseCluster = {
  id: string;
  rootCauseFamily: string;
  lane: ErrorClusterLane;
  action: ErrorClusterAction;
  patterns: ErrorPattern[];
  issueIds: string[];
  occurrences: number;
};

export type SnapshotAnalysis = {
  status: "pending" | "completed";
  reportPath: "private/fixerrors/error-analysis.md";
  reportChecksum: string | null;
  completedAt: string | null;
  clusterCount: number;
  clusterLanes: Record<string, number>;
  reportOnlyIssueIds: string[];
};

export type OpenIssueSnapshot = {
  version: typeof FIXERRORS_SNAPSHOT_VERSION;
  commandId: typeof FIXERRORS_COMMAND_ID;
  safetyContract: string;
  snapshotId: string;
  databaseTargetFingerprint: string;
  exportedAt: string;
  expiresAt: string;
  checksum: string;
  manifestChecksum: string;
  issues: SnapshotIssue[];
  analysis: SnapshotAnalysis;
};

export type ResolveConfirmation = {
  snapshotId: string;
  checksum: string;
  databaseTargetFingerprint: string;
  expiresAt: string;
  safetyContract: string;
  manifestChecksum: string;
  issueIds: string[];
  evidence: string;
  apply: boolean;
};

export type ResolveDecision =
  | "resolved"
  | "would-resolve"
  | "skipped-stale"
  | "skipped-not-open"
  | "skipped-missing"
  | "report-only";

export type ResolveIssueResult = {
  issueId: string;
  decision: ResolveDecision;
  reason: string;
};

export type ResolveRunResult = {
  runId: string;
  applied: boolean;
  results: ResolveIssueResult[];
};

export type PgClientLike = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};
