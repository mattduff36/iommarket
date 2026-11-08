import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { redactFreeText, redactStack } from "@/lib/monitoring/redact";
import { safeEventEvidence } from "./evidence";
import { safeRequestDiagnostics } from "@/lib/monitoring/request-diagnostics";
import { readInvestigation } from "@/lib/monitoring/investigation";
import {
  ERROR_SNAPSHOT_MAX_AGE_MS,
  EVENTS_PER_ISSUE,
  FIXERRORS_COMMAND_ID,
  FIXERRORS_SAFETY_CONTRACT,
  FIXERRORS_SNAPSHOT_VERSION,
  type OpenIssueSnapshot,
  type PgClientLike,
  type QueueStatusCounts,
  type SnapshotEvent,
  type SnapshotIssue,
} from "./types";

export const FIXERRORS_ARTIFACT_DIR = resolve(process.cwd(), "private", "fixerrors");
export const ERROR_SNAPSHOT_PATH = resolve(FIXERRORS_ARTIFACT_DIR, "error-snapshot.json");
export const ERROR_ANALYSIS_PATH = resolve(FIXERRORS_ARTIFACT_DIR, "error-analysis.md");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toIso(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Snapshot contains invalid ${field}`);
  }
  return parsed.toISOString();
}

function toPreciseIso(value: unknown, field: string): string {
  if (value instanceof Date) return toIso(value, field);
  const text = String(value);
  if (Number.isNaN(new Date(text).getTime())) {
    throw new Error(`Snapshot contains invalid ${field}`);
  }
  return text;
}

function safeCorrelationValue(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) return null;
  return /^[A-Za-z0-9:_-]+$/u.test(value) ? value : null;
}

export function writeAndVerifyTextArtifactAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx");
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
  const readBack = readFileSync(path, "utf8");
  if (readBack !== content) {
    throw new Error(`Failed to verify artefact at ${path}`);
  }
}

function canonicalSnapshotPayload(snapshot: Omit<OpenIssueSnapshot, "checksum" | "manifestChecksum">) {
  const payload: Record<string, unknown> = {
    version: snapshot.version,
    commandId: snapshot.commandId,
    safetyContract: snapshot.safetyContract,
    snapshotId: snapshot.snapshotId,
    databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
    exportedAt: snapshot.exportedAt,
    expiresAt: snapshot.expiresAt,
    issues: snapshot.issues,
    analysis: snapshot.analysis,
  };
  if (snapshot.queueStatusCounts) {
    payload.queueStatusCounts = snapshot.queueStatusCounts;
  }
  return JSON.stringify(payload);
}

export function sealSnapshot(
  snapshot: Omit<OpenIssueSnapshot, "checksum" | "manifestChecksum">,
): OpenIssueSnapshot {
  const checksum = sha256(JSON.stringify(snapshot.issues));
  const manifestChecksum = sha256(canonicalSnapshotPayload(snapshot));
  return { ...snapshot, checksum, manifestChecksum };
}

export function writeAndVerifySnapshot(snapshot: OpenIssueSnapshot, path = ERROR_SNAPSHOT_PATH): OpenIssueSnapshot {
  writeAndVerifyTextArtifactAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return readAndVerifySnapshot(path);
}

export function readAndVerifySnapshot(path = ERROR_SNAPSHOT_PATH): OpenIssueSnapshot {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as OpenIssueSnapshot;
  return verifySnapshot(parsed);
}

export function verifySnapshot(snapshot: OpenIssueSnapshot): OpenIssueSnapshot {
  if (snapshot.version !== FIXERRORS_SNAPSHOT_VERSION) {
    throw new Error("Unsupported fixerrors snapshot version");
  }
  if (snapshot.commandId !== FIXERRORS_COMMAND_ID) {
    throw new Error("Snapshot command id mismatch");
  }
  if (![FIXERRORS_SAFETY_CONTRACT, "fixerrors-open-issues-v3"].includes(snapshot.safetyContract)) {
    throw new Error("Snapshot safety contract mismatch");
  }
  if (!/^[a-f0-9]{64}$/u.test(snapshot.checksum) || !/^[a-f0-9]{64}$/u.test(snapshot.manifestChecksum)) {
    throw new Error("Snapshot checksums are malformed");
  }
  const resealed = sealSnapshot({
    version: snapshot.version,
    commandId: snapshot.commandId,
    safetyContract: snapshot.safetyContract,
    snapshotId: snapshot.snapshotId,
    databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
    exportedAt: snapshot.exportedAt,
    expiresAt: snapshot.expiresAt,
    issues: snapshot.issues,
    analysis: snapshot.analysis,
    ...(snapshot.queueStatusCounts ? { queueStatusCounts: snapshot.queueStatusCounts } : {}),
  });
  if (resealed.checksum !== snapshot.checksum || resealed.manifestChecksum !== snapshot.manifestChecksum) {
    throw new Error("Snapshot checksum verification failed");
  }
  return snapshot;
}

export function assertSnapshotUsable(
  snapshot: OpenIssueSnapshot,
  expectedTarget: string,
  now = new Date(),
): void {
  verifySnapshot(snapshot);
  if (snapshot.safetyContract !== FIXERRORS_SAFETY_CONTRACT) throw new Error("Re-export using the current unresolved-issue safety contract before changing statuses");
  if (snapshot.databaseTargetFingerprint !== expectedTarget) {
    throw new Error("Snapshot belongs to a different database target");
  }
  if (new Date(snapshot.expiresAt).getTime() <= now.getTime()) {
    throw new Error("Snapshot has expired; re-export before resolving");
  }
}

function normalizeIssue(row: Record<string, unknown>, events: SnapshotEvent[]): SnapshotIssue {
  if (row.status !== "OPEN" && row.status !== "ACKNOWLEDGED") {
    throw new Error("Snapshot export included a terminal or muted issue");
  }
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    title: redactFreeText(String(row.title ?? "")),
    status: row.status,
    investigation: readInvestigation(row.investigation),
    severity: String(row.severity),
    source: String(row.source),
    lastSeenAt: toPreciseIso(row.lastSeenAt, "lastSeenAt"),
    occurrences: Number(row.occurrences),
    sampleMessage: redactFreeText(String(row.sampleMessage ?? "")),
    sampleRoute: row.sampleRoute == null ? null : redactFreeText(String(row.sampleRoute)),
    sampleAction: row.sampleAction == null ? null : String(row.sampleAction),
    sampleComponent: row.sampleComponent == null ? null : String(row.sampleComponent),
    events,
  };
}

function normalizeEvent(row: Record<string, unknown>): SnapshotEvent {
  return {
    id: String(row.id),
    source: String(row.source),
    severity: String(row.severity),
    environment: String(row.environment),
    message: redactFreeText(String(row.message ?? "")),
    stack: redactStack(row.stack == null ? null : String(row.stack)),
    route: row.route == null ? null : redactFreeText(String(row.route)),
    action: row.action == null ? null : String(row.action),
    component: row.component == null ? null : String(row.component),
    requestPath: row.requestPath == null ? null : redactFreeText(String(row.requestPath)),
    digest: safeCorrelationValue(row.digest),
    traceId: safeCorrelationValue(row.traceId),
    evidence: safeEventEvidence(row),
    requests: safeRequestDiagnostics(row.requests),
    occurredAt: toPreciseIso(row.occurredAt, "occurredAt"),
  };
}

const QUEUE_STATUS_COUNTS: QueueStatusCounts = {
  OPEN: 0,
  ACKNOWLEDGED: 0,
  MUTED: 0,
  RESOLVED: 0,
  EXPIRED: 0,
};

function normalizeQueueStatusCounts(rows: Array<Record<string, unknown>>): QueueStatusCounts {
  const counts: QueueStatusCounts = { ...QUEUE_STATUS_COUNTS };
  for (const row of rows) {
    const status = String(row.status);
    const count = Number(row.count);
    if (
      (status === "OPEN" || status === "ACKNOWLEDGED" || status === "MUTED" || status === "RESOLVED" || status === "EXPIRED")
      && Number.isInteger(count)
      && count >= 0
    ) {
      counts[status] = count;
    }
  }
  return counts;
}

export async function fetchOpenIssueSnapshot(
  client: PgClientLike,
  databaseTargetFingerprint: string,
  now = new Date(),
): Promise<OpenIssueSnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    // Prisma stores these columns as UTC timestamp without time zone. Format
    // them directly so neither pg's parser nor the SQL session timezone shifts them.
    const issuesResult = await client.query(
      `SELECT id, fingerprint, title, status, severity, source,
              to_char("lastSeenAt", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lastSeenAt",
              occurrences,
              "sampleMessage", "sampleRoute", "sampleAction", "sampleComponent", to_jsonb("MonitoringIssue")->'investigation' AS investigation
       FROM "MonitoringIssue"
       WHERE status IN ('OPEN', 'ACKNOWLEDGED')
       ORDER BY severity DESC, "lastSeenAt" DESC, id ASC`,
    );
    const issueIds = issuesResult.rows.map((row) => String(row.id));
    const eventsByIssue = new Map<string, SnapshotEvent[]>();
    if (issueIds.length > 0) {
      const eventsResult = await client.query(
        `WITH ranked_events AS (
           SELECT id, "issueId", source, severity, environment, message, stack, route, action,
                  component, "requestPath", tags->>'digest' AS digest,
                  tags->>'traceId' AS "traceId", "requestId",
                  tags->>'userAgent' AS "userAgent", tags->>'ingestRelease' AS "ingestRelease",
                  tags->>'clientStackProvided' AS "clientStackProvided",
                    tags->>'serverRelease' AS "serverRelease", tags->>'clientRelease' AS "clientRelease",
                  tags->>'filename' AS filename, tags->>'line' AS line, tags->>'col' AS col,
                  tags->>'inboxId' AS "inboxId", tags->>'attemptId' AS "attemptId", tags->>'errorCode' AS "errorCode",
                  tags->>'rejectStage' AS "rejectStage", tags->>'envReason' AS "envReason", tags->>'ccyState' AS "ccyState",
                  tags->>'attemptNumber' AS "attemptNumber", tags->>'receiptAgeMs' AS "receiptAgeMs", tags->>'processingState' AS "processingState",
                  tags->>'stage' AS stage, tags->>'missingBucket' AS "missingBucket", extra->'operationFacts' AS "operationFacts",
                  extra->'diagnostics' AS diagnostics, extra->'requests' AS requests,
                  extra->'triggeringRequest' AS "triggeringRequest",
                  extra->>'displayedSupportReference' AS "displayedSupportReference", "occurredAt",
                  row_number() OVER (PARTITION BY "issueId" ORDER BY "occurredAt" DESC, id DESC) AS issue_event_rank
           FROM "MonitoringEvent"
           WHERE "issueId" = ANY($1::text[])
         )
         SELECT id, "issueId", source, severity, environment, message, stack, route, action,
                component, "requestPath", digest, "traceId", "requestId", "userAgent",
                "ingestRelease", "serverRelease", "clientRelease", "clientStackProvided", filename, line, col, "inboxId", "attemptId", "errorCode", "rejectStage", "envReason", "ccyState", "attemptNumber", "receiptAgeMs", "processingState", stage, "missingBucket", "operationFacts", diagnostics, requests, "triggeringRequest", "displayedSupportReference",
                to_char("occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "occurredAt"
         FROM ranked_events
         WHERE issue_event_rank <= $2
         ORDER BY "issueId", ranked_events."occurredAt" DESC, id DESC`,
        [issueIds, EVENTS_PER_ISSUE],
      );
      for (const row of eventsResult.rows) {
        const issueId = String(row.issueId);
        const list = eventsByIssue.get(issueId) ?? [];
        if (list.length < EVENTS_PER_ISSUE) list.push(normalizeEvent(row));
        eventsByIssue.set(issueId, list);
      }
    }
    const statusCounts = await client.query(
      `SELECT status::text AS status, COUNT(*)::int AS count
       FROM "MonitoringIssue"
       GROUP BY status`,
    );
    const queueStatusCounts = normalizeQueueStatusCounts(statusCounts.rows);
    await client.query("COMMIT");

    const issues = issuesResult.rows.map((row) =>
      normalizeIssue(row, eventsByIssue.get(String(row.id)) ?? []),
    );
    return sealSnapshot({
      version: FIXERRORS_SNAPSHOT_VERSION,
      commandId: FIXERRORS_COMMAND_ID,
      safetyContract: FIXERRORS_SAFETY_CONTRACT,
      snapshotId: randomUUID(),
      databaseTargetFingerprint,
      exportedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ERROR_SNAPSHOT_MAX_AGE_MS).toISOString(),
      issues,
      analysis: {
        status: "pending",
        reportPath: "private/fixerrors/error-analysis.md",
        reportChecksum: null,
        completedAt: null,
        clusterCount: 0,
        clusterLanes: {},
        reportOnlyIssueIds: [],
        codeBaseline: null,
      },
      queueStatusCounts,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function assertSnapshotTarget(snapshot: OpenIssueSnapshot, expectedTarget: string): void {
  verifySnapshot(snapshot);
  if (snapshot.databaseTargetFingerprint !== expectedTarget) {
    throw new Error("Snapshot belongs to a different database target");
  }
}

export function markSnapshotAnalysisCompleted(
  snapshot: OpenIssueSnapshot,
  report: string,
  clusterLanes: Record<string, number>,
  clusterCount: number,
  reportOnlyIssueIds: string[],
  codeBaseline: OpenIssueSnapshot["analysis"]["codeBaseline"] = null,
  now = new Date(),
): OpenIssueSnapshot {
  return sealSnapshot({
    ...snapshot,
    analysis: {
      status: "completed",
      reportPath: "private/fixerrors/error-analysis.md",
      reportChecksum: sha256(report),
      completedAt: now.toISOString(),
      clusterCount,
      clusterLanes,
      reportOnlyIssueIds: [...new Set(reportOnlyIssueIds)].sort(),
      codeBaseline,
    },
  });
}
