import { transportPublicMessage } from "@/lib/forms/transport-public-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancellationError } from "@/lib/policy/cancellation";
import { ListingLifecycleError } from "@/lib/listings/errors";
import {
  JOURNEY_UNKNOWN_DESTRUCTIVE,
  journeyUnknownResult,
} from "@/lib/forms/journey-public-error";
import { cancellationPublicMessage } from "@/lib/forms/known-domain-messages";
import { lifecyclePublicMessage } from "@/lib/listings/lifecycle-public-error";
import { rateLimitRecoveryMessage } from "@/lib/rate-limit-result";
import { publicAuthErrorMessage } from "@/lib/forms/action-error";

const captureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/monitoring", () => ({
  captureException,
}));

describe("journey public errors", () => {
  beforeEach(() => {
    captureException.mockReset();
    captureException.mockResolvedValue({ eventId: "evt_safe_1" });
  });

  it("keeps an allowlisted lifecycle reason and hides a database exception", () => {
    expect(lifecyclePublicMessage(new ListingLifecycleError("Only expired taken-down listings can be renewed."))).toBe(
      "Only expired taken-down listings can be renewed.",
    );
    expect(lifecyclePublicMessage(new ListingLifecycleError("Invalid transition: RENEW from LIVE"))).toBe(
      "This listing isn't available for that action.",
    );
    expect(lifecyclePublicMessage(new Error("PrismaClientKnownRequestError: P2002 unique constraint"))).toBeNull();
  });

  it("keeps a cancellation reason and drops provider text", () => {
    expect(cancellationPublicMessage(new CancellationError("Cancellation request changed. Refresh and try again."))).toBe(
      "Cancellation request changed. Refresh and try again.",
    );
    expect(cancellationPublicMessage(new CancellationError("Cannot move a REQUESTED request to COMPLETED."))).toBe(
      "Cannot move a REQUESTED request to COMPLETED.",
    );
    expect(cancellationPublicMessage(new CancellationError("ripple secret https://pay.example/tok_live"))).toBeNull();
  });

  it("does not invite a repeat when the write outcome is unknown", async () => {
    captureException.mockRejectedValueOnce(new Error("monitoring down"));
    const body = await journeyUnknownResult({
      error: new Error("duplicate key value violates unique constraint token=sekret"),
      journey: "dealer-admin",
      action: "adminRefundPayment",
      route: "/admin/payments",
      kind: "destructive",
    });
    expect(body.error).toBe(JOURNEY_UNKNOWN_DESTRUCTIVE);
    expect(body.error).not.toMatch(/sekret|duplicate key|token/i);
    expect(body.retryable).toBe(false);
    expect(body.code).toBe("unknown");
    expect(body.supportReference).toBeUndefined();
  });

  it("records unknown fallback frequency without replacing the safe message", async () => {
    const body = await journeyUnknownResult({
      error: new Error("provider timeout"),
      journey: "enquiries",
      action: "contactSeller",
      route: "/listings/listing_1",
      kind: "write",
      message: "We couldn't confirm that this message was sent. Check before sending it again.",
    });
    expect(body.error).toContain("evt_safe_1");
    expect(body.retryable).toBe(false);
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({
      tags: expect.objectContaining({
        publicErrorCode: "unknown",
        journey: "enquiries",
        operationKind: "write",
      }),
    }));
  });

  it("treats a lost connection as ambiguity and a reliable 429 as a wait", () => {
    expect(transportPublicMessage(new TypeError("Failed to fetch https://secret.example"), false)).toBe(
      "Your browser reports that you are offline. We couldn't tell whether that finished. Check the result before trying again.",
    );
    expect(transportPublicMessage(new Error("validation"))).toBeNull();
    expect(rateLimitRecoveryMessage(
      { allowed: false, remaining: 0, resetAt: 30_000, unavailable: false },
      "Too many listing status changes. Please wait a few minutes and try again.",
      0,
    )).toBe("Too many listing status changes. Wait 30 seconds, then try again.");
    expect(rateLimitRecoveryMessage(
      { allowed: false, remaining: 0, resetAt: Number.NaN, unavailable: true },
      "Too many listing status changes. Please wait a few minutes and try again.",
    )).toBe("Service temporarily unavailable. Please try again shortly.");
  });

  it("does not enumerate accounts on sign-in and keeps signup disclosure explicit", () => {
    expect(publicAuthErrorMessage("User already registered", "Try signing in again.")).toBe(
      "Try signing in again.",
    );
    expect(publicAuthErrorMessage("User already registered", "Fallback", { discloseExistingAccount: true })).toBe(
      "An account with this email already exists. Please sign in instead.",
    );
    expect(publicAuthErrorMessage("Email link is invalid or has expired", "Fallback")).toBe(
      "This link has expired. Request a new one.",
    );
    expect(publicAuthErrorMessage("AuthApiError at https://db.example/secret", "Safe fallback.")).toBe(
      "Safe fallback.",
    );
  });
});
