import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  inboxCount: vi.fn(),
  capture: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: (() => {
    const client = {
    paymentCheckoutAttempt: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
    paymentWebhookInbox: { count: mocks.inboxCount },
      $queryRaw: mocks.queryRaw,
    };
    return {
      ...client,
      $transaction: mocks.transaction,
    };
  })(),
}));
vi.mock("@/lib/monitoring", () => ({
  captureBusinessEvent: mocks.capture,
}));

import { detectStalePaymentAttempts } from "@/lib/payments/stale-attempts";

describe("stale payment attempt monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (operation: (client: unknown) => unknown) =>
        operation({
          paymentCheckoutAttempt: {
            findMany: mocks.findMany,
            findFirst: mocks.findFirst,
            updateMany: mocks.updateMany,
          },
          paymentWebhookInbox: { count: mocks.inboxCount },
          $queryRaw: mocks.queryRaw,
        }),
    );
    mocks.findMany.mockResolvedValue([
      {
        id: "attempt-1",
        kind: "FEATURED_UPGRADE",
        status: "REVIEW",
        merchantReference: "signed",
        createdAt: new Date("2026-10-05T10:00:00Z"),
        observations: [],
      },
    ]);
    mocks.inboxCount.mockResolvedValue(0);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findFirst.mockResolvedValue({ id: "attempt-1" });
    mocks.capture.mockResolvedValue({});
  });

  it("PAY-CRON-001 alerts a previously classified no-inbox attempt", async () => {
    await expect(
      detectStalePaymentAttempts(new Date("2026-10-05T11:00:00Z")),
    ).resolves.toEqual({ reviewed: 1, alerted: 1 });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ripple checkout has no webhook receipt",
        dedupeKey: "stale-payment-attempt:attempt-1",
      }),
    );
  });

  it("classifies a newly stale attempt before alerting on a later run", async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: "attempt-1",
        kind: "FEATURED_UPGRADE",
        status: "OPEN",
        merchantReference: "signed",
        createdAt: new Date("2026-10-05T10:00:00Z"),
        observations: [],
      },
    ]);
    await expect(detectStalePaymentAttempts()).resolves.toEqual({
      reviewed: 1,
      alerted: 0,
    });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REVIEW" } }),
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("PAY-CRON-002 does not alert when another worker claimed the attempt", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(detectStalePaymentAttempts()).resolves.toEqual({
      reviewed: 1,
      alerted: 0,
    });
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("retries when monitoring capture returns no durable record", async () => {
    mocks.capture.mockResolvedValue(null);
    await expect(detectStalePaymentAttempts()).resolves.toEqual({
      reviewed: 1,
      alerted: 0,
    });
    expect(mocks.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "attempt-1",
        status: "REVIEW",
        alertLeaseUntil: expect.any(Date),
      },
      data: { alertLeaseUntil: null },
    });
  });

  it("PAY-CRON-004 reclaims an expired lease without duplicating the durable alert", async () => {
    const now = new Date("2026-10-05T11:00:00Z");

    await expect(detectStalePaymentAttempts(now)).resolves.toEqual({
      reviewed: 1,
      alerted: 1,
    });

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          alertedAt: null,
          OR: [
            { alertLeaseUntil: null },
            { alertLeaseUntil: { lte: now } },
          ],
        }),
      }),
    );
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it("PAY-CRON-005 does not emit after reconciliation wins the row lock", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(detectStalePaymentAttempts()).resolves.toEqual({
      reviewed: 1,
      alerted: 0,
    });

    expect(mocks.queryRaw).toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
