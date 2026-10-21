import { isIP } from "node:net";
import { z } from "zod";
import { assertSafeRemoteImageUrl, isPublicIpAddress } from "@/lib/images/safe-remote-image";
import { listingDetailsSchema } from "@/lib/validations/listing";
import type { CreatePlanAction, DealerStockCategorySlug, PlanAction, ReviewedActionEvidence } from "./types";

const VEHICLE_CATEGORIES = ["car", "van", "motorbike", "motorhome"] as const;
const CORRECTABLE_BLOCK_REASONS = new Set([
  "review-flag",
  "source-conflict",
  "unmatched-archive",
  "ambiguous-archive",
  "missing-required-attr",
  "invalid-price",
  "invalid-title",
  "poa",
  "missing-price",
  "images-not-owned",
  "not-importable",
  "title-conflict",
  "availability-held",
]);

const idSchema = z.string().trim().min(1).max(64);
const attributeKey = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);

export const stockReviewLoadSchema = z.object({
  reportId: idSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceIdentityKey: z.string().trim().min(1).max(220),
}).strict();

export function assertCorrectionPhotoUrl(raw: string) {
  const parsed = assertSafeRemoteImageUrl(raw);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || (isIP(host) !== 0 && !isPublicIpAddress(host))) {
    throw new Error("Photo URL must be a public HTTPS address.");
  }
  return parsed.href;
}

