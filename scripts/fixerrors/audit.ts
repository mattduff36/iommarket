import { randomUUID } from "node:crypto";
import type { PgClientLike } from "./types";

export function newMonitoringId(): string {
  return `c${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function insertStatusEvent(
  client: PgClientLike,
  input: { issueId: string; fromStatus: string; toStatus: string; notes: string; now: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO "MonitoringIssueStatusEvent"
      (id, "issueId", "fromStatus", "toStatus", "changedByUserId", notes, "createdAt")
     VALUES ($1, $2, $3::"MonitoringIssueStatus", $4::"MonitoringIssueStatus", NULL, $5, $6)`,
    [newMonitoringId(), input.issueId, input.fromStatus, input.toStatus, input.notes, input.now],
  );
}

export async function insertAdminAudit(
  client: PgClientLike,
  input: { adminId: string; action: string; issueId: string; details: Record<string, unknown>; now: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO "AdminAuditLog"
      (id, "adminId", action, "entityType", "entityId", details, "createdAt")
     VALUES ($1, $2, $3, 'MonitoringIssue', $4, $5::jsonb, $6)`,
    [
      newMonitoringId(),
      input.adminId,
      input.action,
      input.issueId,
      JSON.stringify(input.details),
      input.now,
    ],
  );
}
