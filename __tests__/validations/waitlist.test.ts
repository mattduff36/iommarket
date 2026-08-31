import { describe, expect, it } from "vitest";
import { flattenZodFieldErrors } from "@/lib/forms/action-error";
import { EMAIL_INVALID_MESSAGE, EMAIL_REQUIRED_MESSAGE } from "@/lib/validations/email";
import {
  WAITLIST_CONSENT_MESSAGE,
  WAITLIST_INTERESTS_MESSAGE,
  joinWaitlistSchema,
} from "@/lib/validations/waitlist";

describe("joinWaitlistSchema", () => {
  it("accepts valid input", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: ["BUYING_CARS", "DEALER"],
      marketingConsent: true,
    });

    expect(result.success).toBe(true);
  });

  it("FE-01 accepts Isle of Man and Gmail addresses", () => {
    for (const email of ["itrader@ac.tmail.im", "user@gmail.com"]) {
      const result = joinWaitlistSchema.safeParse({
        email,
        interests: ["BUYING_CARS"],
        marketingConsent: true,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid email", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "invalid-email",
      interests: ["BUYING_CARS"],
      marketingConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(flattenZodFieldErrors(result.error).email?.[0]).toBe(EMAIL_INVALID_MESSAGE);
    }
  });

  it("rejects empty interests", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: [],
      marketingConsent: true,
    });

    expect(result.success).toBe(false);
  });

  it("POL-MKT-001 rejects waitlist joins without explicit marketing consent", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: ["BUYING_CARS"],
      marketingConsent: false,
    });

    expect(result.success).toBe(false);
  });

  it("FE-02 reports only consent when email and interests are valid", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "itrader@ac.tmail.im",
      interests: ["BUYING_CARS", "SELLING_CARS"],
      marketingConsent: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = flattenZodFieldErrors(result.error);
      expect(fieldErrors.email).toBeUndefined();
      expect(fieldErrors.interests).toBeUndefined();
      expect(fieldErrors.marketingConsent).toEqual([WAITLIST_CONSENT_MESSAGE]);
    }
  });

  it("FE-03 reports only interests when email and consent are valid", () => {
    const result = joinWaitlistSchema.safeParse({
      email: "user@gmail.com",
      interests: [],
      marketingConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = flattenZodFieldErrors(result.error);
      expect(fieldErrors.email).toBeUndefined();
      expect(fieldErrors.marketingConsent).toBeUndefined();
      expect(fieldErrors.interests).toEqual([WAITLIST_INTERESTS_MESSAGE]);
    }
  });

  it("FE-04 keeps empty and invalid email messages distinct from consent", () => {
    const empty = joinWaitlistSchema.safeParse({
      email: "",
      interests: ["BUYING_CARS"],
      marketingConsent: true,
    });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      const fieldErrors = flattenZodFieldErrors(empty.error);
      expect(fieldErrors.email).toEqual([EMAIL_REQUIRED_MESSAGE]);
      expect(fieldErrors.marketingConsent).toBeUndefined();
    }

    const invalid = joinWaitlistSchema.safeParse({
      email: "not-an-email",
      interests: ["BUYING_CARS"],
      marketingConsent: false,
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      const fieldErrors = flattenZodFieldErrors(invalid.error);
      expect(fieldErrors.email).toEqual([EMAIL_INVALID_MESSAGE]);
      expect(fieldErrors.marketingConsent).toEqual([WAITLIST_CONSENT_MESSAGE]);
      expect(fieldErrors.email?.[0]).not.toEqual(fieldErrors.marketingConsent?.[0]);
    }
  });
});
