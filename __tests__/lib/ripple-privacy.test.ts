import { describe, expect, it } from "vitest";
import {
  assertRippleSafeMonitoringPayload,
  buildRippleSafeTags,
} from "@/lib/payments/ripple-privacy";

describe("RIP-PRIV-001 Ripple monitoring privacy", () => {
  it("strips emails, signatures, bodies, and secrets from tags", () => {
    expect(
      buildRippleSafeTags({
        eventType: "payment.received",
        email: "buyer@example.com",
        signature: "abc",
        webhook: "raw-body",
        merchant_reference: "v1:listing_payment:x:y:z",
        listingId: "listing-1",
      })
    ).toEqual({
      eventType: "payment.received",
      listingId: "listing-1",
    });
  });

  it("rejects leaked secrets or emails in monitoring payloads", () => {
    expect(() =>
      assertRippleSafeMonitoringPayload({
        RIPPLE_WEBHOOK_SECRET: "secret",
      })
    ).toThrow(/secret/);
    expect(() =>
      assertRippleSafeMonitoringPayload({
        customer: "buyer@example.com",
      })
    ).toThrow(/email/);
    expect(() =>
      assertRippleSafeMonitoringPayload({
        eventType: "payment.received",
      })
    ).not.toThrow();
  });
});
