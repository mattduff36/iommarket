// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  acknowledgeCheckoutHandoff,
  createPaymentReturnEvent,
  isMatchingConfirmedLink,
  parsePaymentReturnEvent,
  shouldAcknowledgeCheckoutHandoff,
} from "@/lib/payments/checkout-handoff";

describe("checkout handoff contract", () => {
  it("rejects tampered or incomplete return events", () => {
    const event = createPaymentReturnEvent({
      status: "success",
      context: "listing",
      listingId: "listing-1",
      sampleCheckoutId: "caaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(parsePaymentReturnEvent(JSON.stringify(event))?.id).toBe(event.id);
    expect(parsePaymentReturnEvent(JSON.stringify({ ...event, status: "paid" }))).toBeNull();
    expect(parsePaymentReturnEvent('{"id":"not-a-uuid"}')).toBeNull();
  });

  it("acknowledges only a confirmed matching payment", () => {
    const event = createPaymentReturnEvent({
      status: "success",
      context: "featured",
      listingId: "listing-1",
    });
    const failed = createPaymentReturnEvent({ status: "failed", context: "featured", listingId: "listing-1" });

    expect(isMatchingConfirmedLink(event, { status: "confirmed", context: "featured", listingId: "listing-1" })).toBe(true);
    expect(isMatchingConfirmedLink(event, { status: "confirmed", context: "listing", listingId: "listing-1" })).toBe(false);
    expect(shouldAcknowledgeCheckoutHandoff({
      event,
      link: { status: "waiting", context: "featured", listingId: "listing-1" },
    })).toBe(false);
    expect(shouldAcknowledgeCheckoutHandoff({
      event: failed,
      link: { status: "confirmed", context: "featured", listingId: "listing-1" },
    })).toBe(false);
    expect(shouldAcknowledgeCheckoutHandoff({
      event: createPaymentReturnEvent({
        status: "success",
        context: "listing",
        sampleCheckoutId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      sampleStatus: "SUCCEEDED",
    })).toBe(true);
    expect(shouldAcknowledgeCheckoutHandoff({
      event: createPaymentReturnEvent({
        status: "success",
        context: "listing",
        sampleCheckoutId: "caaaaaaaaaaaaaaaaaaaaaaaa",
      }),
      sampleStatus: "FAILED",
    })).toBe(false);
  });

  it("does not store an acknowledgement for an invalid event id", () => {
    acknowledgeCheckoutHandoff("not-an-event");
    expect(window.localStorage.getItem("iomarket-payment-return-ack")).toBeNull();
  });
});
