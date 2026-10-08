import { describe, expect, it } from "vitest";
import { splitActionError } from "@/lib/forms/action-error";
import {
  publicErrorBody,
  publicFieldErrorBody,
  withMonitoringReference,
} from "@/lib/forms/public-error";
import { rateLimitPublicError } from "@/lib/rate-limit-result";
import { classifyUploadError } from "@/lib/media/upload-error-catalog";

describe("public error contract", () => {
  it("keeps a string and a field map readable by splitActionError", () => {
    expect(splitActionError("Too many submissions. Please try again shortly.")).toEqual({
      formError: "Too many submissions. Please try again shortly.",
      fieldErrors: {},
    });
    expect(splitActionError({ email: ["Enter your email address."] })).toEqual({
      formError: null,
      fieldErrors: { email: ["Enter your email address."] },
    });
  });

  it("does not tell the user to check details for an unknown public error", () => {
    const body = publicErrorBody({
      message: "We couldn't complete that request. Try again shortly.",
      code: "unknown",
    });
    expect(splitActionError(body).formError).toBe("We couldn't complete that request. Try again shortly.");
    expect(splitActionError(body).formError).not.toMatch(/check your details/i);
  });

  it("drops a raw url from an unknown public payload", () => {
    expect(splitActionError({ error: "https://provider.example/secret", code: "unknown" }).formError).toBe(
      "We couldn't confirm that this request finished. Check the result before trying again.",
    );
  });

  it("does not treat the syntax guard as an allowlist and does not mark unknown writes retryable", () => {
    const body = publicErrorBody({ message: "Internal queue shard 9 missed its lease.", code: "unknown" });
    expect(body.error).toBe("Internal queue shard 9 missed its lease.");
    expect(body.retryable).toBe(false);
  });

  it("preserves field errors on the additive body", () => {
    const body = publicFieldErrorBody({ title: ["Enter a title."] });
    expect(body.error).toEqual({ title: ["Enter a title."] });
    expect(splitActionError(body)).toEqual({
      formError: null,
      fieldErrors: { title: ["Enter a title."] },
    });
  });

  it("keeps the original message when monitoring capture fails", async () => {
    const body = publicErrorBody({ message: "We couldn't verify this photo right now. Try again shortly.", code: "unknown" });
    await expect(withMonitoringReference(body, async () => {
      throw new Error("database unavailable");
    })).resolves.toEqual(body);
    await expect(withMonitoringReference(body, async () => null)).resolves.toEqual(body);
    const referenced = await withMonitoringReference(body, async () => ({ eventId: "evt_safe_1234" }));
    expect(referenced.supportReference).toBe("evt_safe_1234");
    expect(referenced.error).toContain("evt_safe_1234");
    expect(referenced.error).not.toContain("database");
  });

  it("adds retry timing without changing the legacy string helper", () => {
    const body = rateLimitPublicError(
      { allowed: false, remaining: 0, resetAt: 30_000, unavailable: false },
      "Too many upload attempts. Try again shortly.",
      0,
    );
    expect(body).toMatchObject({
      error: "Too many upload attempts. Try again shortly.",
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 30,
    });
  });

  it("replaces an unknown provider failure without calling the file invalid", () => {
    const classified = classifyUploadError(new Error("https://ik.imagekit.io/private?token=secret"));
    expect(classified.body.error).toBe("Photo verification is temporarily unavailable. Try again shortly.");
    expect(String(classified.body.error)).not.toContain("secret");
    expect(String(classified.body.error).toLowerCase()).not.toContain("invalid");
  });
});
