import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  inboxFindUnique,
  inboxFindMany,
  inboxUpdateMany,
  inboxCreate,
  inboxQueryRaw,
  inboxExecuteRaw,
  inboxTransaction,
  processProviderWebhookEvent,
} = vi.hoisted(() => ({
  inboxFindUnique: vi.fn(),
  inboxFindMany: vi.fn(),
  inboxUpdateMany: vi.fn(),
  inboxCreate: vi.fn(),
  inboxQueryRaw: vi.fn(),
  inboxExecuteRaw: vi.fn(),
  inboxTransaction: vi.fn(),
  processProviderWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    paymentWebhookInbox: {
      findUnique: inboxFindUnique,
      findMany: inboxFindMany,
      updateMany: inboxUpdateMany,
      create: inboxCreate,
    },
    $queryRaw: inboxQueryRaw,
    $executeRaw: inboxExecuteRaw,
    $transaction: inboxTransaction,
  },
}));

vi.mock("@/lib/payments/webhook-processing", () => ({
  processProviderWebhookEvent,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
}));

import { captureBusinessEvent } from "@/lib/monitoring";
import {
  ingestVerifiedRippleWebhook,
  persistRippleWebhookInbox,
  processRippleInboxRecord,
  retryFailedRippleWebhooks,
} from "@/lib/payments/ripple-inbox";

const minimized = {
  event: "payment.received",
  client_id: "codelabplatfdcf3a8",
  timestamp: "2026-08-15T10:15:27.000Z",
  amount: 4.99,
  currency: "gbp",
  payment_reference: "pay-1",
  merchant_reference: null,
  link_code: RIPPLE_CANONICAL_PRODUCTS.listing.code,
  link_type: "one-off",
  recurring: false,
  package: null,
  description: null,
  reason: null,
};

function listingEvent(): NormalizedProviderWebhookEvent {
  return {
    id: "evt-1",
    type: "payment.received",
    rawType: "payment.received",
    providerPaymentId: "pay-1",
    providerReference: null,
    providerSubscriptionId: null,
    providerPlanId: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    paymentStatus: "SUCCEEDED",
    subscriptionStatus: null,
    amount: 499,
    currency: "gbp",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    eventTimestamp: new Date("2026-08-15T10:15:27.000Z"),
    clientId: "codelabplatfdcf3a8",
    customerEmail: null,
    linkCode: RIPPLE_CANONICAL_PRODUCTS.listing.code,
    packageName: null,
    recurring: false,
    linkType: "one-off",
    fingerprint: "fp-1",
    metadata: {
      checkoutType: "listing_payment",
      listingId: "listing-1",
      dealerId: null,
      tier: null,
    },
    payload: {},
  };
}

