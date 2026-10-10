import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isStagingTestRuntime } from "@/lib/deployment/staging-test-runtime";
export { isStagingTestRuntime, StagingIdentityError } from "@/lib/deployment/staging-test-runtime";
import { redactMonitoringPayload } from "@/lib/monitoring/redact";

export const STAGING_TEST_ADMIN_ID = "staging-test";
export const STAGING_TEST_ENTITY_TYPE = "StagingTestEffect";

export type StagingTestEffectKind = "EMAIL" | "WEBHOOK" | "ALERT";

function compact(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

/**
 * Records a redacted staging communication. Returns null only when this process
 * is not a staging deployment, so callers keep their production provider path.
 * An explicit staging role with a mismatched identity throws and must not fall through.
 * Depends only on the database, deployment env, and the monitoring redactor.
 */
export async function captureStagingTestEffect(input: {
  kind: StagingTestEffectKind;
  payload: Record<string, unknown>;
  entityId?: string;
}): Promise<{ id: string } | null> {
  if (!isStagingTestRuntime()) return null;

  const details = redactMonitoringPayload(compact(input.payload)) ?? {};
  const row = await db.adminAuditLog.create({
    data: {
      adminId: STAGING_TEST_ADMIN_ID,
      action: input.kind,
      entityType: STAGING_TEST_ENTITY_TYPE,
      ...(input.entityId ? { entityId: input.entityId } : {}),
      details: details as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  if (!row.id) throw new Error("Staging test capture did not return an audit id.");
  return { id: `sim_${row.id}` };
}
