import { validateListingImageBounds } from "@/lib/images/constraints";
import {
  publicErrorBody,
  withMonitoringReference,
  type PublicErrorBody,
  type PublicErrorCode,
} from "@/lib/forms/public-error";

export const PHOTO_UNKNOWN_MESSAGE =
  "We couldn't verify this photo right now. Try again shortly.";
export const PHOTO_UNAVAILABLE_MESSAGE =
  "Photo verification is temporarily unavailable. Try again shortly.";
export const PHOTO_NETWORK_MESSAGE =
  "We couldn't upload this photo because the connection failed. Check your connection and try again.";
export const PHOTO_CONVERSION_MESSAGE =
  "Image conversion is still processing. Retry verification shortly.";
export const PHOTO_PREPARING_MESSAGE =
  "This photo is still being prepared. Wait briefly, then try again.";
export const PHOTO_EXPIRED_MESSAGE =
  "This upload has expired. Select the photo again.";
export const PHOTO_IDENTITY_MESSAGE =
  "This photo couldn't be matched to your upload. Select the photo again.";
export const PHOTO_DETAILS_MESSAGE =
  "We couldn't prepare this photo for saving. Try again shortly.";
export const PHOTO_FORMAT_MESSAGE = "Choose a JPG, PNG, or WebP photo.";
export const PHOTO_DISABLED_MESSAGE =
  "Photo upload isn't available right now. Try again later.";
export const PHOTO_HEIF_PROCESS_MESSAGE =
  "We couldn't process this HEIC/HEIF photo. Try again, or choose a JPG or PNG.";
export const PHOTO_START_MESSAGE = "Could not start the image upload.";
export const UPLOAD_SIGN_IN_MESSAGE =
  "Sign in again to continue this photo upload.";
export const UPLOAD_PERMISSION_MESSAGE =
  "You don't have permission to upload listing photos.";
export const UPLOAD_POLICY_MESSAGE =
  "Accept the required account policy before uploading listing photos.";
export const UPLOAD_AUTH_CHECK_MESSAGE =
  "We couldn't verify this upload right now. Try again shortly.";

interface UploadMessageRule {
  /** Exact internal or legacy source string. */
  message: string;
  /** Approved sentence shown to the user. */
  publicMessage: string;
  code: PublicErrorCode;
  status: number;
  capture: boolean;
  retryable?: boolean;
}

function listed(
  message: string,
  code: PublicErrorCode,
  status: number,
  capture: boolean,
  publicMessage = message,
  retryable?: boolean,
): UploadMessageRule {
  return { message, publicMessage, code, status, capture, retryable };
}

