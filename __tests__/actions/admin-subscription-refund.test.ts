import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RIPPLE_CANONICAL_PRODUCTS } from "@/lib/payments/ripple-config";

const {
  requireRoleMock,
  logAdminActionMock,
  revalidatePathMock,
  refundProviderPaymentMock,
  capabilitiesMock,
  mockDb,
} = vi.hoisted(() => ({
  requireRoleMock: vi.fn(),
  logAdminActionMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  refundProviderPaymentMock: vi.fn(),
  capabilitiesMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    subscription: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    subscriptionCharge: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    dealerProfile: { update: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ requireRole: requireRoleMock }));
vi.mock("@/lib/admin/audit", () => ({ logAdminAction: logAdminActionMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/monitoring", () => ({ captureException: vi.fn(), captureBusinessEvent: vi.fn() }));
vi.mock("@/lib/payments/provider", () => ({
  getPaymentProviderCapabilities: capabilitiesMock,
  refundProviderPayment: refundProviderPaymentMock,
  cancelProviderSubscription: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import { adminRefundSubscriptionPayment } from "@/actions/admin/payments";

const subscriptionId = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
const latestChargeId = "claaaaaaaaaaaaaaaaaaaaaaa";
const olderChargeId = "clbbbbbbbbbbbbbbbbbbbbbbb";
const operationId = "11111111-1111-4111-8111-111111111111";

function refundRequest(
  reason: "DUPLICATE" | "REQUESTED_BY_CUSTOMER" | "FRAUD" | "SERVICE_NOT_PROVIDED" | "OTHER" = "REQUESTED_BY_CUSTOMER",
  chargeId = latestChargeId,
) {
  return { subscriptionId, chargeId, operationId, reason };
}

function paidSubscription(cancelAtPeriodEnd = false) {
  return {
    id: subscriptionId,
    source: "PAYMENT",
    paymentProvider: "RIPPLE",
    providerSubscriptionId: "provider-sub-1",
    stripeSubscriptionId: null,
    providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
    status: "ACTIVE",
    cancelAtPeriodEnd,
    currentPeriodEnd: new Date("2031-01-15T00:00:00.000Z"),
    dealerId: "dealer-1",
  };
}

describe("adminRefundSubscriptionPayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireRoleMock.mockResolvedValue({ id: "cladminxxxxxxxxxxxxxxxxxx", role: "ADMIN" });
    capabilitiesMock.mockReturnValue({ supportsInAppRefunds: false });
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb));
    mockDb.subscription.findMany.mockResolvedValue([]);
    mockDb.subscriptionCharge.findFirst.mockResolvedValue(null);
    mockDb.subscription.update.mockResolvedValue({ id: subscriptionId, status: "CANCELLED" });
  });

  it("records a Ripple portal refund locally without calling the provider", async () => {
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(),
      charges: [
        {
          id: latestChargeId,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-1",
      amount: 4999,
      currency: "gbp",
      refundedAt: null,
      refundEventId: null,
    });

    await expect(adminRefundSubscriptionPayment(refundRequest())).resolves.toEqual({
      data: { refunded: true, chargeId: latestChargeId },
    });

    expect(refundProviderPaymentMock).not.toHaveBeenCalled();
    expect(mockDb.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: { status: "CANCELLED", currentPeriodEnd: null, cancelAtPeriodEnd: false },
    });
    expect(logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REFUND_SUBSCRIPTION_PAYMENT",
        details: expect.objectContaining({ inAppRefund: false, amount: 4999 }),
      }),
      mockDb,
    );
  });

  it("keeps a scheduled cancellation when another charge still covers the period", async () => {
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(true),
      charges: [
        {
          id: olderChargeId,
          eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
        {
          id: latestChargeId,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-later",
      amount: 4999,
      currency: "gbp",
      refundedAt: null,
      refundEventId: null,
    });
    mockDb.subscription.findMany.mockResolvedValue([
      {
        id: subscriptionId,
        source: "PAYMENT",
        providerPlanId: RIPPLE_CANONICAL_PRODUCTS.pro.code,
        status: "ACTIVE",
        currentPeriodEnd: new Date("2030-12-15T00:00:00.000Z"),
      },
    ]);

    await adminRefundSubscriptionPayment(refundRequest("FRAUD"));

    expect(mockDb.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: expect.objectContaining({ status: "ACTIVE", cancelAtPeriodEnd: true }),
    });
    expect(mockDb.dealerProfile.update).toHaveBeenCalledWith({
      where: { id: "dealer-1" },
      data: { tier: "PRO" },
    });
  });

  it("does not call the provider again when the confirmed charge is already refunded", async () => {
    mockDb.subscription.findUnique.mockResolvedValue(paidSubscription());
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-1",
      amount: 4999,
      currency: "gbp",
      refundedAt: new Date("2030-12-20T00:00:00.000Z"),
      refundEventId: `admin:${operationId}`,
    });

    await expect(adminRefundSubscriptionPayment(refundRequest())).resolves.toEqual({
      data: { refunded: true, alreadyRecorded: true, chargeId: latestChargeId },
    });

    expect(refundProviderPaymentMock).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("does not read or refund a charge when admin authorisation fails", async () => {
    requireRoleMock.mockRejectedValue(new Error("Forbidden"));

    await expect(adminRefundSubscriptionPayment(refundRequest())).rejects.toThrow("Forbidden");

    expect(mockDb.subscription.findUnique).not.toHaveBeenCalled();
    expect(refundProviderPaymentMock).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("calls a mocked in-app provider before recording the refund", async () => {
    capabilitiesMock.mockReturnValue({ supportsInAppRefunds: true });
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(),
      charges: [
        {
          id: latestChargeId,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-1",
      amount: 4999,
      currency: "gbp",
      refundedAt: null,
      refundEventId: null,
    });

    await adminRefundSubscriptionPayment(refundRequest("DUPLICATE"));

    expect(refundProviderPaymentMock).toHaveBeenCalledTimes(1);
    expect(refundProviderPaymentMock).toHaveBeenCalledWith("pay-1");
    expect(mockDb.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      refundProviderPaymentMock.mock.invocationCallOrder[0],
    );
    expect(refundProviderPaymentMock.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.subscriptionCharge.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("retries the same confirmation without refunding the older charge or calling the provider again", async () => {
    const latest = {
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-later",
      amount: 4999,
      currency: "gbp",
      refundedAt: null as Date | null,
      refundEventId: null as string | null,
    };
    const older = {
      id: olderChargeId,
      subscriptionId,
      paymentReference: "pay-older",
      amount: 4999,
      currency: "gbp",
      refundedAt: null as Date | null,
      refundEventId: null as string | null,
    };
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(),
      charges: [
        {
          id: older.id,
          eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
          amount: older.amount,
          currency: older.currency,
          refundedAt: null,
        },
        {
          id: latest.id,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: latest.amount,
          currency: latest.currency,
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === latest.id ? latest : where.id === older.id ? older : null,
    );
    mockDb.subscriptionCharge.updateMany.mockImplementation(async ({
      where,
      data,
    }: {
      where: { id: string; refundedAt: null };
      data: { refundedAt: Date; refundEventId: string };
    }) => {
      const row = where.id === latest.id ? latest : where.id === older.id ? older : null;
      if (!row || row.refundedAt) return { count: 0 };
      row.refundedAt = data.refundedAt;
      row.refundEventId = data.refundEventId;
      return { count: 1 };
    });

    const request = refundRequest("REQUESTED_BY_CUSTOMER", latestChargeId);
    await expect(adminRefundSubscriptionPayment(request)).resolves.toEqual({
      data: { refunded: true, chargeId: latestChargeId },
    });
    await expect(adminRefundSubscriptionPayment(request)).resolves.toEqual({
      data: { refunded: true, alreadyRecorded: true, chargeId: latestChargeId },
    });

    expect(refundProviderPaymentMock).not.toHaveBeenCalled();
    expect(mockDb.subscriptionCharge.updateMany).toHaveBeenCalledTimes(1);
    expect(mockDb.subscriptionCharge.updateMany).toHaveBeenCalledWith({
      where: { id: latestChargeId, refundedAt: null },
      data: expect.objectContaining({ refundEventId: `admin:${operationId}` }),
    });
    expect(older.refundedAt).toBeNull();
  });

  it("does not repeat an in-app provider refund when the same confirmation is submitted again", async () => {
    capabilitiesMock.mockReturnValue({ supportsInAppRefunds: true });
    const latest = {
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-later",
      amount: 4999,
      currency: "gbp",
      refundedAt: null as Date | null,
      refundEventId: null as string | null,
    };
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(),
      charges: [
        {
          id: olderChargeId,
          eventTimestamp: new Date("2030-11-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
        {
          id: latest.id,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: latest.amount,
          currency: latest.currency,
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === latest.id ? latest : null,
    );
    mockDb.subscriptionCharge.updateMany.mockImplementation(async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { refundedAt: Date; refundEventId: string };
    }) => {
      if (where.id !== latest.id || latest.refundedAt) return { count: 0 };
      latest.refundedAt = data.refundedAt;
      latest.refundEventId = data.refundEventId;
      return { count: 1 };
    });

    const request = refundRequest("DUPLICATE", latestChargeId);
    await adminRefundSubscriptionPayment(request);
    await adminRefundSubscriptionPayment(request);

    expect(refundProviderPaymentMock).toHaveBeenCalledTimes(1);
    expect(refundProviderPaymentMock).toHaveBeenCalledWith("pay-later");
    expect(mockDb.subscriptionCharge.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not repeat the provider call when local recording hits a serialization conflict", async () => {
    capabilitiesMock.mockReturnValue({ supportsInAppRefunds: true });
    mockDb.subscription.findUnique.mockResolvedValue({
      ...paidSubscription(),
      charges: [
        {
          id: latestChargeId,
          eventTimestamp: new Date("2030-12-15T00:00:00.000Z"),
          amount: 4999,
          currency: "gbp",
          refundedAt: null,
        },
      ],
    });
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId,
      paymentReference: "pay-1",
      amount: 4999,
      currency: "gbp",
      refundedAt: null,
      refundEventId: null,
    });
    let attempts = 0;
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => Promise<unknown>) => {
      attempts += 1;
      const result = await callback(mockDb);
      if (attempts === 2) {
        throw new Prisma.PrismaClientKnownRequestError("write conflict", {
          code: "P2034",
          clientVersion: "test",
        });
      }
      return result;
    });

    await expect(adminRefundSubscriptionPayment(refundRequest("DUPLICATE"))).resolves.toEqual({
      data: { refunded: true, chargeId: latestChargeId },
    });
    expect(refundProviderPaymentMock).toHaveBeenCalledTimes(1);
    expect(attempts).toBe(3);
    expect(mockDb.subscriptionCharge.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ refundedAt: null }),
        orderBy: { eventTimestamp: "desc" },
      }),
    );
  });

  it("rejects a charge that belongs to another subscription before any refund", async () => {
    mockDb.subscription.findUnique.mockResolvedValue(paidSubscription());
    mockDb.subscriptionCharge.findUnique.mockResolvedValue({
      id: latestChargeId,
      subscriptionId: "clccccccccccccccccccccccc",
      paymentReference: "pay-other",
      amount: 4999,
      currency: "gbp",
      refundedAt: null,
      refundEventId: null,
    });

    await expect(adminRefundSubscriptionPayment(refundRequest())).resolves.toEqual({
      error: "That payment does not belong to this subscription.",
    });
    expect(refundProviderPaymentMock).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
