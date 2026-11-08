import { z } from "zod";
import { isSoldStockReviewAction } from "@/lib/dealer-stock-sync/review";
import type { PlanAction } from "@/lib/dealer-stock-sync/types";

// Validate the fields read by the summary and sold-row helper, not apply payloads.
const summaryAction = z.object({
  kind: z.enum(["create", "update", "blocked", "conflict", "missing_once", "unpublish", "unchanged"]),
  sourceIdentityKey: z.string().nullable().optional(),
  listingId: z.string().nullable().optional(),
  reason: z.string().optional(),
  review: z.object({
    availability: z.enum(["available", "reserved", "sold", "unknown"]),
    flags: z.array(z.string()),
  }).optional(),
  stockDraft: z.object({
    state: z.enum(["dealer", "moderation", "admin"]),
    listingId: z.string().min(1),
    sourceIdentityKey: z.string().min(1),
  }).optional(),
}).refine(action => !["blocked", "conflict"].includes(action.kind) || Boolean(action.reason));

function hasSummaryEvidence(action: unknown): action is PlanAction {
  return summaryAction.safeParse(action).success;
}

const summaryPlan = z.object({
  actions: z.array(z.custom<PlanAction>(hasSummaryEvidence)),
  pendingReviewActions: z.array(z.custom<PlanAction>(hasSummaryEvidence)).optional(),
});

/** Distinct visible review listings; null means the saved evidence is unknown. */
export function stockReviewListingCount(plan: unknown): number | null {
  const parsed = summaryPlan.safeParse(plan);
  if (!parsed.success) return null;
  const actions = [...parsed.data.actions, ...(parsed.data.pendingReviewActions ?? [])]
    .filter(action => !isSoldStockReviewAction(action) && (action.kind !== "unchanged" || action.stockDraft));
  const groups = actions.reduce<string[][]>((current, action, index) => {
    const keys = [
      action.listingId?.trim() ? `listing:${action.listingId.trim()}` : null,
      action.sourceIdentityKey?.trim() ? `source:${action.sourceIdentityKey.trim()}` : null,
      action.stockDraft ? `listing:${action.stockDraft.listingId.trim()}` : null,
      action.stockDraft ? `source:${action.stockDraft.sourceIdentityKey.trim()}` : null,
    ].filter((key): key is string => key !== null);
    if (!keys.length) return [...current, [`unidentified:${index}`]];
    const matching = current.filter(group => group.some(key => keys.includes(key)));
    return [...current.filter(group => !matching.includes(group)), [...new Set([...keys, ...matching.flat()])]];
  }, []);
  return groups.length;
}
