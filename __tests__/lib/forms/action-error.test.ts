import { describe, expect, it } from "vitest";
import { flattenZodFieldErrors, publicAuthErrorMessage, splitActionError, uniqueErrorMessages } from "@/lib/forms/action-error";
import { summarizeListingSubmitFieldErrors } from "@/app/(public)/sell/create-listing-submit";
import { joinWaitlistSchema } from "@/lib/validations/waitlist";
import { z } from "zod";

describe("splitActionError FE-05", () => {
  it("keeps string action errors at form level", () => {
    expect(splitActionError("Too many submissions. Please try again shortly.")).toEqual({
      formError: "Too many submissions. Please try again shortly.",
      fieldErrors: {},
    });
  });

  it("maps Zod field error objects onto the matching keys", () => {
    expect(
      splitActionError({
        email: ["Enter your email address."],
        marketingConsent: ["Tick this box to confirm you want launch updates. You cannot join the waiting list without it."],
      }),
    ).toEqual({
      formError: null,
      fieldErrors: {
        email: ["Enter your email address."],
        marketingConsent: [
          "Tick this box to confirm you want launch updates. You cannot join the waiting list without it.",
        ],
      },
    });
  });

  it("flattens Zod issues onto the correct fields", () => {
    const parsed = joinWaitlistSchema.safeParse({
      email: "driver@example.com",
      interests: [],
      marketingConsent: false,
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const fieldErrors = flattenZodFieldErrors(parsed.error);
    expect(fieldErrors.email).toBeUndefined();
    expect(fieldErrors.interests?.[0]).toMatch(/buying, selling, or dealer/i);
    expect(fieldErrors.marketingConsent?.[0]).toMatch(/tick this box/i);
  });
});

describe("uniqueErrorMessages", () => {
  it("lists form and field reasons without duplicates", () => {
    expect(
      uniqueErrorMessages(
        { email: ["Enter your email address."], name: ["Enter your email address."] },
        "Enter your email address.",
      ),
    ).toEqual(["Enter your email address."]);
  });
});

describe("flattenZodFieldErrors", () => {
  it("uses Zod flatten field keys", () => {
    const schema = z.object({
      name: z.string().min(2, "Enter your name."),
    });
    const parsed = schema.safeParse({ name: "A" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(flattenZodFieldErrors(parsed.error)).toEqual({
      name: ["Enter your name."],
    });
  });
});

describe("summarizeFieldErrors FE-10", () => {
  it("keeps listing submit summarisation after extraction", () => {
    expect(
      summarizeListingSubmitFieldErrors(
        {
          listingId: [],
          privateSellerTermsAccepted: ["Private seller terms acceptance is required."],
        },
        "Fallback",
      ),
    ).toBe("Private seller terms acceptance is required.");
    expect(summarizeListingSubmitFieldErrors({}, "Fallback")).toBe("Fallback");
  });
});

describe("publicAuthErrorMessage", () => {
  it("maps provider credential failures to a reason and fix", () => {
    expect(publicAuthErrorMessage("Invalid login credentials", "Fallback")).toBe(
      "Check your email and password and try again.",
    );
  });

  it("hides unknown provider text behind a safe fallback", () => {
    expect(publicAuthErrorMessage("AuthApiError: 500 at https://example.supabase.co", "Safe fallback.")).toBe(
      "Safe fallback.",
    );
  });

  it("keeps already-actionable app copy", () => {
    expect(
      publicAuthErrorMessage(
        "An account with this email already exists. Please sign in instead.",
        "Fallback",
      ),
    ).toBe("An account with this email already exists. Please sign in instead.");
  });
});