describe("RIP-TXN-001 webhook inbox recovery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    inboxUpdateMany.mockResolvedValue({ count: 1 });
    inboxTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        paymentWebhookInbox: {
          findUnique: inboxFindUnique,
          create: inboxCreate,
        },
        $executeRaw: inboxExecuteRaw,
      }),
    );
  });

  it("persists a minimized PENDING row before business processing", async () => {
    inboxFindUnique.mockResolvedValueOnce(null);
    inboxCreate.mockResolvedValue({ id: "inbox-1", status: "PENDING" });
    inboxFindUnique.mockResolvedValueOnce({
      id: "inbox-1",
      status: "PENDING",
      attemptCount: 0,
      customerEmailNorm: null,
      minimizedPayload: minimized,
      eventType: "payment.received",
    });
    processProviderWebhookEvent.mockResolvedValue(undefined);

    await ingestVerifiedRippleWebhook({
      rawBody: JSON.stringify({ event: "payment.received" }),
      event: listingEvent(),
      minimized,
      customerEmailNorm: null,
    });

    expect(inboxCreate).toHaveBeenCalledBefore(processProviderWebhookEvent);
    const created = inboxCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(created.status).toBe("PENDING");
    expect(created).not.toHaveProperty("rawBody");
    expect(created).not.toHaveProperty("signature");
    expect(created).not.toHaveProperty("rawSignature");
    expect(processProviderWebhookEvent).toHaveBeenCalledOnce();
  });

  it("PAY-REV-004 locks the provider payment before storing a refund receipt", async () => {
    const order: string[] = [];
    inboxFindUnique.mockResolvedValue(null);
    inboxExecuteRaw.mockImplementation(async () => {
      order.push("lock");
      return 0;
    });
    inboxCreate.mockImplementation(async () => {
      order.push("create");
      return { id: "inbox-refund", status: "PENDING" };
    });

    await persistRippleWebhookInbox({
      rawBody: "refund",
      event: {
        ...listingEvent(),
        type: "payment.refunded",
        rawType: "payment.refunded",
      },
      minimized,
      customerEmailNorm: null,
    });

    expect(order).toEqual(["lock", "create"]);
    expect(inboxTransaction).toHaveBeenCalledOnce();
    const [statement, key] = inboxExecuteRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(statement.join("")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(key).toBe("pay-1");
    expect(inboxQueryRaw).not.toHaveBeenCalled();
  });

  it("uses original verified relay identity so a re-signed retry reuses the inbox", async () => {
    const bodyHash = "b".repeat(64);
    inboxFindUnique.mockResolvedValue({ id: "relayed", status: "PROCESSED", bodyHash });
    await persistRippleWebhookInbox({ rawBody: "fresh relay", verifiedBodyHash: bodyHash, event: listingEvent(), minimized, customerEmailNorm: null });
    expect(inboxFindUnique).toHaveBeenCalledWith({ where: { bodyHash } });
    expect(inboxCreate).not.toHaveBeenCalled();
  });

  it("forwards a linkless weekly renewal to staging with the configured test link", async () => {
    const code = "AABBCCDDEEFF0011";
    const bodyHash = "d".repeat(64);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RIPPLE_CLIENT_ID", "codelabplatfdcf3a8");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    vi.stubEnv("RIPPLE_STAGING_RELAY_SECRET", "test-relay-secret".repeat(3));
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ received: true, bodyHash }) });
    vi.stubGlobal("fetch", fetcher);
    const payload = {
      ...minimized,
      event: "payment.success",
      amount: 1,
      link_code: null,
      recurring: true,
      package: "TEST SUBSCRIPTION LINK",
    };
    inboxFindUnique.mockResolvedValue({
      id: "weekly-renewal", status: "PENDING", attemptCount: 0, bodyHash,
      minimizedPayload: payload, customerEmailNorm: "dealer@example.com",
      eventType: "payment.success", packageName: "TEST SUBSCRIPTION LINK", amountPence: 100, linkCode: null,
    });
    await expect(processRippleInboxRecord("weekly-renewal")).resolves.toEqual({ status: "processed" });
    expect(processProviderWebhookEvent).not.toHaveBeenCalled();
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.minimized.link_code).toBe(code);
    expect(body.bodyHash).toBe(bodyHash);
  });

  it("keeps failed staging delivery retryable and never processes it against production", async () => {
    const code = "AABBCCDDEEFF0011";
    const bodyHash = "c".repeat(64);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RIPPLE_TEST_SUBSCRIPTION_URL", `https://portal.startyourripple.co.uk/card/codelabplatfdcf3a8/pay/${code}`);
    vi.stubEnv("RIPPLE_STAGING_RELAY_SECRET", "test-relay-secret".repeat(3));
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ received: true, bodyHash }) });
    vi.stubGlobal("fetch", fetcher);
    inboxFindUnique.mockResolvedValue({
      id: "relay-inbox", status: "FAILED", attemptCount: 1, bodyHash,
      minimizedPayload: { ...minimized, link_code: code, amount: 1, recurring: true },
      customerEmailNorm: "dealer@example.com", eventType: "payment.received",
    });
    await expect(processRippleInboxRecord("relay-inbox")).resolves.toEqual({ status: "failed" });
    expect(inboxUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "FAILED", lastErrorCode: "STAGING_RELAY_FAILED" } }));
    await expect(processRippleInboxRecord("relay-inbox")).resolves.toEqual({ status: "processed" });
    expect(processProviderWebhookEvent).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not reprocess a completed inbox row", async () => {
    inboxFindUnique.mockResolvedValue({
      id: "inbox-1",
      status: "PROCESSED",
    });
    await expect(processRippleInboxRecord("inbox-1")).resolves.toEqual({
      status: "duplicate",
    });
    expect(processProviderWebhookEvent).not.toHaveBeenCalled();
  });

  it("retries failed and stale PENDING rows after an injected failure", async () => {
    inboxFindMany.mockResolvedValue([{ id: "inbox-2" }]);
    inboxFindUnique.mockResolvedValue({
      id: "inbox-2",
      status: "FAILED",
      attemptCount: 0,
      customerEmailNorm: null,
      minimizedPayload: minimized,
      eventType: "payment.received",
    });
    processProviderWebhookEvent
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    await expect(processRippleInboxRecord("inbox-2")).resolves.toEqual({
      status: "failed",
    });
    expect(captureBusinessEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "A verified Ripple webhook could not be applied (WEBHOOK_PROCESS).",
      }),
    );
    await expect(retryFailedRippleWebhooks()).resolves.toEqual({
      attempted: 1,
      processed: 1,
      failed: 0,
      quarantined: 0,
    });
    expect(inboxFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { status: "FAILED" },
            expect.objectContaining({ status: "PENDING" }),
            expect.objectContaining({ status: "PROCESSING" }),
          ]),
        }),
      })
    );
  });

  it("AUD-PAY-001 rethrows inbox persist failures so the route can 5xx", async () => {
    inboxFindUnique.mockResolvedValue(null);
    inboxCreate.mockRejectedValue(new Error("inbox persist failed"));

    await expect(
      ingestVerifiedRippleWebhook({
        rawBody: JSON.stringify({ event: "payment.received" }),
        event: listingEvent(),
        minimized,
        customerEmailNorm: null,
      }),
    ).rejects.toThrow("inbox persist failed");
    expect(processProviderWebhookEvent).not.toHaveBeenCalled();
  });

  it("stores no raw body when persisting a verified event", async () => {
    inboxFindUnique.mockResolvedValue(null);
    inboxCreate.mockResolvedValue({ id: "inbox-3", status: "PENDING" });
    await persistRippleWebhookInbox({
      rawBody: '{"event":"payment.received","secret":"do-not-store"}',
      event: listingEvent(),
      minimized,
      customerEmailNorm: "buyer@example.com",
    });
    const created = inboxCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(JSON.stringify(created)).not.toContain("do-not-store");
    expect(created.minimizedPayload).toEqual(minimized);
  });

  it("allows only one concurrent processor to claim a record RIP-INBOX-001", async () => {
    inboxFindUnique.mockResolvedValue({
      id: "inbox-race",
      status: "PENDING",
      attemptCount: 0,
      updatedAt: new Date(),
      customerEmailNorm: null,
      minimizedPayload: minimized,
      eventType: "payment.received",
    });
    let releaseProcessing: (() => void) | undefined;
    const processingBarrier = new Promise<void>((resolve) => {
      releaseProcessing = resolve;
    });
    processProviderWebhookEvent.mockImplementationOnce(() => processingBarrier);
    inboxUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const winner = processRippleInboxRecord("inbox-race");
    await vi.waitFor(() => expect(processProviderWebhookEvent).toHaveBeenCalledTimes(1));
    await expect(processRippleInboxRecord("inbox-race")).resolves.toEqual({
      status: "processing",
    });

    releaseProcessing?.();
    await expect(winner).resolves.toEqual({ status: "processed" });
    expect(processProviderWebhookEvent).toHaveBeenCalledTimes(1);
    expect(inboxUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "inbox-race",
          status: "PROCESSING",
          attemptCount: 1,
        }),
        data: expect.objectContaining({ status: "PROCESSED" }),
      }),
    );
  });

  it("quarantines a subscription charge collision RIP-CHARGE-002", async () => {
    inboxFindUnique.mockResolvedValue({
      id: "inbox-collision",
      status: "PENDING",
      attemptCount: 0,
      updatedAt: new Date(),
      customerEmailNorm: "dealer@example.com",
      minimizedPayload: minimized,
      eventType: "payment.success",
    });
    processProviderWebhookEvent.mockRejectedValueOnce(
      new Error("Ripple subscription charge collision"),
    );

    await expect(processRippleInboxRecord("inbox-collision")).resolves.toEqual({
      status: "quarantined",
    });
    expect(inboxUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUARANTINED",
          lastErrorCode: "CHARGE_COLLISION",
        }),
      }),
    );
  });
});
