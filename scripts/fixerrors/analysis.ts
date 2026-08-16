import { extractSourceFilesForIssue } from "./source-extraction";
import type {
  ErrorClusterAction,
  ErrorClusterLane,
  ErrorPattern,
  ErrorRootCauseCluster,
  SnapshotIssue,
} from "./types";

export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\b[0-9a-f]{24,}\b/gi, "<ID>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, "<TIMESTAMP>")
    .replace(/https?:\/\/[^\s)]+/g, "<URL>")
    .trim()
    .substring(0, 200);
}

export function groupOpenIssues(
  issues: SnapshotIssue[],
  repoRoot = process.cwd(),
): ErrorPattern[] {
  const patternMap = new Map<string, ErrorPattern>();

  for (const issue of issues) {
    if (issue.status !== "OPEN") continue;
    const normalizedMessage = normalizeMessage(issue.sampleMessage || issue.title);
    const component = issue.sampleComponent || issue.sampleAction || "Unknown";
    const key = `${issue.source}::${component}::${normalizedMessage}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        patternKey: key,
        issueIds: [],
        errorType: issue.source,
        component,
        normalizedMessage,
        occurrences: 0,
        sourceFiles: [],
        affectedPages: [],
        firstSeen: issue.lastSeenAt,
        lastSeen: issue.lastSeenAt,
      });
    }
    const pattern = patternMap.get(key)!;
    pattern.issueIds.push(issue.id);
    pattern.occurrences += issue.occurrences;
    if (issue.lastSeenAt < pattern.firstSeen) pattern.firstSeen = issue.lastSeenAt;
    if (issue.lastSeenAt > pattern.lastSeen) pattern.lastSeen = issue.lastSeenAt;
    const page = issue.sampleRoute || issue.events[0]?.requestPath;
    if (page && !pattern.affectedPages.includes(page)) pattern.affectedPages.push(page);
    for (const ref of extractSourceFilesForIssue(issue, repoRoot)) {
      if (!pattern.sourceFiles.some((existing) => existing.file === ref.file && existing.line === ref.line)) {
        pattern.sourceFiles.push(ref);
      }
    }
  }

  return Array.from(patternMap.values()).sort((a, b) => b.occurrences - a.occurrences);
}

function classifyRootCauseFamily(pattern: ErrorPattern): string {
  const text = [pattern.errorType, pattern.component, pattern.normalizedMessage, ...pattern.affectedPages]
    .join(" ")
    .toLowerCase();
  if (/\b(rls|row level|auth|jwt|permission|forbidden|unauthori[sz]ed|access control)\b/u.test(text)) {
    return "auth-permissions-security";
  }
  if (/\b(postgres|database|sql|constraint|foreign key|schema|migration)\b/u.test(text)) {
    return "database-persistence";
  }
  if (/\b(payment|billing|invoice|money|charge|ripple)\b/u.test(text)) {
    return "money-billing";
  }
  if (/\b(deadlock|race condition|concurren|transaction conflict)\b/u.test(text)) {
    return "concurrency-transaction";
  }
  if (/\b(network|failed to fetch|econn|enotfound|third[- ]party|gateway|offline)\b/u.test(text)) {
    return "external-network";
  }
  if (/\b(validation|invalid input|required field|user input)\b/u.test(text)) {
    return "user-input";
  }
  const primarySource = pattern.sourceFiles[0]?.file;
  return primarySource
    ? `source:${primarySource}`
    : `component:${pattern.component.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
}

function classifyCluster(
  rootCauseFamily: string,
  patterns: ErrorPattern[],
): { lane: ErrorClusterLane; action: ErrorClusterAction } {
  if (
    rootCauseFamily === "auth-permissions-security" ||
    rootCauseFamily === "database-persistence" ||
    rootCauseFamily === "money-billing" ||
    rootCauseFamily === "concurrency-transaction"
  ) {
    return { lane: "critical", action: "critical-gates" };
  }
  if (rootCauseFamily === "external-network" || rootCauseFamily === "user-input") {
    return { lane: "report-only", action: "report-only" };
  }
  const sourceFiles = new Set(patterns.flatMap((pattern) => pattern.sourceFiles.map((ref) => ref.file)));
  if (patterns.length > 2 || sourceFiles.size > 2) return { lane: "guarded", action: "investigate" };
  if (patterns.length > 1 || sourceFiles.size > 1) return { lane: "standard", action: "fix" };
  return sourceFiles.size === 1
    ? { lane: "fast", action: "fix" }
    : { lane: "report-only", action: "report-only" };
}

export function clusterErrorPatterns(patterns: ErrorPattern[]): ErrorRootCauseCluster[] {
  const grouped = new Map<string, ErrorPattern[]>();
  for (const pattern of patterns) {
    const family = classifyRootCauseFamily(pattern);
    grouped.set(family, [...(grouped.get(family) ?? []), pattern]);
  }
  return [...grouped.entries()]
    .map(([rootCauseFamily, familyPatterns], index) => {
      const classification = classifyCluster(rootCauseFamily, familyPatterns);
      return {
        id: `cluster-${index + 1}`,
        rootCauseFamily,
        ...classification,
        patterns: familyPatterns,
        issueIds: familyPatterns.flatMap((pattern) => pattern.issueIds),
        occurrences: familyPatterns.reduce((total, pattern) => total + pattern.occurrences, 0),
      };
    })
    .sort((left, right) => right.occurrences - left.occurrences);
}

export function generateAnalysisReport(
  issues: SnapshotIssue[],
  patterns: ErrorPattern[],
  clusters: ErrorRootCauseCluster[],
): string {
  const lines = [
    "# Monitoring Error Analysis Report",
    "",
    `> **Generated:** ${new Date().toISOString()}`,
    `> **OPEN issues:** ${issues.length} | **Patterns:** ${patterns.length} | **Clusters:** ${clusters.length}`,
    "",
    "This file is overwritten each time `npm run fixerrors` runs.",
    "Use it as context for Cursor to analyze and fix codebase issues.",
    "",
    "## Root Cause Clusters and TEE Routing",
    "",
    "| Cluster | Root cause family | Lane | Action | Issues | Occurrences |",
    "|---|---|---|---|---:|---:|",
  ];

  for (const cluster of clusters) {
    lines.push(
      `| ${cluster.id} | ${cluster.rootCauseFamily} | ${cluster.lane.toUpperCase()} | ${cluster.action} | ${cluster.issueIds.length} | ${cluster.occurrences} |`,
    );
  }

  lines.push("");
  lines.push("Clusters are routed independently; a CRITICAL cluster does not escalate unrelated clusters.");
  lines.push("");
  lines.push("## OPEN Issues");
  lines.push("");

  for (const issue of issues) {
    const pattern = patterns.find((entry) => entry.issueIds.includes(issue.id));
    const files = pattern?.sourceFiles.slice(0, 8).map((ref) => `\`${ref.file}\``).join(", ") || "none";
    lines.push(`### ${issue.id}`);
    lines.push("");
    lines.push(`- Severity: ${issue.severity}`);
    lines.push(`- Source: ${issue.source}`);
    lines.push(`- Occurrences: ${issue.occurrences}`);
    lines.push(`- Last seen: ${issue.lastSeenAt}`);
    lines.push(`- Message: ${issue.sampleMessage}`);
    lines.push(`- Route: ${issue.sampleRoute ?? "n/a"}`);
    lines.push(`- Action: ${issue.sampleAction ?? "n/a"}`);
    lines.push(`- Suggested files: ${files}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function summarizeClusterLanes(clusters: ErrorRootCauseCluster[]): Record<string, number> {
  return clusters.reduce<Record<string, number>>((summary, cluster) => {
    summary[cluster.lane] = (summary[cluster.lane] ?? 0) + 1;
    return summary;
  }, {});
}
