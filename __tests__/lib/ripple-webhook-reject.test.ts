import { describe, expect, it } from "vitest";
import { createRippleWebhookSignature } from "@/lib/payments/ripple-signature";
import { assertRippleSafeMonitoringPayload } from "@/lib/payments/ripple-privacy";
import {
  classifyRippleEnvelopeReject,
  classifyRippleHmacShape,
  describeRippleWebhookAuth,
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
