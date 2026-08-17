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

vi.mock("@/lib/payments/ripple-inbox", () => ({
  ingestVerifiedRippleWebhook: (...args: unknown[]) =>
    ingestVerifiedRippleWebhook(...args),
}));

vi.mock("@/lib/monitoring", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
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
  });
});