const STATIC_RULES: UploadMessageRule[] = [
  listed("The uploaded file size does not match this request.", "validation", 400, false, "This photo doesn't match the upload you started. Select the photo again."),
  listed("The uploaded file contents changed.", "conflict", 400, false, "This photo changed before it could be checked. Select the photo again."),
  listed("The file contents do not match the stated format.", "validation", 400, false, "This file isn't the photo type it claims to be. Choose a JPG, PNG, WebP, HEIC, or HEIF photo."),
  listed("The uploaded image is invalid, unsupported, or outside the allowed dimensions.", "validation", 400, false, "This photo couldn't be read or it's outside the allowed size. Choose a different photo."),
  listed("Processed image dimensions do not agree with the uploaded original.", "validation", 400, false, "This photo's size couldn't be confirmed. Select the photo again."),
  listed("Uploaded image metadata could not be stripped.", "unavailable", 503, true, PHOTO_DETAILS_MESSAGE),
  listed("The uploaded file is not a HEIC/HEIF image.", "validation", 400, false, "This photo isn't a HEIC or HEIF image. Choose a JPG, PNG, WebP, HEIC, or HEIF photo."),
  listed("ImageKit uploads must be JPG, PNG, or WebP.", "validation", 400, false, PHOTO_FORMAT_MESSAGE),
  listed("This upload expired. Please try again.", "expired", 400, false, PHOTO_EXPIRED_MESSAGE, false),
  listed("This upload expired. Please upload the image again.", "expired", 400, false, PHOTO_EXPIRED_MESSAGE, false),
  listed(PHOTO_EXPIRED_MESSAGE, "expired", 400, false, PHOTO_EXPIRED_MESSAGE, false),
  listed("This upload expired or belongs to a different file.", "expired", 400, false, "This upload has expired or does not match the photo. Select the photo again.", false),
  listed(PHOTO_CONVERSION_MESSAGE, "processing", 503, false, PHOTO_PREPARING_MESSAGE),
  listed("Upload not found.", "not_found", 400, false, "This upload could not be found. Select the photo again."),
  listed("This upload can no longer be verified.", "conflict", 400, false, "This photo can no longer be checked. Select the photo again."),
  listed("This upload was already verified with a different file.", "conflict", 400, false, "This upload was already used for a different photo. Select the photo again."),
  listed("The uploaded file does not match this request.", "conflict", 400, false, "This photo doesn't match the upload you started. Select the photo again."),
  listed("The uploaded file path is invalid.", "validation", 400, false, "This photo couldn't be matched to your upload. Select the photo again."),
  listed("This upload must be verified by the ImageKit uploader.", "validation", 400, false, "Select the photo again so it can be checked before it is saved."),
  listed("This Cloudinary upload can no longer be used. Please upload the image again.", "expired", 400, false, PHOTO_EXPIRED_MESSAGE, false),
  listed("Only private listing images can be saved.", "forbidden", 403, false, "Only private listing photos can be saved."),
  listed("Images must be JPG, PNG, WebP, HEIC, or HEIF.", "validation", 400, false),
  listed("Images must be non-empty and 10MB or smaller.", "validation", 400, false),
  listed("The image filename and type do not agree.", "validation", 400, false, "The photo name and file type don't agree. Choose a JPG, PNG, WebP, HEIC, or HEIF photo."),
  listed("Upload is no longer available. Retry verification.", "conflict", 400, false, "This photo is no longer available to check. Select the photo again."),
  listed("Upload state changed before verification completed.", "conflict", 400, false, "This photo changed before the check finished. Select the photo again."),
  listed("Upload identity is invalid.", "validation", 400, false, PHOTO_IDENTITY_MESSAGE),
  listed("Upload intent identity changed.", "conflict", 400, false, PHOTO_IDENTITY_MESSAGE),
  listed(PHOTO_START_MESSAGE, "unknown", 500, true),
  listed("The private image upload failed. Start a new upload to retry.", "unavailable", 503, true, "The photo was not saved. Select it again to retry."),
  listed("The secure upload configuration is invalid.", "unavailable", 503, true, PHOTO_DISABLED_MESSAGE),
  listed("The secure upload fields are invalid.", "unavailable", 503, true, PHOTO_DISABLED_MESSAGE),
  listed(PHOTO_UNKNOWN_MESSAGE, "unknown", 500, true),
  listed(PHOTO_UNAVAILABLE_MESSAGE, "unavailable", 503, true),
  listed(PHOTO_NETWORK_MESSAGE, "unavailable", 503, false),
  listed(PHOTO_HEIF_PROCESS_MESSAGE, "unavailable", 503, true),
  listed("Invalid request origin.", "forbidden", 403, false, "This photo upload couldn't be accepted from this page. Refresh the page and select the photo again."),
  listed("Invalid request origin", "forbidden", 403, false, "This photo upload couldn't be accepted from this page. Refresh the page and select the photo again."),
  listed("Not authorized.", "unauthorized", 401, false, UPLOAD_SIGN_IN_MESSAGE),
  listed("Not authorized", "unauthorized", 401, false, UPLOAD_SIGN_IN_MESSAGE),
  listed(UPLOAD_SIGN_IN_MESSAGE, "unauthorized", 401, false),
  listed(UPLOAD_PERMISSION_MESSAGE, "forbidden", 403, false),
  listed(UPLOAD_POLICY_MESSAGE, "forbidden", 403, false),
  listed(UPLOAD_AUTH_CHECK_MESSAGE, "unavailable", 500, true),
  listed("Invalid upload request.", "validation", 400, false, "The photo details weren't valid. Select the photo again."),
  listed("Invalid upload metadata.", "validation", 400, false, "The photo details weren't valid. Select the photo again."),
  listed("Invalid upload data", "validation", 400, false, "The photo details weren't valid. Select the photo again."),
  listed("Upload request is invalid.", "validation", 400, false, "The photo details weren't valid. Select the photo again."),
  listed("Too many upload attempts. Try again shortly.", "rate_limited", 429, false),
  listed("Too many upload verification attempts.", "rate_limited", 429, false),
  listed("Managed ImageKit uploads are disabled.", "unavailable", 404, false, PHOTO_DISABLED_MESSAGE),
  listed("ImageKit development uploads are disabled.", "unavailable", 404, false, PHOTO_DISABLED_MESSAGE),
  listed("Admin accounts cannot create or manage their own listings.", "forbidden", 403, false),
  listed("Service temporarily unavailable. Please try again shortly.", "unavailable", 503, false),
  listed("MP4 is not a listing image format.", "validation", 400, false, "This file isn't a listing photo. Choose a JPG, PNG, WebP, HEIC, or HEIF photo."),
  listed("Image metadata is required to start this upload.", "validation", 400, false, "Choose a photo before starting the upload."),
  listed("ImageKit uploads are not enabled for this environment. No Cloudinary upload was issued.", "unavailable", 404, false, PHOTO_DISABLED_MESSAGE),
];

function boundsMessages(): string[] {
  return [
    validateListingImageBounds({ width: 1, height: 1, bytes: 1 }),
    validateListingImageBounds({ width: 1, height: 1, bytes: 0 }),
    validateListingImageBounds({ width: 0, height: 1, bytes: 1 }),
    validateListingImageBounds({ width: 1, height: 1, bytes: 10 * 1024 * 1024 + 1 }),
    validateListingImageBounds({ width: 100_000, height: 100_000, bytes: 1 }),
  ].filter((message): message is string => message !== null);
}

