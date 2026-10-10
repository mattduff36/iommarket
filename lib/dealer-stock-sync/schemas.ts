import { z } from "zod";
import { getDealerStockRegistryOption } from "./registry-catalog";

const idSchema = z.string().trim().min(1).max(64);

export const saveStockBindingSchema = z.object({
  dealerId: idSchema,
  registryKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/)
    .refine((key) => getDealerStockRegistryOption(key) != null, "Choose a verified registry source."),
});

export const setStockBindingEnabledSchema = z.object({
  dealerId: idSchema,
  enabled: z.boolean(),
});

export const enqueueDealerScrapeSchema = z.object({
  dealerId: idSchema,
});

export const approveStockReportSchema = z.object({
  reportId: idSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const rejectStockReportSchema = z.object({
  reportId: idSchema,
});
