import { Prisma } from "@prisma/client";
export {
  NEEDS_MANUAL_REVIEW_BADGE,
  NO_IMAGE_REVIEW_PLACEHOLDER,
} from "./review-labels";


export const PREVIEW_PACK_REVIEW_FIELD_NAMES = [
  "reviewRequired",
  "reviewState",
  "reviewReasons",
  "reviewSourceRunId",
] as const;

export const LISTING_PREVIEW_REVIEW_FIELD_NAMES = [
  "previewReviewRequired",
  "previewReviewReasons",
  "previewSourceIdentityKey",
  "previewSourceUrl",
  "reviewState",
  "reviewReasons",
  "reviewSourceIdentity",
  "reviewSourceUrl",
] as const;

const NO_IMAGE_REVIEW_REASON_MARKERS = [
  "listing-has-no-valid-source-image",
  "no-valid-source-image",
  "no-source-image",
  "empty-image",
  "empty-image-listing",
  "placeholder-image",
  "placeholder-url",
  "no-image",
] as const;

export interface PreviewPackReview {
  required: boolean;
  reasons: string[];
  sourceRunId: string | null;
}

export interface ListingPreviewReview {
  required: boolean;
  reasons: string[];
  sourceIdentityKey: string | null;
  sourceUrl: string | null;
}

export interface ListingPreviewCardProps {
  needsManualReview: boolean;
  noImageReview: boolean;
}

export function prismaModelFieldNames(modelName: string) {
  const model = Prisma.dmmf.datamodel.models.find((item) => item.name === modelName);
  return new Set(model?.fields.map((field) => field.name) ?? []);
}

export function forthcomingModelSelect(
  modelName: string,
  fieldNames: readonly string[],
): Record<string, true> {
  const present = prismaModelFieldNames(modelName);
  return Object.fromEntries(
    fieldNames.filter((name) => present.has(name)).map((name) => [name, true]),
  );
}

export function previewPackVisibilitySelect(): { enabled: true } {
  return {
    enabled: true,
    ...forthcomingModelSelect("DealerPreviewPack", PREVIEW_PACK_REVIEW_FIELD_NAMES),
  } as { enabled: true };
}

export function listingPreviewReviewSelect(): Record<string, true> {
  return forthcomingModelSelect("Listing", LISTING_PREVIEW_REVIEW_FIELD_NAMES);
}

export function emptyPreviewPackReview(): PreviewPackReview {
  return { required: false, reasons: [], sourceRunId: null };
}

export function emptyListingPreviewReview(): ListingPreviewReview {
  return {
    required: false,
    reasons: [],
    sourceIdentityKey: null,
    sourceUrl: null,
  };
}

export function readPreviewPackReview(pack: unknown): PreviewPackReview {
  const row = asRecord(pack);
  if (!row) return emptyPreviewPackReview();
  return {
    required: readReviewRequired(row, ["reviewRequired"]),
    reasons: readStringArray(row.reviewReasons),
    sourceRunId: readTrimmedString(row.reviewSourceRunId),
  };
}

export function readListingPreviewReview(listing: unknown): ListingPreviewReview {
  const row = asRecord(listing);
  if (!row) return emptyListingPreviewReview();
  return {
    required: readReviewRequired(row, ["previewReviewRequired", "reviewRequired"]),
    reasons: readStringArray(firstDefined(row.previewReviewReasons, row.reviewReasons)),
    sourceIdentityKey: readTrimmedString(
      firstDefined(row.previewSourceIdentityKey, row.reviewSourceIdentity),
    ),
    sourceUrl: readTrimmedString(firstDefined(row.previewSourceUrl, row.reviewSourceUrl)),
  };
}

export function listingPreviewCardProps(
  listing: unknown,
  hasPhoto: boolean,
): ListingPreviewCardProps {
  const review = readListingPreviewReview(listing);
  return {
    needsManualReview: review.required,
    noImageReview: shouldShowNoImageReviewPlaceholder(review, hasPhoto),
  };
}

export function isNoImageReviewReason(reason: string) {
  const normalized = reason.trim().toLowerCase();
  return NO_IMAGE_REVIEW_REASON_MARKERS.some((marker) => normalized.includes(marker));
}

export function shouldShowNoImageReviewPlaceholder(
  review: Pick<ListingPreviewReview, "required" | "reasons">,
  hasPhoto: boolean,
) {
  return review.required && !hasPhoto;
}

export function formatPreviewReviewReason(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}

export function uniquePreviewReviewReasons(reasons: readonly string[]) {
  return [...new Set(reasons.map((reason) => reason.trim()).filter(Boolean))];
}

export function previewSourceHref(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined);
}

function readReviewRequired(row: Record<string, unknown>, booleanKeys: readonly string[]) {
  if (booleanKeys.some((key) => row[key] === true)) return true;
  return row.reviewState === "NEEDS_REVIEW";
}

function readTrimmedString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniquePreviewReviewReasons(
    value.filter((item): item is string => typeof item === "string"),
  );
}
