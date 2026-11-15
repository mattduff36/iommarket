import { readInvestigation } from "@/lib/monitoring/investigation";
import { buildFixerrorsDecisions, type FixerrorsDecision } from "./decision";
import { buildSourceIndex, extractSourceFilesForIssue, isOpaqueScriptError } from "./source-extraction";
import type {
  CodeBaseline,
  ErrorClusterAction,
  ErrorClusterLane,
  ErrorPattern,
  ErrorRootCauseCluster,
  QueueStatusCounts,
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
  const sourceIndex = buildSourceIndex(repoRoot);

  for (const issue of issues) {
    if (issue.status !== "OPEN" && issue.status !== "ACKNOWLEDGED") continue;
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
        issueEvidence: {},
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
    const refs = extractSourceFilesForIssue(issue, repoRoot, sourceIndex);
    pattern.issueEvidence = { ...pattern.issueEvidence, [issue.id]: { severity: issue.severity, sourceFiles: refs } };
    for (const ref of refs) {
      if (!pattern.sourceFiles.some((existing) => existing.file === ref.file && existing.line === ref.line)) {
        pattern.sourceFiles.push(ref);
      }
    }
  }

  return Array.from(patternMap.values()).sort((a, b) => b.occurrences - a.occurrences);
}

function classifyMoneyFamily(text: string): string | null {
  if (!/\b(payment|billing|invoice|money|charge|ripple)\b/u.test(text)) return null;
  if (/\bunknown product\b/u.test(text)) return "money-billing:unknown-product";
  if (/\bcurrency validation\b/u.test(text)) return "money-billing:currency-validation";
  return "money-billing";
}

function isCriticalRootCauseFamily(rootCauseFamily: string): boolean {
  return (
    rootCauseFamily === "auth-permissions-security" ||
    rootCauseFamily === "database-persistence" ||
    rootCauseFamily === "money-billing" ||
    rootCauseFamily.startsWith("money-billing:") ||
    rootCauseFamily === "concurrency-transaction"
  );
}

