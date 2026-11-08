import { z } from "zod";
import type { StockReviewSnapshot } from "./snapshot-loader";

const binding = z.object({ dealer: z.object({ id: z.string(), name: z.string() }) });
const evidence = z.object({
  fuel: z.string().nullable().optional(), transmission: z.string().nullable().optional(),
  displayTitle: z.string(), flags: z.array(z.string()), safePhotoUrls: z.array(z.string()),
  provenance: z.array(z.string()), sourceUrl: z.string().nullable(), capturedAt: z.string(),
  categorySlug: z.string().nullable(), pricePence: z.number().nullable(), mileage: z.number().nullable(), year: z.number().nullable(),
  availability: z.enum(["available", "reserved", "sold", "unknown"]),
  coverageWarning: z.string().nullable(), capacityWarning: z.string().nullable(),
});
const stockDraft = z.object({
  receiptId: z.string(), dealerId: z.string(), reportId: z.string(), listingId: z.string(),
  sourceIdentityKey: z.string(), revisionId: z.string().nullable(),
  state: z.enum(["dealer", "moderation", "admin"]), sentAt: z.iso.datetime(), recalledAt: z.iso.datetime().nullable(),
  blockers: z.array(z.string()), title: z.string(), lifecycleRevision: z.number().int().nonnegative(),
  photoRevision: z.number().int().nonnegative(), updatedAt: z.iso.datetime(), revisionVersion: z.number().int().nullable(),
});
const base = z.object({ displayTitle: z.string().optional(), sourceIdentityKey: z.string().nullable(), listingId: z.string().nullable(), review: evidence.optional(), stockDraft: stockDraft.optional() });
const changes = z.array(z.object({ field: z.enum(["price", "mileage"]), before: z.number().nullable(), after: z.number().nullable() }));
const action = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("create"), categorySlug: z.string(), pricePence: z.number(), attributes: z.record(z.string(), z.string()), changes }),
  base.extend({ kind: z.literal("update"), changes }),
  base.extend({ kind: z.literal("conflict"), reason: z.string(), changes }),
  base.extend({ kind: z.literal("blocked"), reason: z.string() }),
  base.extend({ kind: z.literal("missing_once"), absenceCount: z.number() }),
  base.extend({ kind: z.literal("unpublish"), absenceCount: z.number() }),
  base.extend({ kind: z.literal("unchanged") }),
]);
const applyRecovery = z.object({
  attempt: z.object({ id: z.string(), status: z.enum(["QUEUED", "LEASED", "SUCCEEDED", "FAILED", "CANCELLED"]) }).nullable(),
  activeJob: z.object({ id: z.string(), kind: z.enum(["APPLY", "SCRAPE"]), status: z.enum(["QUEUED", "LEASED"]) }).nullable(),
  retryable: z.boolean(), reason: z.string().nullable(),
});
const report = z.object({
  id: z.string(), dealerId: z.string(), bindingId: z.string(), scrapeRunId: z.string(), fingerprint: z.string(), status: z.string(),
  inventoryCount: z.number(), failureReason: z.string().nullable(), createdAt: z.iso.datetime(),
  plan: z.object({ actions: z.array(action), pendingReviewActions: z.array(action).optional() }), binding,
  applyRecovery: applyRecovery.nullable().optional(),
});
const job = z.object({
  id: z.string(), kind: z.string(), status: z.string(), error: z.string().nullable(),
  createdAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), reportId: z.string().nullable(),
  binding, report: z.object({ id: z.string(), status: z.string() }).nullable(),
});
const device = z.object({
  deviceId: z.string(), deviceName: z.string(), environment: z.enum(["preview", "production"]),
  instanceId: z.string().nullable(), state: z.string().nullable(), online: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  activity: z.array(z.object({ sequence: z.number(), code: z.string(), text: z.string(), at: z.iso.datetime() })),
  pendingCommand: z.object({ id: z.string(), instanceId: z.string(), action: z.enum(["start", "stop", "close"]) }).nullable(),
});
const snapshot = z.object({
  outstanding: z.array(report), recentReports: z.array(report), jobs: z.array(job),
  profiles: z.array(z.object({ id: z.string(), name: z.string(), tier: z.string(), isAdminPreview: z.boolean(), user: z.object({ disabledAt: z.iso.datetime().nullable() }) })),
  dashboard: z.union([z.object({ ok: z.literal(true), devices: z.array(device) }), z.object({ ok: z.literal(false), error: z.string() })]),
  historyEntries: z.array(z.object({ id: z.string(), kind: z.enum(["report", "job"]), state: z.enum(["active", "archived", "deleted"]), manageable: z.boolean() })),
  desktopEnabled: z.boolean(), now: z.number().finite(),
});

export function isStockReviewSnapshot(value: unknown): value is StockReviewSnapshot {
  return snapshot.safeParse(value).success;
}
