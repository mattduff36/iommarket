import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";
import type { NormalizedProviderWebhookEvent } from "@/lib/payments/provider-types";
import { installRippleTestEnv } from "./ripple-test-env";

const {
  inboxFindUnique,
  inboxFindMany,
  inboxUpdateMany,
  inboxCreate,
  processProviderWebhookEvent,
} = vi.hoisted(() => ({
  inboxFindUnique: vi.fn(),
  inboxFindMany: vi.fn(),
  inboxUpdateMany: vi.fn(),
  inboxCreate: vi.fn(),
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
  },
}));

vi.mock("@/lib/payments/webhook-processing", () => ({
  processProviderWebhookEvent,
}));

vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: vi.fn(),
}));

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
  beforeEach(() => {
    installRippleTestEnv();
    vi.clearAllMocks();
    inboxUpdateMany.mockResolvedValue({ count: 1 });
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
