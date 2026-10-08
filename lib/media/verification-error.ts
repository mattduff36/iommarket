import { IMAGE_CONSTRAINTS, validateListingImageBounds } from "@/lib/images/constraints";

const GENERIC_IMAGE_VERIFICATION_ERROR = "The image could not be verified. Check its format and size, then try again.";

function boundsMessages() {
  return [
    validateListingImageBounds({ width: 1, height: 1, bytes: 1 }),
    validateListingImageBounds({ width: 1, height: 1, bytes: 0 }),
    validateListingImageBounds({ width: 0, height: 1, bytes: 1 }),
    validateListingImageBounds({ width: 1, height: 1, bytes: IMAGE_CONSTRAINTS.maxFileSizeBytes + 1 }),
    validateListingImageBounds({ width: 100_000, height: 100_000, bytes: 1 }),
  ].filter((message): message is string => message !== null);
}

/** Exact server-authored messages. Provider paths, URLs and tokens must stay generic. */
const SAFE_IMAGE_VERIFICATION_MESSAGES = new Set([
  ...boundsMessages(),
  "The uploaded file size does not match this request.",
  "The uploaded file contents changed.",
  "The file contents do not match the stated format.",
  "The uploaded image is invalid, unsupported, or outside the allowed dimensions.",
  "Processed image dimensions do not agree with the uploaded original.",
  "Uploaded image metadata could not be stripped.",
  "The uploaded file is not a HEIC/HEIF image.",
  "ImageKit uploads must be JPG, PNG, or WebP.",
  "This upload expired. Please try again.",
]);

export function isSafeImageVerificationMessage(message: string) {
  return SAFE_IMAGE_VERIFICATION_MESSAGES.has(message);
}

export function publicImageVerificationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return isSafeImageVerificationMessage(message) ? message : GENERIC_IMAGE_VERIFICATION_ERROR;
}
