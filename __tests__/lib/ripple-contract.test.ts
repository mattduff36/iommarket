import { beforeEach, describe, expect, it } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import {
  parsePoundsToPence,
  parseRippleWebhookEnvelope,
} from "@/lib/payments/ripple-contract";
import { createRippleReference } from "@/lib/payments/ripple-reference";
import { installRippleTestEnv, rippleEnvelope } from "./ripple-test-env";

describe("RIP-CONTRACT-001 Ripple webhook contract", () => {
  beforeEach(() => {
    installRippleTestEnv();
  });

  it("parses every verified event and decimal-pound amounts", () => {
    const listing = parseRippleWebhookEnvelope(rippleEnvelope());
    expect(listing.event.type).toBe("payment.received");
    expect(listing.event.amount).toBe(499);
    expect(listing.event.providerPaymentId).toBe("260821000161456468");

    const renewal = parseRippleWebhookEnvelope(
      rippleEnvelope({
        event: "payment.success",
        data: {
          amount: 49.0,
          package: "Dealer Pro",
          payment_reference: "260900000000000000",
          link_code: undefined,
        },
      })
    );
    expect(renewal.event.type).toBe("payment.succeeded");
    expect(renewal.event.amount).toBe(4900);
    expect(renewal.event.packageName).toBe("Dealer Pro");

    for (const eventName of [
      "payment.failed",
      "subscription.created",
      "subscription.cancelled",
      "subscription.paused",
      "subscription.resumed",
    ] as const) {
      const parsed = parseRippleWebhookEnvelope(
        rippleEnvelope({
          event: eventName,
          data: { package: "Dealer Pro", amount: 49 },
        })
      );
      expect(parsed.event.rawType).toBe(eventName);
    }
  });

  it("treats numeric 5 as five pounds", () => {
    expect(parsePoundsToPence(5)).toBe(500);
    expect(parsePoundsToPence("4.99")).toBe(499);
    expect(parsePoundsToPence(0.01)).toBe(1);
    expect(parsePoundsToPence("4.99 trailing")).toBeNull();
    expect(parsePoundsToPence("4.999")).toBeNull();
    expect(parsePoundsToPence(4.999)).toBeNull();
  });

  it("rejects a mismatched client id", () => {
    expect(() =>
      parseRippleWebhookEnvelope({
        ...rippleEnvelope(),
        client_id: "someone-else",
      })
    ).toThrow("Ripple client_id mismatch");
  });

  it("rejects missing data and legacy envelope shapes RIP-STRICT-001", () => {
    expect(() =>
      parseRippleWebhookEnvelope({
        event: "payment.received",
        client_id: "codelabplatfdcf3a8",
        timestamp: "2026-08-15T10:15:27.000Z",
      }),
    ).toThrow(
      "Webhook data must be a JSON object",
    );
    const valid = rippleEnvelope();
    expect(() =>
      parseRippleWebhookEnvelope({
        id: "legacy-event",
        type: "payment.received",
        data: valid.data,
      }),
    ).toThrow();
  });

  it("requires explicit GBP currency RIP-PRODUCT-002", () => {
    expect(() =>
      parseRippleWebhookEnvelope(
        rippleEnvelope({ data: { currency: undefined } }),
      ),
    ).toThrow("currency must be GBP");
    expect(() =>
      parseRippleWebhookEnvelope(rippleEnvelope({ data: { currency: "eur" } })),
    ).toThrow("currency must be GBP");
  });

  it("attaches a valid merchant reference to listing metadata", () => {
    const reference = createRippleReference({
      purpose: "listing_payment",
      targetId: "listing-1",
      linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    });
    const parsed = parseRippleWebhookEnvelope(
      rippleEnvelope({
        data: { merchant_reference: reference },
      })
    );
    expect(parsed.event.metadata.listingId).toBe("listing-1");
    expect(parsed.event.metadata.checkoutType).toBe("listing_payment");
  });

  it("keeps an invalid merchant reference without attaching listing metadata", () => {
    const parsed = parseRippleWebhookEnvelope(
      rippleEnvelope({
        data: { merchant_reference: "v1:listing_payment:listing-1:nonce:deadbeef" },
      })
    );
    expect(parsed.event.providerReference).toBe(
      "v1:listing_payment:listing-1:nonce:deadbeef"
    );
    expect(parsed.event.metadata.listingId).toBeNull();
  });
});
