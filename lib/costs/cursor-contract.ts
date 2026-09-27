import { z } from "zod";
import { CURSOR_LEDGER_CONTRACT_VERSION, ITRADER_PROJECT_ID } from "@/lib/costs/cursor-policy";

const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const timestamp = z.string().datetime();

export const cursorIngestEventSchema = z.object({
  timestamp: timestamp,
  model: z.string().trim().min(1).max(120),
  kind: z.string().trim().min(1).max(80).optional(),
  conversationId: z.string().trim().min(1).max(80).nullable().optional(),
  isTokenBasedCall: z.boolean().nullable().optional(),
  chargedCents: z.union([z.number(), z.string()]).nullable().optional(),
  usageBasedCosts: z.string().max(40).nullable().optional(),
  cursorTokenFee: z.union([z.number(), z.string()]).nullable().optional(),
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative().nullable().optional(),
      outputTokens: z.number().int().nonnegative().nullable().optional(),
      cacheReadTokens: z.number().int().nonnegative().nullable().optional(),
      cacheWriteTokens: z.number().int().nonnegative().nullable().optional(),
      totalCents: z.union([z.number(), z.string()]).nullable().optional(),
    })
    .nullable()
    .optional(),
  attribution: z.object({
    projectId: z.literal(ITRADER_PROJECT_ID),
    status: z.literal("assigned"),
  }),
});

export const cursorIngestSchema = z.object({
  contractVersion: z.literal(CURSOR_LEDGER_CONTRACT_VERSION),
  projectId: z.literal(ITRADER_PROJECT_ID),
  providerAccountRef: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  sourceQuality: z.enum(["complete", "partial", "unknown"]),
  events: z.array(cursorIngestEventSchema).max(200),
  allowance: z
    .object({
      observedAt: timestamp,
      quality: z.enum(["complete", "partial", "unavailable"]),
      cycleStart: timestamp.optional(),
      cycleEnd: timestamp.optional(),
      poolLabel: z.string().trim().max(80).optional(),
      reportedAllowanceUsd: decimal.optional(),
      remainingUsd: decimal.optional(),
      accountNominalUsd: decimal,
      accountOnDemandUsd: decimal,
    })
    .optional(),
});

export type CursorIngestBody = z.infer<typeof cursorIngestSchema>;

export const CURSOR_INGEST_BODY_LIMIT = 256_000;
