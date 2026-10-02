"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAdminAction } from "@/lib/admin/audit";
import { buildCursorPrompt } from "@/lib/monitoring/prompt";
import { captureException } from "@/lib/monitoring";

const setIssueStatusSchema = z.object({
  issueId: z.string().cuid(),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"]),
  mutedHours: z.number().int().min(1).max(24 * 30).optional(),
  notes: z.string().trim().max(500).optional(),
});

async function applyMonitoringStatus(
  adminId: string,
  input: {
    issueId: string;
    status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
    mutedHours?: number;
    notes?: string;
  },
) {
  const now = new Date();

  try {
    const issue = await db.$transaction(async (tx) => {
      const existing = await tx.monitoringIssue.findUnique({
        where: { id: input.issueId },
        select: { status: true, severity: true },
      });
      const updated = await tx.monitoringIssue.update({
        where: { id: input.issueId },
        data: {
          status: input.status,
          mutedUntil:
            input.status === "MUTED"
              ? new Date(now.getTime() + (input.mutedHours ?? 24) * 60 * 60 * 1000)
              : null,
          resolvedAt: input.status === "RESOLVED" ? now : null,
          acknowledgedAt: input.status === "ACKNOWLEDGED" ? now : null,
          acknowledgedSeverity: input.status === "ACKNOWLEDGED" ? existing?.severity ?? null : null,
          assigneeAdminId: adminId,
        },
      });
      await tx.monitoringIssueStatusEvent.create({
        data: {
          issueId: input.issueId,
          fromStatus: existing?.status,
          toStatus: input.status,
          changedByUserId: adminId,
          notes: input.notes,
        },
      });
      return updated;
    });

    await logAdminAction({
      adminId,
      action: "SET_MONITORING_ISSUE_STATUS",
      entityType: "MonitoringIssue",
      entityId: input.issueId,
      details: {
        status: input.status,
        mutedHours: input.mutedHours ?? null,
        notes: input.notes ?? null,
      },
    });

    revalidatePath("/admin/monitoring");
    revalidatePath(`/admin/monitoring/${input.issueId}`);
    return { data: issue };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setMonitoringIssueStatus",
      route: `/admin/monitoring/${input.issueId}`,
      requestPath: `/admin/monitoring/${input.issueId}`,
      userId: adminId,
      tags: { issueId: input.issueId, status: input.status },
    });
    const message =
      err instanceof Error ? err.message : "Failed to update monitoring issue";
    return { error: message };
  }
}

export async function setMonitoringIssueStatus(input: {
  issueId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  mutedHours?: number;
  notes?: string;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = setIssueStatusSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  return applyMonitoringStatus(admin.id, parsed.data);
}

const bulkStatusSchema = z.object({
  issueIds: z.array(z.string().cuid()).min(1).max(50),
  status: z.enum(["OPEN", "ACKNOWLEDGED", "MUTED", "RESOLVED"]),
  mutedHours: z.number().int().min(1).max(24 * 30).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function setMonitoringIssueStatusBulk(input: {
  issueIds: string[];
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  mutedHours?: number;
  notes?: string;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = bulkStatusSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const results = [];
  for (const issueId of parsed.data.issueIds) {
    results.push(await applyMonitoringStatus(admin.id, { ...parsed.data, issueId }));
  }
  const failed = results.filter((result) => "error" in result && result.error).length;
  return { data: { updated: results.length - failed, failed } };
}

export async function revealMonitoringEventIdentity(eventId: string) {
  const admin = await requireRole("ADMIN");
  const parsed = z.string().cuid().safeParse(eventId);
  if (!parsed.success) return { error: "Event not found" };
  const event = await db.monitoringEvent.findUnique({
    where: { id: parsed.data },
    select: { id: true, issueId: true, userId: true, userEmail: true, ipHash: true },
  });
  if (!event) return { error: "Event not found" };
  await logAdminAction({
    adminId: admin.id,
    action: "REVEAL_MONITORING_IDENTITY",
    entityType: "MonitoringEvent",
    entityId: event.id,
    details: { issueId: event.issueId },
  });
  return {
    data: {
      userId: event.userId,
      userEmail: event.userEmail,
      ipHash: event.ipHash,
    },
  };
}

export async function retryMonitoringAlertDelivery(deliveryId: string) {
  const admin = await requireRole("ADMIN");
  const parsed = z.string().cuid().safeParse(deliveryId);
  if (!parsed.success) return { error: "Delivery not found" };
  const delivery = await db.monitoringAlertDelivery.findUnique({
    where: { id: parsed.data },
    select: { id: true, issueId: true, status: true },
  });
  if (!delivery) return { error: "Delivery not found" };
  await db.monitoringAlertDelivery.update({
    where: { id: delivery.id },
    data: {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
      claimedAt: null,
      claimExpiresAt: null,
      lastError: null,
    },
  });
  const { processMonitoringAlertOutbox } = await import("@/lib/monitoring/alert-outbox");
  const processed = await processMonitoringAlertOutbox({ deliveryId: delivery.id, limit: 1 });
  await logAdminAction({
    adminId: admin.id,
    action: "RETRY_MONITORING_ALERT",
    entityType: "MonitoringAlertDelivery",
    entityId: delivery.id,
    details: processed,
  });
  if (delivery.issueId) revalidatePath(`/admin/monitoring/${delivery.issueId}`);
  return { data: processed };
}

const generatePromptSchema = z.object({
  issueId: z.string().cuid(),
});

export async function generateMonitoringCursorPrompt(input: { issueId: string }) {
  const admin = await requireRole("ADMIN");
  const parsed = generatePromptSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const issue = await db.monitoringIssue.findUnique({
      where: { id: parsed.data.issueId },
    });
    if (!issue) return { error: "Issue not found" };

    const events = await db.monitoringEvent.findMany({
      where: { issueId: issue.id },
      orderBy: { occurredAt: "desc" },
      take: 20,
    });

    const prompt = buildCursorPrompt({ issue, events });

    await db.monitoringIssue.update({
      where: { id: issue.id },
      data: {
        lastGeneratedPrompt: prompt,
        lastPromptGeneratedAt: new Date(),
      },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "GENERATE_MONITORING_CURSOR_PROMPT",
      entityType: "MonitoringIssue",
      entityId: issue.id,
      details: { eventCount: events.length },
    });

    revalidatePath(`/admin/monitoring/${issue.id}`);
    return { data: { prompt } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "generateMonitoringCursorPrompt",
      route: `/admin/monitoring/${parsed.data.issueId}`,
      requestPath: `/admin/monitoring/${parsed.data.issueId}`,
      userId: admin.id,
      tags: { issueId: parsed.data.issueId },
    });
    const message =
      err instanceof Error ? err.message : "Failed to generate cursor prompt";
    return { error: message };
  }
}
