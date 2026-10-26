"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { canManageStockReport, RESULT_HISTORY_ACTIONS, resultHistoryState } from "@/lib/dealer-stock-sync/result-history";

const schema = z.object({
  id: z.string().min(1).max(160),
  kind: z.enum(["report", "job"]),
  action: z.enum(["archive", "delete", "restore"]),
});
const actions = { archive: "RESULT_ARCHIVED", delete: "RESULT_DELETED", restore: "RESULT_RESTORED" } as const;

export async function changeStockResultHistory(input: unknown) {
  const admin = await requireRole("ADMIN");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Invalid result." };
  const limited = await checkRateLimit(`stock-result-history:${admin.id}`, {
    windowMs: 60_000, maxRequests: 60, policy: "dealer-stock-sync",
  });
  if (!limited.allowed) return { error: "Too many requests. Try again shortly." };
  const { id, kind, action } = parsed.data;
  try {
    const outcome = await db.$transaction(async tx => {
      // Serialize history changes with approval/worker updates to the same result.
      if (kind === "report") {
        await tx.$queryRaw`SELECT id FROM "DealerStockSyncReport" WHERE id = ${id} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "DealerStockSyncJob" WHERE id = ${id} FOR UPDATE`;
      }
      const row = kind === "report"
        ? await tx.dealerStockSyncReport.findUnique({ where: { id }, select: { status: true, plan: true, scrapeRunId: true } })
        : await tx.dealerStockSyncJob.findUnique({ where: { id }, select: { status: true } });
      if (!row) return { error: "Result not found." };
      const manageable = kind === "report"
        ? canManageStockReport(row.status, "plan" in row ? row.plan : null)
        : ["SUCCEEDED", "FAILED", "CANCELLED"].includes(row.status);
      if (!manageable) return { error: "Active work and reviews awaiting a decision cannot be archived or deleted." };
      if (kind === "report") {
        const activeJob = await tx.dealerStockSyncJob.findFirst({
          where: { status: { in: ["QUEUED", "LEASED"] }, OR: [{ reportId: id }, { id: "scrapeRunId" in row ? row.scrapeRunId : "" }] },
          select: { id: true },
        });
        if (activeJob) return { error: "This result still has active work." };
      }
      const where = kind === "report" ? { reportId: id } : { jobId: id };
      const previous = await tx.dealerStockSyncAudit.findFirst({
        where: { ...where, action: { in: [...RESULT_HISTORY_ACTIONS] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { action: true },
      });
      const before = resultHistoryState(row.status, previous?.action ?? null, "plan" in row ? row.plan : null);
      const after = resultHistoryState(row.status, actions[action]);
      await tx.dealerStockSyncAudit.create({
        data: { ...where, actorId: admin.id, createdAt: new Date(), action: actions[action], before: { state: before }, after: { state: after } },
      });
      return { success: true as const };
    });
    if ("success" in outcome) revalidatePath("/admin/stock-reviews");
    return outcome;
  } catch {
    return { error: "Could not update this result. Please try again." };
  }
}
