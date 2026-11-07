import { z } from "zod";
import { redactFreeText } from "./redact";

const note = z.string().trim().min(8).max(1000).refine(value => redactFreeText(value) === value,
  "Investigation text must be sanitised and contain no credentials or personal identifiers");
const filePath = z.string().regex(/^(?:app|actions|components|lib|scripts|__tests__)\/[A-Za-z0-9_./()[\]-]+$/)
  .refine(value => !value.split("/").includes(".."));

export const investigationSchema = z.object({
  observedLastSeenAt: z.string().datetime({ offset: true }).optional(),
  observedOccurrences: z.number().int().positive().optional(),
  recordedAt: z.iso.datetime().optional(),
  outcome: z.enum(["collecting-evidence", "external-blocker", "pending-release", "expired"]),
  finding: note,
  evidence: z.array(note).min(1).max(12),
  missingEvidence: note,
  owner: z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{2,79}$/),
  nextAction: note,
  reviewAfter: z.iso.datetime(),
  collector: z.object({
    paths: z.array(filePath).min(1).max(15),
    tests: z.array(filePath.refine(value => /^__tests__\/.*\.test\.tsx?$/.test(value))).min(1).max(15),
    trigger: note,
    expectedEvidence: note,
    state: z.enum(["ready", "deployed"]),
    deploymentSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.outcome === "expired" && (value.collector.state !== "deployed" || !value.collector.deploymentSha)) {
    context.addIssue({ code: "custom", message: "Historical expiry requires a deployed collector" });
  }
});

export type Investigation = z.infer<typeof investigationSchema>;

export function readInvestigation(value: unknown): Investigation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed = investigationSchema.safeParse(Object.fromEntries(
    ["outcome", "finding", "evidence", "missingEvidence", "owner", "nextAction", "reviewAfter", "collector", "observedLastSeenAt", "observedOccurrences", "recordedAt"].map(key => [key, record[key]]),
  ));
  return parsed.success ? parsed.data : null;
}

export function investigationIsCurrent(value: unknown, lastSeenAt: string, savedLastSeenAt: string | undefined): boolean {
  return readInvestigation(value) !== null && savedLastSeenAt === lastSeenAt;
}