let sourceRules: Map<string, UploadMessageRule> | null = null;
let publicRules: Map<string, UploadMessageRule> | null = null;

function loadRules(): { source: Map<string, UploadMessageRule>; approved: Map<string, UploadMessageRule> } {
  if (sourceRules && publicRules) return { source: sourceRules, approved: publicRules };
  const source = new Map<string, UploadMessageRule>();
  const approved = new Map<string, UploadMessageRule>();
  for (const rule of STATIC_RULES) {
    source.set(rule.message, rule);
    if (!approved.has(rule.publicMessage)) approved.set(rule.publicMessage, rule);
  }
  for (const message of boundsMessages()) {
    const rule = listed(message, "validation", 400, false);
    source.set(message, rule);
    approved.set(message, rule);
  }
  sourceRules = source;
  publicRules = approved;
  return { source, approved };
}

const REFERENCE_SUFFIX =
  / If it continues, contact support with reference ([A-Za-z0-9_-]{8,80})\.$/;

function ruleFor(message: string): UploadMessageRule | undefined {
  const { source, approved } = loadRules();
  return source.get(message) ?? approved.get(message);
}

export function isExactUploadMessage(message: string): boolean {
  const { source, approved } = loadRules();
  return source.has(message) || approved.has(message);
}

export function uploadMessageCode(message: string): PublicErrorCode | null {
  const direct = ruleFor(message);
  if (direct) return direct.code;
  const match = REFERENCE_SUFFIX.exec(message);
  if (!match || match.index === undefined) return null;
  return ruleFor(message.slice(0, match.index))?.code ?? null;
}

/** Approved public copy for an exact source string, including one support-reference suffix. */
export function acceptedUploadMessage(message: string): string | null {
  const direct = ruleFor(message);
  if (direct) return direct.publicMessage;
  const match = REFERENCE_SUFFIX.exec(message);
  if (!match || match.index === undefined) return null;
  const base = ruleFor(message.slice(0, match.index));
  return base ? `${base.publicMessage}${message.slice(match.index)}` : null;
}

export interface ClassifiedUploadError {
  status: number;
  capture: boolean;
  body: PublicErrorBody;
}

function hiddenFailure(raw: string): { message: string; code: PublicErrorCode; status: number } {
  if (raw === "Could not verify the uploaded image.") {
    return { message: PHOTO_UNAVAILABLE_MESSAGE, code: "unavailable", status: 503 };
  }
  if (raw.startsWith("HEIC/HEIF uploads are explicitly unsupported")) {
    return { message: PHOTO_HEIF_PROCESS_MESSAGE, code: "unavailable", status: 503 };
  }
  if (raw === "Unexpected image conversion.") {
    return { message: PHOTO_UNAVAILABLE_MESSAGE, code: "unavailable", status: 503 };
  }
  if (/upload identity/i.test(raw)) {
    return { message: PHOTO_IDENTITY_MESSAGE, code: "validation", status: 400 };
  }
  if (/metadata could not be stripped/i.test(raw)) {
    return { message: PHOTO_DETAILS_MESSAGE, code: "unavailable", status: 503 };
  }
  if (/this upload expired/i.test(raw) || /upload has expired/i.test(raw)) {
    return { message: PHOTO_EXPIRED_MESSAGE, code: "expired", status: 400 };
  }
  if (
    /imagekit|cloudinary/i.test(raw) ||
    raw.startsWith("Managed file path") ||
    /https?:\/\//i.test(raw) ||
    raw.includes("token=")
  ) {
    return { message: PHOTO_UNAVAILABLE_MESSAGE, code: "unavailable", status: 503 };
  }
  return { message: PHOTO_UNKNOWN_MESSAGE, code: "unknown", status: 500 };
}

export function classifyUploadError(error: unknown): ClassifiedUploadError {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const known = ruleFor(raw);
  if (known) {
    return {
      status: known.status,
      capture: known.capture,
      body: publicErrorBody({
        message: known.publicMessage,
        code: known.code,
        ...(known.retryable === undefined ? {} : { retryable: known.retryable }),
      }),
    };
  }
  const hidden = hiddenFailure(raw);
  return {
    status: hidden.status,
    capture: true,
    body: publicErrorBody({
      message: hidden.message,
      code: hidden.code,
      ...(hidden.code === "expired" ? { retryable: false } : {}),
    }),
  };
}

export async function respondToUploadError(
  error: unknown,
  capture: () => Promise<{ eventId?: string | null } | null>,
): Promise<ClassifiedUploadError> {
  const classified = classifyUploadError(error);
  if (!classified.capture) return classified;
  return { ...classified, body: await withMonitoringReference(classified.body, capture) };
}
