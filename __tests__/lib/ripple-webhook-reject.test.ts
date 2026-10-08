import { describe, expect, it } from "vitest";
import { createRippleWebhookSignature } from "@/lib/payments/ripple-signature";
import { assertRippleSafeMonitoringPayload } from "@/lib/payments/ripple-privacy";
import { createMonitoringFingerprint } from "@/lib/monitoring";
import {
  classifyRippleEnvelopeReject,
  classifyRippleHmacShape,
  describeRippleCurrencyField,
  describeRippleWebhookAuth,
  rippleRejectMonitoringCopy,
  rippleRejectTags,
} from "@/lib/payments/ripple-webhook-reject";
import { RIPPLE_TEST_WEBHOOK_SECRET } from "./ripple-test-env";

describe("RIP-REJ-001 Ripple webhook reject diagnostics", () => {
  const body = JSON.stringify({ event: "payment.received", data: {} });
  const hex = createRippleWebhookSignature(body, RIPPLE_TEST_WEBHOOK_SECRET);

  it("classifies HMAC shapes without exposing the value", () => {
    expect(classifyRippleHmacShape(null)).toBe("missing");
    expect(classifyRippleHmacShape(hex)).toBe("hex64");
    expect(classifyRippleHmacShape(hex.toUpperCase())).toBe("hex64u");
    expect(classifyRippleHmacShape(`sha256=${hex}`)).toBe("sha256eq");
    expect(classifyRippleHmacShape(`t=1710000000,v1=${hex}`)).toBe("tv1");
    expect(
      classifyRippleHmacShape(Buffer.from(hex, "hex").toString("base64"))
    ).toBe("b64");
    expect(classifyRippleHmacShape("abcd")).toBe("hexlen");
  });

  it("aliases known auth headers and flags unknown candidates", () => {
    const described = describeRippleWebhookAuth({
      "X-Ripple-Signature": `sha256=${hex}`,
      "webhook-id": "evt_1",
      "X-Custom-HMAC": "abc",
    });
    expect(described.hmacShape).toBe("sha256eq");
    expect(described.hmacLen).toBe(`sha256=${hex}`.length);
    expect(described.authHdrs).toBe("whid,xrpl");
    expect(described.authOther).toBe(true);
    expect(JSON.stringify(described)).not.toContain(hex);
    expect(JSON.stringify(described)).not.toMatch(/x-ripple-signature/i);
  });

  it("maps envelope errors to stable reason codes", () => {
    expect(classifyRippleEnvelopeReject(new SyntaxError("Unexpected token"))).toBe(
      "json"
    );
    expect(
      classifyRippleEnvelopeReject(new Error("Ripple webhook currency must be GBP"))
    ).toBe("ccy");
    expect(
      classifyRippleEnvelopeReject(new Error("Ripple client_id mismatch"))
    ).toBe("client");
  });

  it("classifies currency shape without storing an arbitrary value", () => {
    expect(describeRippleCurrencyField({ data: {} })).toMatchObject({
      ccyState: "missing",
      ccyKeys: "none",
    });
    expect(
      describeRippleCurrencyField({ data: { currency: null, currency_code: "GBP" } })
    ).toMatchObject({ ccyState: "missing", ccyKeys: "currency,currency_code" });
    expect(describeRippleCurrencyField({ data: { currency: "  " } }).ccyState).toBe(
      "blank"
    );
    expect(describeRippleCurrencyField({ data: { currency: 826 } })).toEqual({
      ccyState: "wrongtype",
      ccyKeys: "currency",
    });
    expect(describeRippleCurrencyField({ data: { currency: "EUR" } })).toEqual({
      ccyState: "unsupported",
      ccyCode: "eur",
      ccyKeys: "currency",
    });
    const freeText = describeRippleCurrencyField({
      data: { currency: "buyer@example.com", ccy: "notes" },
    });
    expect(freeText).toEqual({
      ccyState: "unsupported",
      ccyKeys: "currency,ccy",
    });
    expect(JSON.stringify(freeText)).not.toContain("@");
  });

  it("uses separate monitoring messages for signature, currency, and other envelope failures", () => {
    const signature = rippleRejectMonitoringCopy({ rejectStage: "hmac" });
    const currency = rippleRejectMonitoringCopy({
      rejectStage: "envelope",
      envReason: "ccy",
    });
    const payload = rippleRejectMonitoringCopy({
      rejectStage: "envelope",
      envReason: "json",
    });
    const fingerprint = (message: string) =>
      createMonitoringFingerprint({
        source: "WEBHOOK",
        message,
        route: "/api/webhooks/payments",
        action: "paymentsWebhookReject",
      });

    expect(signature.message).toMatch(/signature check/);
    expect(currency.message).toMatch(/currency validation/);
    expect(payload.message).toMatch(/payload validation/);
    const signatureFingerprint = fingerprint(signature.message);
    const currencyFingerprint = fingerprint(currency.message);
    const payloadFingerprint = fingerprint(payload.message);
    expect(signatureFingerprint).not.toBe(currencyFingerprint);
    expect(signatureFingerprint).not.toBe(payloadFingerprint);
    expect(currencyFingerprint).not.toBe(payloadFingerprint);
    expect(new Set([
      signatureFingerprint,
      currencyFingerprint,
      payloadFingerprint,
    ]).size).toBe(3);
  });

  it("emits monitoring tags that survive Ripple privacy filters", () => {
    const tags = rippleRejectTags({
      rejectStage: "hmac",
      headers: { "x-ripple-signature": hex.toUpperCase() },
    });
    expect(tags).toMatchObject({
      rejectStage: "hmac",
      hmacShape: "hex64u",
      authHdrs: "xrpl",
    });
    expect(() => assertRippleSafeMonitoringPayload({ tags })).not.toThrow();
  });
});
