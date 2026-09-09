import { describe, expect, it } from "vitest";
import {
  createRippleWebhookSignature,
  createRippleWebhookTimestampSignature,
  describeRippleHmacCandidates,
  RIPPLE_SIGNATURE_MAX_AGE_SECONDS,
  verifyRippleWebhookSignature,
} from "@/lib/payments/ripple-signature";
import { RIPPLE_TEST_WEBHOOK_SECRET } from "./ripple-test-env";

describe("RIP-SIG-001 Ripple webhook signatures", () => {
  const body = JSON.stringify({ event: "payment.received", data: {} });
  const secret = RIPPLE_TEST_WEBHOOK_SECRET;

  it("accepts only an exact lowercase-hex HMAC of the raw body", () => {
    const signature = createRippleWebhookSignature(body, secret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(() =>
      verifyRippleWebhookSignature(body, { "x-ripple-signature": signature }, secret)
    ).not.toThrow();
  });

  it("accepts a fresh t,v1 HMAC of timestamp dot raw body", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createRippleWebhookTimestampSignature(
      body,
      secret,
      timestamp
    );
    expect(signature).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        { "x-ripple-signature": signature },
        secret
      )
    ).not.toThrow();
    expect(
      describeRippleHmacCandidates(
        body,
        { "x-ripple-signature": signature },
        secret
      )
    ).toEqual({ macBody: 0, macTsBody: 1, macTsHash: 0 });
  });

  it("rejects stale or altered t,v1 signatures", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createRippleWebhookTimestampSignature(
      body,
      secret,
      timestamp
    );
    expect(() =>
      verifyRippleWebhookSignature(
        `${body} `,
        { "x-ripple-signature": signature },
        secret
      )
    ).toThrow("Invalid webhook signature");
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        {
          "x-ripple-signature": createRippleWebhookTimestampSignature(
            body,
            secret,
            timestamp - RIPPLE_SIGNATURE_MAX_AGE_SECONDS - 1
          ),
        },
        secret
      )
    ).toThrow("Invalid webhook signature");
  });

  it("rejects altered bodies and alternative signature formats", () => {
    const signature = createRippleWebhookSignature(body, secret);
    expect(() =>
      verifyRippleWebhookSignature(
        `${body} `,
        { "x-ripple-signature": signature },
        secret
      )
    ).toThrow("Invalid webhook signature");
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        { "x-ripple-signature": `sha256=${signature}` },
        secret
      )
    ).toThrow("Invalid webhook signature");
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        { "ripple-signature": signature },
        secret
      )
    ).toThrow("Invalid webhook signature");
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        { "x-ripple-signature": Buffer.from(signature, "hex").toString("base64") },
        secret
      )
    ).toThrow("Invalid webhook signature");
    expect(() =>
      verifyRippleWebhookSignature(
        body,
        { "x-ripple-signature": signature.toUpperCase() },
        secret,
      ),
    ).toThrow("Invalid webhook signature");
  });
});
