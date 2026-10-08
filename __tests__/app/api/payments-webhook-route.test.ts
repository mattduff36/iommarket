/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createRippleWebhookSignature } from "@/lib/payments/ripple-signature";
import {
  installRippleTestEnv,
  rippleEnvelope,
  RIPPLE_TEST_WEBHOOK_SECRET,
} from "../../lib/ripple-test-env";

const ingestVerifiedRippleWebhook = vi.fn();
const captureException = vi.fn();
const captureBusinessEvent = vi.fn();

vi.mock("@/lib/payments/ripple-inbox", () => ({
  ingestVerifiedRippleWebhook: (...args: unknown[]) =>
    ingestVerifiedRippleWebhook(...args),
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  captureBusinessEvent: (...args: unknown[]) => captureBusinessEvent(...args),
}));

function signedWebhookRequest(body: string) {
  return new NextRequest("http://localhost:4000/api/webhooks/payments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ripple-signature": createRippleWebhookSignature(
        body,
        RIPPLE_TEST_WEBHOOK_SECRET,
      ),
    },
    body,
  });
}

describe("AUD-PAY-001 payments webhook persist ACK", () => {
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    captureException.mockResolvedValue(undefined);
  });

  it("returns 5xx not 200 when inbox persist throws after a valid signature", async () => {
    ingestVerifiedRippleWebhook.mockRejectedValue(
      new Error("inbox persist failed"),
    );
    const { POST } = await import("@/app/api/webhooks/payments/route");
    const response = await POST(
      signedWebhookRequest(JSON.stringify(rippleEnvelope())),
    );

    expect(ingestVerifiedRippleWebhook).toHaveBeenCalledOnce();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.status).toBeLessThan(600);
    await expect(response.json()).resolves.not.toEqual({ received: true });
    expect(captureBusinessEvent).not.toHaveBeenCalled();
  });

  it("logs HMAC reject shape and keeps the 400 body unchanged", async () => {
    const { POST } = await import("@/app/api/webhooks/payments/route");
    const body = JSON.stringify(rippleEnvelope());
    const response = await POST(
      new NextRequest("http://localhost:4000/api/webhooks/payments", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ripple-signature": `sha256=${createRippleWebhookSignature(
            body,
            RIPPLE_TEST_WEBHOOK_SECRET,
          )}`,
        },
        body,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook" });
    expect(ingestVerifiedRippleWebhook).not.toHaveBeenCalled();
    expect(captureBusinessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paymentsWebhookReject",
        message: "Ripple webhook failed the signature check before persist.",
        tags: expect.objectContaining({
          rejectStage: "hmac",
          hmacShape: "sha256eq",
          authHdrs: "xrpl",
        }),
      }),
    );
    expect(captureBusinessEvent.mock.calls[0]?.[0].tags).not.toHaveProperty("ccyState");
  });

  it.each([
    ["missing", "currency_code", (data: Record<string, unknown>) => {
      delete data.currency;
      data.currency_code = "GBP";
    }],
    ["blank", "currency", (data: Record<string, unknown>) => {
      data.currency = "  ";
    }],
    ["wrongtype", "currency", (data: Record<string, unknown>) => {
      data.currency = 826;
    }],
    ["unsupported", "currency", (data: Record<string, unknown>) => {
      data.currency = "eur";
    }],
  ] as const)(
    "rejects currency shape %s after a valid HMAC and does not ingest",
    async (ccyState, ccyKeys, mutate) => {
      const { POST } = await import("@/app/api/webhooks/payments/route");
      const envelope = rippleEnvelope();
      mutate(envelope.data);
      const body = JSON.stringify(envelope);
      const response = await POST(signedWebhookRequest(body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid webhook" });
      expect(ingestVerifiedRippleWebhook).not.toHaveBeenCalled();
      expect(captureBusinessEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "paymentsWebhookReject",
          message: "Ripple webhook failed currency validation before persist.",
          tags: expect.objectContaining({
            rejectStage: "envelope",
            envReason: "ccy",
            ccyState,
            ccyKeys,
            ...(ccyState === "unsupported" ? { ccyCode: "eur" } : {}),
          }),
        }),
      );
      const tags = captureBusinessEvent.mock.calls[0]?.[0].tags;
      expect(JSON.stringify(tags)).not.toMatch(/826|buyer@|signature/i);
    },
  );

  it("logs envelope reject reason after a valid HMAC", async () => {
    const { POST } = await import("@/app/api/webhooks/payments/route");
    const body = JSON.stringify(
      rippleEnvelope({ data: { currency: undefined } }),
    );
    const response = await POST(signedWebhookRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid webhook" });
    expect(ingestVerifiedRippleWebhook).not.toHaveBeenCalled();
    expect(captureBusinessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "paymentsWebhookReject",
        message: "Ripple webhook failed currency validation before persist.",
        tags: expect.objectContaining({
          rejectStage: "envelope",
          envReason: "ccy",
          ccyState: "missing",
        }),
      }),
    );
  });

  it("ingests an explicit GBP notice and does not open a reject issue", async () => {
    ingestVerifiedRippleWebhook.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/webhooks/payments/route");
    const response = await POST(
      signedWebhookRequest(JSON.stringify(rippleEnvelope({ data: { currency: "GBP" } }))),
    );

    expect(response.status).toBe(200);
    expect(ingestVerifiedRippleWebhook).toHaveBeenCalledOnce();
    expect(captureBusinessEvent).not.toHaveBeenCalled();
  });
});
