import { z } from "zod";

const decimalAmount = z
  .string()
  .trim()
  .regex(/^-?\d+(?:\.\d{1,8})?$/, "Enter a decimal amount with up to 8 places.")
  .refine((value) => !/^-?0+(?:\.0+)?$/.test(value), {
    message: "Amount must be non-zero.",
  })
  .refine((value) => {
    const [whole, fraction = ""] = value.replace("-", "").split(".");
    return whole.length <= 12 && fraction.length <= 8;
  }, "Amount exceeds the stored decimal precision.");

export const recordManualCostSchema = z
  .object({
    category: z.enum(["CURSOR", "OTHER"]),
    externalRef: z.string().trim().min(3).max(120),
    nativeAmount: decimalAmount,
    nativeCurrency: z.enum(["USD", "GBP"]),
    displayLabel: z.string().trim().min(2).max(120),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
  })
  .refine((value) => Date.parse(value.periodEnd) > Date.parse(value.periodStart), {
    message: "Period end must be after period start.",
    path: ["periodEnd"],
  });

export const costSyncRequestSchema = z.object({
  deploymentUrl: z.string().trim().min(1).max(500).optional(),
  eventId: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().trim().min(1).max(120).optional(),
  target: z.enum(["production", "preview", "development"]).optional(),
  trigger: z.enum(["DEPLOYMENT", "CRON", "MANUAL"]).optional(),
}).refine((value) => Boolean(value.deploymentUrl), {
  message: "A deployment URL is required.",
  path: ["deploymentUrl"],
});
export type RecordManualCostInput = z.infer<typeof recordManualCostSchema>;

export const confirmInvoiceRequestSchema = z.object({
  requestId: z.string().cuid(),
});
export type ConfirmInvoiceRequestInput = z.infer<typeof confirmInvoiceRequestSchema>;

export const retryCostEmailSchema = z.object({
  outboxId: z.string().cuid(),
});
export type RetryCostEmailInput = z.infer<typeof retryCostEmailSchema>;