function classifyRootCauseFamily(pattern: ErrorPattern): string {
  const text = [pattern.errorType, pattern.component, pattern.normalizedMessage, ...pattern.affectedPages]
    .join(" ")
    .toLowerCase()
    .replace(/_/gu, " ");
  if (isOpaqueScriptError(pattern.normalizedMessage)) return "opaque-script-error";
  if (/\b(rls|row level|auth|jwt|permission|forbidden|unauthori[sz]ed|access control)\b/u.test(text)) {
    return "auth-permissions-security";
  }
  if (/\b(postgres|database|sql|constraint|foreign key|schema|migration|42p01|undefined table|relation .{1,120} does not exist|table .{1,120} does not exist)\b/u.test(text)) {
    return "database-persistence";
  }
  if (/react error #?441|server components render/u.test(text)) {
    return "react-server-components-digest";
  }
  const moneyFamily = classifyMoneyFamily(text);
  if (moneyFamily) return moneyFamily;
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
  if (isCriticalRootCauseFamily(rootCauseFamily)
    || patterns.some(pattern => Object.values(pattern.issueEvidence ?? {}).some(evidence => evidence.severity === "CRITICAL"))) {
    return { lane: "critical", action: "critical-gates" };
  }
  if (rootCauseFamily === "opaque-script-error" || rootCauseFamily === "react-server-components-digest") {
    return { lane: "report-only", action: "report-only" };
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

export function describeCodeBaseline(baseline: CodeBaseline | null): string[] {
  if (!baseline) return ["Production and staging code refs were not compared."];
  const lines = [
    `- origin/main: \`${baseline.productionSha}\``,
    `- origin/staging: \`${baseline.stagingSha}\``,
  ];
  for (const path of baseline.paths) {
    if (!path.productionBlob || !path.stagingBlob) {
      const missing = [
        path.productionBlob ? null : "origin/main",
        path.stagingBlob ? null : "origin/staging",
      ].filter(Boolean).join(" and ");
      lines.push(`- \`${path.file}\`: missing from ${missing}. Leave the issue acknowledged until the file exists in both refs.`);
      continue;
    }
    lines.push(`- \`${path.file}\`: present in both refs${path.productionBlob === path.stagingBlob ? "" : "; staging differs from production"}.`);
  }
  return lines;
}

export function formatQueueStatusCounts(counts: QueueStatusCounts): string {
  return `OPEN ${counts.OPEN} | ACKNOWLEDGED ${counts.ACKNOWLEDGED} | MUTED ${counts.MUTED} | RESOLVED ${counts.RESOLVED} | EXPIRED ${counts.EXPIRED ?? 0}`;
}

export function generateAnalysisReport(
  issues: SnapshotIssue[],
  patterns: ErrorPattern[],
  clusters: ErrorRootCauseCluster[],
  baseline: CodeBaseline | null = null,
  history: string[] = [],
  queueStatusCounts?: QueueStatusCounts,
  decisions: FixerrorsDecision[] = buildFixerrorsDecisions(clusters, baseline),
): string {
  const records = issues.map(issue => ({ issue, record: readInvestigation(issue.investigation) }));
  const missing = records.filter(({ record }) => !record).length;
  const overdue = records.filter(({ record }) => record && Date.parse(record.reviewAfter) <= Date.now()).length;
  const recurred = records.filter(({ issue, record }) => record?.observedLastSeenAt && Date.parse(issue.lastSeenAt) > Date.parse(record.observedLastSeenAt)).length;
  const lines = [
    "# Monitoring Error Analysis Report",
    "",
    `> **Generated:** ${new Date().toISOString()}`,
    `> **Unresolved issues:** ${issues.length} | **Patterns:** ${patterns.length} | **Clusters:** ${clusters.length}`,
    ...(queueStatusCounts
      ? [`> **Queue statuses:** ${formatQueueStatusCounts(queueStatusCounts)} (export includes OPEN and ACKNOWLEDGED)`]
      : []),
    "",
    `Investigation coverage: ${issues.length - missing}/${issues.length}; missing plans: ${missing}; overdue reviews: ${overdue}; recurred since review: ${recurred}.`,
    "This current report is replaced on export; its per-snapshot archive is retained.",
    "Collection complete; investigation and repair remain the chat engineer's responsibility.",
    "Classifications below are advisory. Use source, logs, database and browser evidence to attempt repairs; retaining a plan is not an investigation outcome.",
    "For lower-risk browser failures, consider a bounded, reversible mitigation with tests and a verification plan when exact cause remains uncertain. Do not suppress unknown errors or claim a mitigation proves resolution.",
    "Database connection, payment, security and data-integrity changes require an established cause and their existing approval gates. Assess actual impact, not just the reported severity or lane.",
    "",
    "## Suggested fault groups (not established root causes)",
    "",
    "| Cluster | Suggested family | Suggested lane | Legacy automation hint | Evidence limitation | Issues | Occurrences |",
    "|---|---|---|---|---|---:|---:|",
  ];

  for (const cluster of clusters) {
    const decision = decisions.find(decision => decision.clusterId === cluster.id);
    const disposition = decision?.action ?? "needs-person";
    const reason = (decision?.blockReason ?? "none").replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
    lines.push(
      `| ${cluster.id} | ${cluster.rootCauseFamily} | ${cluster.lane.toUpperCase()} | ${disposition} | ${reason} | ${cluster.issueIds.length} | ${cluster.occurrences} |`,
    );
  }

  lines.push("");
  lines.push("needs-person means hand back to the chat engineer, not stop or ask the user to diagnose it. --engineer-reviewed permits reviewed non-critical repairs despite classifier limitations; snapshot, path, diff-review and release checks still apply.");
  lines.push("Source frames are investigation candidates, not proof of root cause. Route, action and chunk matches are low-confidence hints; every auto-repair issue needs its own original source frame.");
  lines.push("Clusters are routed independently; a CRITICAL cluster does not escalate unrelated clusters.");
  if (patterns.some((pattern) => /react error #?441|server components render/i.test(pattern.normalizedMessage))) {
    lines.push("React error #441 is a Server Components render failure with a production-hidden message. Correlate the client digest with a server event using the same route and nearby timestamp; trace IDs can support the match. Without that evidence, keep the issue open and do not attribute it to a neighbouring database or payment error.");
  }
  lines.push("");
  lines.push("## Production and staging code");
  lines.push("");
  lines.push(...describeCodeBaseline(baseline));
  lines.push("");
  lines.push(...(history.length > 0 ? history : [
    "## What we already know",
    "",
    "No alert history was attached to this report.",
    "",
  ]));
  lines.push("## Unresolved issues");
  lines.push("");

  for (const issue of issues) {
    const pattern = patterns.find((entry) => entry.issueIds.includes(issue.id));
    const files = pattern?.issueEvidence?.[issue.id]?.sourceFiles.slice(0, 8)
      .map((ref) => `\`${ref.file}\` (${ref.provenance}, ${ref.confidence})`).join(", ") || "none";
    lines.push(`### ${issue.id}`);
    lines.push("");
    lines.push(`- Severity: ${issue.severity}`);
    lines.push(`- Source: ${issue.source}`);
    lines.push(`- Status: ${issue.status}`);
    lines.push(`- Occurrences: ${issue.occurrences}`);
    lines.push(`- Last seen: ${issue.lastSeenAt}`);
    lines.push(`- Message: ${issue.sampleMessage}`);
    lines.push(`- Route: ${issue.sampleRoute ?? "n/a"}`);
    lines.push(`- Action: ${issue.sampleAction ?? "n/a"}`);
    lines.push(`- Suggested files: ${files}`);
    if (issue.investigation) lines.push(`- Investigation record: ${JSON.stringify(issue.investigation)}`);
    lines.push(`- Evidence: ${issue.events.length} retained event(s); ${issue.events.filter(event => event.stack).length} with a stack. Missing evidence is not proof of noise.`);
    for (const event of issue.events) {
      if (event.evidence && Object.keys(event.evidence).length > 0) {
        lines.push(`- Event ${event.id} diagnostic facts (client values are untrusted): ${JSON.stringify(event.evidence)}`);
      }
      if (event.requests?.length) lines.push(`- Event ${event.id} request history (client-reported): ${JSON.stringify(event.requests)}`);
    }
    const correlations = issue.events
      .filter((event) => event.digest || event.traceId)
      .map((event) => `${event.source} ${event.route ?? event.requestPath ?? "route n/a"} at ${event.occurredAt}: digest=${event.digest ?? "n/a"}, traceId=${event.traceId ?? "n/a"}`);
    if (correlations.length > 0) {
      lines.push(`- Allowlisted correlation evidence: ${correlations.join("; ")}`);
    }
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
