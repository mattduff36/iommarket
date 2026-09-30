import { createHash } from "node:crypto";
import { z } from "zod";
import type { PackAuditAction, PlannedListing } from "./types";

export const LIVE_VISUAL_VERSION = 1 as const;
export const LIVE_VISUAL_KIND = "live-visual" as const;

export const LIVE_LISTING_STATUSES = [
  "pass",
  "mismatch",
  "placeholder",
  "empty",
  "drift",
  "inaccessible",
  "unverified",
] as const;

export type LiveListingStatus = (typeof LIVE_LISTING_STATUSES)[number];

export const liveListingStatusSchema = z.enum(LIVE_LISTING_STATUSES);

export interface LiveDealerSite {
  dealerKey: string;
  website: string | null;
  stockUrls: string[];
}

export interface LivePlannedIdentity {
  identityKey: string;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  stockId: string | null;
  title: string;
  pricePence: number | null;
}

export interface LiveObservedIdentity {
  href: string;
  canonicalUrl: string | null;
  stockId: string | null;
  title: string;
  titleReliable: boolean;
  priceText: string | null;
  pricePence: number | null;
  imageSrc: string | null;
}

export interface LiveMatchEvidence {
  url: boolean;
  stockId: boolean;
  title: boolean;
  price: boolean;
  stockIdConflict: boolean;
  titleConflict: boolean;
  priceConflict: boolean;
  assignedBy: "url" | "stock-id" | "title-price" | null;
}

export interface LiveImageSignal {
  url: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  qualityError: string | null;
  placeholder: boolean;
  reasons: string[];
}

export interface LiveListingEvidencePaths {
  stockCard: string | null;
  detail: string | null;
  images: string[];
}

export interface LiveVisualListingResult {
  identityKey: string;
  status: LiveListingStatus;
  hidePack: boolean;
  planned: LivePlannedIdentity;
  observed: LiveObservedIdentity | null;
  match: LiveMatchEvidence;
  heroSrc: string | null;
  gallerySrcs: string[];
  imageSignals: LiveImageSignal[];
  findings: string[];
  evidencePaths: LiveListingEvidencePaths;
}

export interface LiveCensusCardDelta {
  added: string[];
  removed: string[];
  unchanged: number;
}

export interface LiveDealerCensus {
  dealerKey: string;
  t0Accessible: boolean;
  t0PageUrl: string | null;
  t0CardCount: number;
  t1Attempted: number;
  t1AccessibleCount: number;
  t1InaccessibleCount: number;
  t1ListAccessible: boolean;
  t1ListPageUrl: string | null;
  t1ListCardCount: number;
  plannedCount: number;
  matchedCount: number;
  extraObservedCount: number;
  cardDeltas: LiveCensusCardDelta;
  drift: boolean;
  evidencePaths: {
    t0: string | null;
    t1: string[];
    t1List: string | null;
  };
}

export interface LiveVisualDealerResult {
  dealerKey: string;
  displayName: string;
  actionKind: PackAuditAction["kind"];
  hidePack: boolean;
  hideReason: string | null;
  census: LiveDealerCensus;
  listings: LiveVisualListingResult[];
  evidenceDir: string;
}

export interface LiveVisualReport {
  version: typeof LIVE_VISUAL_VERSION;
  kind: typeof LIVE_VISUAL_KIND;
  runId: string;
  planFingerprint: string;
  fingerprint: string;
  createdAt: string;
  ok: boolean;
  hidePackCount: number;
  dealers: LiveVisualDealerResult[];
}

export const livePlannedIdentitySchema = z.object({
  identityKey: z.string().min(1),
  sourceUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  stockId: z.string().nullable(),
  title: z.string(),
  pricePence: z.number().nullable(),
});

export const liveObservedIdentitySchema = z.object({
  href: z.string(),
  canonicalUrl: z.string().nullable(),
  stockId: z.string().nullable(),
  title: z.string(),
  titleReliable: z.boolean(),
  priceText: z.string().nullable(),
  pricePence: z.number().nullable(),
  imageSrc: z.string().nullable(),
});

