import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRippleStagingRelayRequest, forwardRippleWebhookToStaging, RIPPLE_STAGING_RECEIVER, shouldRelayRippleToStaging, verifyRippleStagingRelay } from "@/lib/payments/ripple-staging-relay";
import { NextRequest } from "next/server";
const { ingest, processInbox, findInbox } = vi.hoisted(() => ({ ingest: vi.fn(), processInbox: vi.fn(), findInbox: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { paymentWebhookInbox: { findUnique: findInbox } } }));
vi.mock("@/lib/payments/ripple-inbox", () => ({ persistRippleWebhookInbox: ingest, processRippleInboxRecord: processInbox }));
import { POST } from "@/app/api/webhooks/ripple-staging/route";
const testCode = "AABBCCDDEEFF0011";
const input = {
  bodyHash: "a".repeat(64), customerEmailNorm: "dealer@example.com",
  minimized: {
    event: "payment.success", client_id: "codelabplatfdcf3a8", timestamp: "2026-09-30T12:00:00.000Z",
    amount: 1, currency: "gbp", payment_reference: "260921021772763472", merchant_reference: null,
    link_code: testCode, link_type: "subscription", recurring: true, package: "Weekly test", description: null, reason: null,
  },
};
function signedRequest(value = input) {
  const signed = createRippleStagingRelayRequest(value);
  return new NextRequest(RIPPLE_STAGING_RECEIVER, { method: "POST", ...signed });
}
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("RIPPLE_CLIENT_ID", "codelabplatfdcf3a8");
  vi.stubEnv("RIPPLE_STAGING_RELAY_SECRET", "unit-test-relay-secret".repeat(3));
  vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${testCode}`);
  vi.stubEnv("RIPPLE_REFERENCE_SECRET", "unit-test-reference-secret".repeat(3));
  ingest.mockReset().mockResolvedValue({ id: "inbox-1" });
  processInbox.mockReset().mockResolvedValue({ status: "processed" });
  findInbox.mockReset().mockResolvedValue({ status: "FAILED", lastErrorCode: "WEBHOOK_PROCESS" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("staging webhook authentication and destination", () => {
  it("preserves the original identity across newly signed retries", () => {
    const now = Date.now();
    const first = createRippleStagingRelayRequest(input, now);
    const retry = createRippleStagingRelayRequest(input, now + 600_000);
    expect(first.headers["x-itrader-relay-signature"]).not.toBe(retry.headers["x-itrader-relay-signature"]);
    expect(verifyRippleStagingRelay(retry.body, new Headers(retry.headers), now + 600_000).bodyHash).toBe(input.bodyHash);
    expect(() => verifyRippleStagingRelay(first.body, new Headers(first.headers), now + 600_000)).toThrow("EXPIRED");
  });
  it("rejects altered payloads and future signatures", () => {
    const signed = createRippleStagingRelayRequest(input);
    expect(() => verifyRippleStagingRelay(signed.body.replace('dealer@example.com', 'other@example.com'), new Headers(signed.headers))).toThrow("INVALID");
    const future = createRippleStagingRelayRequest(input, Date.now() + 600_000);
    expect(() => verifyRippleStagingRelay(future.body, new Headers(future.headers))).toThrow("EXPIRED");
  });
  it("rejects signed live link events and a different client", () => {
    for (const minimized of [{ ...input.minimized, link_code: "74A7510E33E94821" }, { ...input.minimized, client_id: "someone-else" }]) {
      const signed = createRippleStagingRelayRequest({ ...input, minimized });
      expect(() => verifyRippleStagingRelay(signed.body, new Headers(signed.headers))).toThrow("INVALID_PRODUCT");
    }
  });
  it("routes only configured test links and never loops on preview", () => {
    expect(shouldRelayRippleToStaging(testCode)).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(shouldRelayRippleToStaging(testCode)).toBe(true);
    expect(shouldRelayRippleToStaging("74A7510E33E94821")).toBe(false);
  });
  it("uses fixed HTTPS destination, forbids redirects and requires exact acknowledgement", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true, bodyHash: input.bodyHash }) });
    vi.stubGlobal("fetch", fetcher);
    await forwardRippleWebhookToStaging(input);
    expect(fetcher).toHaveBeenCalledWith(RIPPLE_STAGING_RECEIVER, expect.objectContaining({ redirect: "error", cache: "no-store" }));
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ received: true, bodyHash: "wrong" }) });
    await expect(forwardRippleWebhookToStaging(input)).rejects.toThrow("ACKNOWLEDGEMENT");
    fetcher.mockResolvedValueOnce({ ok: false });
    await expect(forwardRippleWebhookToStaging(input)).rejects.toThrow("DELIVERY");
  });
});

describe("staging receiver", () => {
  it("rejects all requests on production without ingesting", async () => {
    const request = signedRequest();
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request)).status).toBe(404);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("rejects unsigned requests without ingesting", async () => {
    expect((await POST(new NextRequest(RIPPLE_STAGING_RECEIVER, { method: "POST", body: "{}" }))).status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("acknowledges durable ingestion using original hash for replay deduplication", async () => {
    expect((await POST(signedRequest())).status).toBe(200);
    expect((await POST(signedRequest())).status).toBe(200);
    expect(ingest).toHaveBeenNthCalledWith(1, expect.objectContaining({ verifiedBodyHash: input.bodyHash }));
    expect(ingest).toHaveBeenNthCalledWith(2, expect.objectContaining({ verifiedBodyHash: input.bodyHash }));
  });
  it("keeps production retrying until application succeeds", async () => {
    processInbox.mockResolvedValueOnce({ status: "failed" }).mockResolvedValueOnce({ status: "duplicate" });
    expect((await POST(signedRequest())).status).toBe(503);
    expect((await POST(signedRequest())).status).toBe(200);
  });
  it("does not acknowledge failed persistence", async () => {
    ingest.mockRejectedValueOnce(new Error("db offline"));
    expect((await POST(signedRequest())).status).toBe(503);
  });
  it("acknowledges a durable receipt awaiting authenticated browser reconciliation", async () => {
    processInbox.mockResolvedValue({ status: "failed" });
    findInbox.mockResolvedValue({ status: "FAILED", lastErrorCode: "MISSING_REFERENCE" });
    expect((await POST(signedRequest())).status).toBe(200);
  });
});
