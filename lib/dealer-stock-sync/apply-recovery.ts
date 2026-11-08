import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const base = z.object({ reportId: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export const recoverySchema = z.discriminatedUnion("operation", [
  base.extend({ operation: z.literal("retry"), expectedJobId: id }).strict(),
  base.extend({ operation: z.literal("fresh") }).strict(),
]);
export type StockRecoveryInput = z.infer<typeof recoverySchema>;
export interface RecoveryReport { id: string; status: string; dealerId: string; bindingId: string; fingerprint: string }
export interface ApplyAttempt {
  id: string; kind: string; status: string; reportId: string | null; dealerId: string; bindingId: string; payload: unknown;
}
export interface ActiveStockJob { id: string; kind: string; status: string }
export interface StockApplyRecovery {
  attempt: { id: string; status: string } | null;
  activeJob: ActiveStockJob | null;
  retryable: boolean;
  reason: string | null;
}
export function matchesApprovedAttempt(report: RecoveryReport, attempt: ApplyAttempt) {
  const payload = z.object({ reportId: z.string(), fingerprint: z.string() }).safeParse(attempt.payload);
  return attempt.kind === "APPLY" && attempt.reportId === report.id && attempt.bindingId === report.bindingId &&
    attempt.dealerId === report.dealerId && payload.success && payload.data.reportId === report.id && payload.data.fingerprint === report.fingerprint;
}
export function applyRecoveryState(report: RecoveryReport, attempt: ApplyAttempt | null, activeJob: ActiveStockJob | null): StockApplyRecovery {
  const retryable = report.status === "APPROVED" && !activeJob && Boolean(attempt &&
    ["FAILED", "CANCELLED"].includes(attempt.status) && matchesApprovedAttempt(report, attempt));
  return {
    attempt: attempt ? { id: attempt.id, status: attempt.status } : null, activeJob, retryable,
    reason: activeJob ? "Wait for this dealer's current stock task to finish." : retryable ? null : "Run a fresh check: this saved approval has no matching failed or cancelled apply attempt.",
  };
}
export function stockApplyOutcome(recovery: StockApplyRecovery | null | undefined) {
  if (recovery?.activeJob) {
    const name = recovery.activeJob.kind === "APPLY" ? "Apply" : "Check";
    return `${name} ${recovery.activeJob.status === "LEASED" ? "processing" : "queued"}`;
  }
  if (recovery?.attempt?.status === "FAILED") return "Apply failed";
  if (recovery?.attempt?.status === "CANCELLED") return "Apply cancelled";
  return null;
}
