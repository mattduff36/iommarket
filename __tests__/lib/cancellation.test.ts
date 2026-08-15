import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    subscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dealerCancellationRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    dealerCancellationRequestEvent: {
      create: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/policy/flags", () => ({
  getPolicyFlags: () => ({ enableCancellationRequests: true }),
}));

import {
  canTransitionCancellation,
  createDealerCancellationRequest,
  transitionDealerCancellationRequest,
} from "@/lib/policy/cancellation";

describe("dealer cancellation POL-CANCEL-001", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
    );
  });

  it("allows only the locked status transitions", () => {
    expect(canTransitionCancellation("REQUESTED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionCancellation("REQUESTED", "RECONCILED")).toBe(true);
    expect(canTransitionCancellation("REQUESTED", "REJECTED")).toBe(true);
    expect(canTransitionCancellation("ACKNOWLEDGED", "RECONCILED")).toBe(true);
    expect(canTransitionCancellation("RECONCILED", "COMPLETED")).toBe(true);
    expect(canTransitionCancellation("REQUESTED", "COMPLETED")).toBe(false);
    expect(canTransitionCancellation("COMPLETED", "REQUESTED")).toBe(false);
  });

  it("returns an existing open request instead of creating a duplicate", async () => {
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      providerLifecycle: "ACTIVE",
    });
    mockDb.dealerCancellationRequest.findFirst.mockResolvedValue({
      id: "req-1",
      status: "REQUESTED",
    });

    const result = await createDealerCancellationRequest({
      dealerId: "dealer-1",
      requestedByUserId: "user-1",
    });

    expect(result.created).toBe(false);
    expect(result.request.id).toBe("req-1");
    expect(mockDb.dealerCancellationRequest.create).not.toHaveBeenCalled();
  });

  it("creates a reconciled request when the provider is already cancelled but still entitled", async () => {
    mockDb.subscription.findFirst.mockResolvedValue({
      id: "sub-1",
      status: "CANCELLED",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      providerLifecycle: "CANCELLED",
    });
    mockDb.dealerCancellationRequest.findFirst.mockResolvedValue(null);
    mockDb.dealerCancellationRequest.create.mockResolvedValue({
      id: "req-2",
      status: "RECONCILED",
      periodEndAt: new Date(),
    });

    const result = await createDealerCancellationRequest({
      dealerId: "dealer-1",
      requestedByUserId: "user-1",
    });

    expect(result.created).toBe(true);
    expect(mockDb.dealerCancellationRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RECONCILED" }),
      }),
    );
    expect(mockDb.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cancelAtPeriodEnd: true },
      }),
    );
  });

  it("sets local period-end cancellation on acknowledge without claiming provider success", async () => {
    mockDb.dealerCancellationRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "REQUESTED",
      subscriptionId: "sub-1",
      notes: null,
      processedByAdminId: null,
      subscription: {
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        providerLifecycle: "ACTIVE",
      },
    });
    mockDb.dealerCancellationRequest.updateMany.mockResolvedValue({ count: 1 });
    mockDb.dealerCancellationRequest.findUniqueOrThrow.mockResolvedValue({
      id: "req-1",
      status: "ACKNOWLEDGED",
    });

    await transitionDealerCancellationRequest({
      requestId: "req-1",
      toStatus: "ACKNOWLEDGED",
      actorUserId: "admin-1",
      source: "STAFF",
    });

    expect(mockDb.subscription.update).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { cancelAtPeriodEnd: true },
    });
    expect(mockDb.adminAuditLog.create).toHaveBeenCalled();
  });

  it("refuses staff reconciliation before the provider is cancelled", async () => {
    mockDb.dealerCancellationRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "ACKNOWLEDGED",
      subscriptionId: "sub-1",
      notes: null,
      processedByAdminId: "admin-1",
      subscription: {
        status: "ACTIVE",
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        providerLifecycle: "ACTIVE",
      },
    });

    await expect(
      transitionDealerCancellationRequest({
        requestId: "req-1",
        toStatus: "RECONCILED",
        source: "STAFF",
        actorUserId: "admin-1",
      }),
    ).rejects.toThrow("already be cancelled");
    expect(mockDb.dealerCancellationRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuses completion while the paid period is still active", async () => {
    mockDb.dealerCancellationRequest.findUnique.mockResolvedValue({
      id: "req-1",
      status: "RECONCILED",
      subscriptionId: "sub-1",
      notes: null,
      processedByAdminId: "admin-1",
      subscription: {
        status: "CANCELLED",
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        providerLifecycle: "CANCELLED",
      },
    });

    await expect(
      transitionDealerCancellationRequest({
        requestId: "req-1",
        toStatus: "COMPLETED",
        source: "STAFF",
        actorUserId: "admin-1",
      }),
    ).rejects.toThrow("expired paid period");
  });
});
