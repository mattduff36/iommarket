import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export async function logAdminAction(params: {
  adminId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  return db.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: (params.details as Prisma.InputJsonValue) ?? undefined,
    },
  });
}
