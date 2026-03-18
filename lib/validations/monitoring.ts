import { z } from "zod";

export const monitoringSourceSchema = z.enum([
  "SERVER",
  "CLIENT",
  "WEBHOOK",
  "BUSINESS",
]);

export const monitoringSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

const boundedRecordSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 50) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Too many keys",
      });
    }
  });

export const ingestMonitoringClientEventSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(20000).optional(),
  severity: monitoringSeveritySchema.optional(),
  route: z.string().max(500).optional(),
  component: z.string().max(200).optional(),
  requestId: z.string().max(200).optional(),
  tags: boundedRecordSchema.optional(),
  extra: boundedRecordSchema.optional(),
});

export type IngestMonitoringClientEventInput = z.infer<
  typeof ingestMonitoringClientEventSchema
>;
