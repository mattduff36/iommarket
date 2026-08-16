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
import {
  ERROR_SNAPSHOT_MAX_AGE_MS,
  EVENTS_PER_ISSUE,
  FIXERRORS_COMMAND_ID,
  FIXERRORS_SAFETY_CONTRACT,
  FIXERRORS_SNAPSHOT_VERSION,
  type OpenIssueSnapshot,
  type PgClientLike,
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
    throw new Error(`Failed to verify artifact at ${path}`);
  }
}

function canonicalSnapshotPayload(snapshot: Omit<OpenIssueSnapshot, "checksum" | "manifestChecksum">) {
  return JSON.stringify({
    version: snapshot.version,
    commandId: snapshot.commandId,
    safetyContract: snapshot.safetyContract,
    snapshotId: snapshot.snapshotId,
    databaseTargetFingerprint: snapshot.databaseTargetFingerprint,
    exportedAt: snapshot.exportedAt,
    expiresAt: snapshot.expiresAt,
    issues: snapshot.issues,
    analysis: snapshot.analysis,
  });
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
  if (snapshot.safetyContract !== FIXERRORS_SAFETY_CONTRACT) {
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
  if (snapshot.databaseTargetFingerprint !== expectedTarget) {
    throw new Error("Snapshot belongs to a different database target");
  }
  if (new Date(snapshot.expiresAt).getTime() <= now.getTime()) {
    throw new Error("Snapshot has expired; re-export before resolving");
  }
}

function normalizeIssue(row: Record<string, unknown>, events: SnapshotEvent[]): SnapshotIssue {
  if (row.status !== "OPEN") {
    throw new Error("Snapshot export included a non-OPEN issue");
  }
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    title: redactFreeText(String(row.title ?? "")),
    status: "OPEN",
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
    occurredAt: toIso(row.occurredAt, "occurredAt"),
  };
}

export async function fetchOpenIssueSnapshot(
  client: PgClientLike,
  databaseTargetFingerprint: string,
  now = new Date(),
): Promise<OpenIssueSnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const issuesResult = await client.query(
      `SELECT id, fingerprint, title, status, severity, source,
              to_char("lastSeenAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "lastSeenAt",
              occurrences,
              "sampleMessage", "sampleRoute", "sampleAction", "sampleComponent"
       FROM "MonitoringIssue"
       WHERE status = 'OPEN'
       ORDER BY severity DESC, "lastSeenAt" DESC, id ASC`,
    );
    const issueIds = issuesResult.rows.map((row) => String(row.id));
    const eventsByIssue = new Map<string, SnapshotEvent[]>();
    if (issueIds.length > 0) {
      const eventsResult = await client.query(
        `SELECT id, "issueId", source, severity, environment, message, stack, route, action,
                component, "requestPath", "occurredAt"
         FROM "MonitoringEvent"
         WHERE "issueId" = ANY($1::text[])
         ORDER BY "occurredAt" DESC, id DESC`,
        [issueIds],
      );
      for (const row of eventsResult.rows) {
        const issueId = String(row.issueId);
        const list = eventsByIssue.get(issueId) ?? [];
        if (list.length < EVENTS_PER_ISSUE) list.push(normalizeEvent(row));
        eventsByIssue.set(issueId, list);
      }
    }
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
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function markSnapshotAnalysisCompleted(
  snapshot: OpenIssueSnapshot,
  report: string,
  clusterLanes: Record<string, number>,
  clusterCount: number,
  reportOnlyIssueIds: string[],
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
    },
  });
}
