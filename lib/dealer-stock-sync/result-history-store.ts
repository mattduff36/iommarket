import { db } from "@/lib/db";
import { canManageStockReport, RESULT_HISTORY_ACTIONS, resultHistoryState, type ResultHistoryEntry } from "./result-history";

export async function loadResultHistory(
  reports: Array<{ id: string; status: string; plan: unknown; scrapeRunId: string }>,
  jobs: Array<{ id: string; status: string; reportId: string | null; report?: {status:string} | null }>,
): Promise<ResultHistoryEntry[]> {
  const events = await db.dealerStockSyncAudit.findMany({
    where: {
      action: { in: [...RESULT_HISTORY_ACTIONS] },
      OR: [{ reportId: { in: reports.map(row => row.id) } }, { jobId: { in: jobs.map(row => row.id) } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    distinct: ["reportId", "jobId"],
    select: { reportId: true, jobId: true, action: true },
  });
  const latest = new Map(events.map(event => [event.reportId ?? event.jobId, event.action]));
  return [
    ...reports.map(row => {
      const activeJob = jobs.some(job => ["QUEUED", "LEASED"].includes(job.status) && (job.reportId === row.id || job.id === row.scrapeRunId));
      const manageable = !activeJob && canManageStockReport(row.status, row.plan);
      return { id: row.id, kind: "report" as const, manageable,
        state: manageable ? resultHistoryState(row.status, latest.get(row.id) ?? null, row.plan) : "active" as const };
    }),
    ...jobs.map(row => {
      const manageable = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(row.status);
      const status = row.status === "SUCCEEDED" && row.report?.status === "APPLIED" ? "APPLIED" : row.status;
      return { id: row.id, kind: "job" as const, manageable,
        state: manageable ? resultHistoryState(status, latest.get(row.id) ?? null) : "active" as const };
    }),
  ];
}