export const liveMatchEvidenceSchema = z.object({
  url: z.boolean(),
  stockId: z.boolean(),
  title: z.boolean(),
  price: z.boolean(),
  stockIdConflict: z.boolean(),
  titleConflict: z.boolean(),
  priceConflict: z.boolean(),
  assignedBy: z.enum(["url", "stock-id", "title-price"]).nullable(),
});

export const liveImageSignalSchema = z.object({
  url: z.string(),
  checksum: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  format: z.string().nullable(),
  bytes: z.number().nullable(),
  qualityError: z.string().nullable(),
  placeholder: z.boolean(),
  reasons: z.array(z.string()),
});

export const liveListingEvidencePathsSchema = z.object({
  stockCard: z.string().nullable(),
  detail: z.string().nullable(),
  images: z.array(z.string()),
});

export const liveVisualListingResultSchema = z.object({
  identityKey: z.string().min(1),
  status: liveListingStatusSchema,
  hidePack: z.boolean(),
  planned: livePlannedIdentitySchema,
  observed: liveObservedIdentitySchema.nullable(),
  match: liveMatchEvidenceSchema,
  heroSrc: z.string().nullable(),
  gallerySrcs: z.array(z.string()),
  imageSignals: z.array(liveImageSignalSchema),
  findings: z.array(z.string()),
  evidencePaths: liveListingEvidencePathsSchema,
});

export const liveCensusCardDeltaSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  unchanged: z.number().int().min(0),
});

export const liveDealerCensusSchema = z.object({
  dealerKey: z.string().min(1),
  t0Accessible: z.boolean(),
  t0PageUrl: z.string().nullable(),
  t0CardCount: z.number().int().min(0),
  t1Attempted: z.number().int().min(0),
  t1AccessibleCount: z.number().int().min(0),
  t1InaccessibleCount: z.number().int().min(0),
  t1ListAccessible: z.boolean(),
  t1ListPageUrl: z.string().nullable(),
  t1ListCardCount: z.number().int().min(0),
  plannedCount: z.number().int().min(0),
  matchedCount: z.number().int().min(0),
  extraObservedCount: z.number().int().min(0),
  cardDeltas: liveCensusCardDeltaSchema,
  drift: z.boolean(),
  evidencePaths: z.object({
    t0: z.string().nullable(),
    t1: z.array(z.string()),
    t1List: z.string().nullable(),
  }),
});

export const liveVisualDealerResultSchema = z.object({
  dealerKey: z.string().min(1),
  displayName: z.string().min(1),
  actionKind: z.enum(["replace", "disable"]),
  hidePack: z.boolean(),
  hideReason: z.string().nullable(),
  census: liveDealerCensusSchema,
  listings: z.array(liveVisualListingResultSchema),
  evidenceDir: z.string().min(1),
});

export const liveVisualReportSchema = z.object({
  version: z.literal(LIVE_VISUAL_VERSION),
  kind: z.literal(LIVE_VISUAL_KIND),
  runId: z.string().min(1),
  planFingerprint: z.string().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().min(1),
  ok: z.boolean(),
  hidePackCount: z.number().int().min(0),
  dealers: z.array(liveVisualDealerResultSchema),
});

export function liveVisualReportFingerprint(
  report: Omit<LiveVisualReport, "fingerprint"> | LiveVisualReport,
) {
  const { fingerprint: _fingerprint, ...unsigned } =
    report as LiveVisualReport;
  return createHash("sha256")
    .update(JSON.stringify(unsigned))
    .digest("hex");
}

export function parseLiveVisualReport(value: unknown): LiveVisualReport {
  const report = liveVisualReportSchema.parse(value);
  if (liveVisualReportFingerprint(report) !== report.fingerprint) {
    throw new Error("Live visual report fingerprint mismatch.");
  }
  return report;
}

export type LivePlannedListing = PlannedListing;
