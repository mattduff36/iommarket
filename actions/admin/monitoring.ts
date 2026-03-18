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
});

export async function setMonitoringIssueStatus(input: {
  issueId: string;
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  mutedHours?: number;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = setIssueStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { issueId, status, mutedHours } = parsed.data;
  const now = new Date();

  try {
    const issue = await db.monitoringIssue.update({
      where: { id: issueId },
      data: {
        status,
        mutedUntil:
          status === "MUTED" ? new Date(now.getTime() + (mutedHours ?? 24) * 60 * 60 * 1000) : null,
        resolvedAt: status === "RESOLVED" ? now : null,
        assigneeAdminId: admin.id,
      },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "SET_MONITORING_ISSUE_STATUS",
      entityType: "MonitoringIssue",
      entityId: issueId,
      details: { status, mutedHours: mutedHours ?? null },
    });

    revalidatePath("/admin/monitoring");
    revalidatePath(`/admin/monitoring/${issueId}`);
    return { data: issue };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setMonitoringIssueStatus",
      route: `/admin/monitoring/${issueId}`,
      requestPath: `/admin/monitoring/${issueId}`,
      userId: admin.id,
      tags: { issueId, status },
    });
    const message =
      err instanceof Error ? err.message : "Failed to update monitoring issue";
    return { error: message };
  }
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
