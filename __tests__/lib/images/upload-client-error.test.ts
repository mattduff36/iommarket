import { describe, expect, it } from "vitest";
import { uploadErrorFromPayload } from "@/lib/images/upload-client-error";
import {
  PHOTO_EXPIRED_MESSAGE,
  PHOTO_IDENTITY_MESSAGE,
  PHOTO_PREPARING_MESSAGE,
  PHOTO_UNKNOWN_MESSAGE,
  classifyUploadError,
} from "@/lib/media/upload-error-catalog";

describe("upload payload retryable flag", () => {
  it("keeps an explicit false on an accepted message", () => {
    const error = uploadErrorFromPayload({
      error: "This upload expired. Please try again.",
      code: "expired",
      retryable: false,
    }, PHOTO_UNKNOWN_MESSAGE);
    expect(error.message).toBe(PHOTO_EXPIRED_MESSAGE);
    expect(error.code).toBe("expired");
    expect(error.retryable).toBe(false);
  });

  it("ignores a non-boolean retryable flag and an untrusted payload", () => {
    const invalidFlag = uploadErrorFromPayload({
      error: PHOTO_EXPIRED_MESSAGE,
      code: "expired",
      retryable: "false",
    }, PHOTO_UNKNOWN_MESSAGE);
    expect(invalidFlag.retryable).toBe(true);
    const untrusted = uploadErrorFromPayload({
      error: "https://provider.example/secret",
      code: "validation",
      retryable: true,
    }, PHOTO_UNKNOWN_MESSAGE);
    expect(untrusted.message).toBe(PHOTO_UNKNOWN_MESSAGE);
    expect(untrusted.retryable).toBe(false);
    expect(untrusted.message).not.toContain("secret");
  });
});

describe("upload catalogue public copy", () => {
  it("maps internal source strings to the approved sentence", () => {
    expect(classifyUploadError(new Error("Upload identity is invalid.")).body).toMatchObject({
      error: PHOTO_IDENTITY_MESSAGE,
      code: "validation",
      retryable: false,
    });
    expect(classifyUploadError(new Error("Uploaded image metadata could not be stripped.")).body.error).toBe(
      "We couldn't prepare this photo for saving. Try again shortly.",
    );
    expect(classifyUploadError(new Error("ImageKit download failed (500)")).body.error).toBe(
      "Photo verification is temporarily unavailable. Try again shortly.",
    );
    expect(classifyUploadError("Image conversion is still processing. Retry verification shortly.").body).toMatchObject({
      error: PHOTO_PREPARING_MESSAGE,
      code: "processing",
      retryable: true,
    });
    expect(classifyUploadError(new Error("Images must be at least 800×480px.")).body.error).toBe(
      "Images must be at least 800×480px.",
    );
  });
});