function photoMessage(value: string) {
  try {
    assertCorrectionPhotoUrl(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Photo URL must be a public HTTPS address.";
  }
}

export const stockReviewCorrectionSchema = listingDetailsSchema
  .pick({ title: true, description: true, price: true })
  .extend({
    reportId: idSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceIdentityKey: z.string().trim().min(1).max(220),
    categorySlug: z.enum(VEHICLE_CATEGORIES),
    attributes: z.record(attributeKey, z.string().trim().min(1).max(500)),
    photoUrls: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
    reason: z.string().trim().min(10).max(1000),
    confirmAvailable: z.literal(true),
  })
  .strict()
  .superRefine((input, context) => {
    if (Object.keys(input.attributes).length > 40) {
      context.addIssue({ code: "custom", path: ["attributes"], message: "Too many vehicle details." });
    }
    const seen = new Set<string>();
    input.photoUrls.forEach((url, index) => {
      const message = photoMessage(url);
      if (message) context.addIssue({ code: "custom", path: ["photoUrls", index], message });
      const href = message ? url : assertCorrectionPhotoUrl(url);
      if (seen.has(href)) context.addIssue({ code: "custom", path: ["photoUrls", index], message: "Photo URLs must be unique." });
      seen.add(href);
    });
  })
  .transform((input) => ({ ...input, photoUrls: input.photoUrls.map((url) => assertCorrectionPhotoUrl(url)) }));

export type StockReviewCorrectionInput = z.infer<typeof stockReviewCorrectionSchema>;

export interface StockReviewDraft {
  title: string;
  description: string;
  pricePence: number | null;
  categorySlug: DealerStockCategorySlug | "";
  attributes: Record<string, string>;
  photoUrls: string[];
  sourceUrl: string | null;
  warning: string | null;
  flags: string[];
}

function soldReview(action: PlanAction) {
  if (action.kind === "blocked" && ["sold-exclude-from-live-import", "sold-preserved", "source-sold"].includes(action.reason)) {
    return true;
  }
  return action.review?.availability === "sold" || Boolean(action.review?.flags.includes("sold-exclude-from-live-import"));
}

export function canEditStockReviewAction(action: PlanAction) {
  if (!action.sourceIdentityKey?.trim() || action.listingId || soldReview(action)) return false;
  if (action.kind === "create") return true;
  return action.kind === "blocked" && action.section === "new" && CORRECTABLE_BLOCK_REASONS.has(action.reason);
}

function categorySlugOf(value: string | null | undefined): DealerStockCategorySlug | "" {
  return value && VEHICLE_CATEGORIES.includes(value as DealerStockCategorySlug) ? value as DealerStockCategorySlug : "";
}

function wholeAttribute(value: number | null | undefined) {
  return value != null && Number.isInteger(value) && value >= 0 ? String(value) : null;
}

function blockedAttributes(review: ReviewedActionEvidence | undefined) {
  const attributes: Record<string, string> = {};
  const year = wholeAttribute(review?.year);
  const mileage = wholeAttribute(review?.mileage);
  if (year) attributes.year = year;
  if (mileage) attributes.mileage = mileage;
  if (review?.fuel) attributes["fuel-type"] = review.fuel;
  if (review?.transmission) attributes.transmission = review.transmission;
  return attributes;
}

export function stockReviewDraft(action: PlanAction): StockReviewDraft | null {
  if (!canEditStockReviewAction(action)) return null;
  if (action.kind === "create") {
    return {
      title: action.title,
      description: action.description,
      pricePence: action.pricePence,
      categorySlug: action.categorySlug,
      attributes: { ...action.attributes },
      photoUrls: [...(action.sourceImageUrls?.length ? action.sourceImageUrls : action.review?.safePhotoUrls ?? [])],
      sourceUrl: action.sourceUrl ?? action.review?.sourceUrl ?? null,
      warning: action.review?.flags.length ? action.review.flags.join(", ") : null,
      flags: [...(action.review?.flags ?? [])],
    };
  }
  const review = action.review;
  return {
    title: review?.displayTitle ?? action.displayTitle ?? "",
    description: "",
    pricePence: review?.pricePence ?? null,
    categorySlug: categorySlugOf(review?.categorySlug),
    attributes: blockedAttributes(review),
    photoUrls: [...(review?.safePhotoUrls ?? [])],
    sourceUrl: review?.sourceUrl ?? null,
    warning: action.kind === "blocked" ? action.reason : null,
    flags: [...(review?.flags ?? [])],
  };
}

function wholeNumber(value: string | undefined) {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function correctedReview(action: PlanAction, input: StockReviewCorrectionInput): ReviewedActionEvidence {
  const previous = action.review;
  const provenance = [...(previous?.provenance ?? []).filter((item) => item !== "admin-corrected"), "admin-corrected"];
  return {
    displayTitle: input.title,
    fuel: input.attributes["fuel-type"] ?? null,
    transmission: input.attributes.transmission ?? null,
    flags: [],
    pricePence: input.price,
    mileage: wholeNumber(input.attributes.mileage),
    year: wholeNumber(input.attributes.year),
    categorySlug: input.categorySlug,
    sourceUrl: (action.kind === "create" ? action.sourceUrl : null) ?? previous?.sourceUrl ?? null,
    safePhotoUrls: input.photoUrls,
    availability: "available",
    provenance,
    sourceHash: previous?.sourceHash ?? "not-recorded",
    capturedAt: previous?.capturedAt ?? "not-recorded",
    coverageWarning: previous?.coverageWarning ?? null,
    capacityWarning: previous?.capacityWarning ?? null,
  };
}

export function buildCorrectedCreateAction(action: PlanAction, input: StockReviewCorrectionInput): CreatePlanAction {
  const sourceIdentityKey = action.sourceIdentityKey ?? input.sourceIdentityKey;
  const review = correctedReview(action, input);
  return {
    kind: "create",
    sourceIdentityKey,
    listingId: null,
    title: input.title,
    description: input.description,
    pricePence: input.price,
    categorySlug: input.categorySlug,
    attributes: { ...input.attributes },
    ownedImages: [],
    sourceImageUrls: [...input.photoUrls],
    sourceUrl: review.sourceUrl,
    changes: [{ field: "price", before: null, after: input.price }],
    displayTitle: input.title,
    review,
  };
}

export function correctStockReviewActions(
  actions: PlanAction[],
  input: StockReviewCorrectionInput,
): { ok: false; error: string } | { ok: true; corrected: CreatePlanAction; actions: PlanAction[] } {
  const matches = actions.filter((action) => action.sourceIdentityKey === input.sourceIdentityKey);
  if (matches.length !== 1) return { ok: false, error: "This website vehicle is not a single stable record." };
  const original = matches[0];
  if (!original || !canEditStockReviewAction(original)) {
    return { ok: false, error: "This vehicle cannot be corrected in the stock review." };
  }
  const corrected = buildCorrectedCreateAction(original, input);
  return {
    ok: true,
    corrected,
    actions: actions.map((action) => (action.sourceIdentityKey === input.sourceIdentityKey ? corrected : action)),
  };
}

export function readPlanActions(plan: unknown): PlanAction[] | null {
  if (!plan || typeof plan !== "object" || !("actions" in plan)) return null;
  const actions = (plan as { actions?: unknown }).actions;
  return Array.isArray(actions) ? (actions as PlanAction[]) : null;
}

export function planAfterCorrection(plan: unknown, actions: PlanAction[]): Record<string, unknown> & { actions: PlanAction[] } {
  const base = plan && typeof plan === "object" && !Array.isArray(plan) ? { ...(plan as Record<string, unknown>) } : {};
  const source = base.reviewSource;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const rest = { ...(source as Record<string, unknown>) };
    delete rest.counts;
    base.reviewSource = rest;
  }
  return { ...base, actions };
}
