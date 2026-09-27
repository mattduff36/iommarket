import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAcceptedAuthMock,
  requireRoleMock,
  createCancellationMock,
  transitionCancellationMock,
  sendCancellationMock,
  mockDb,
} = vi.hoisted(() => ({
  requireAcceptedAuthMock: vi.fn(),
  requireRoleMock: vi.fn(),
  createCancellationMock: vi.fn(),
  transitionCancellationMock: vi.fn(),
  sendCancellationMock: vi.fn(),
  mockDb: {
    dealerCancellationRequest: { findUnique: vi.fn(), findFirst: vi.fn() },
    dealerCorrespondenceSettings: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAcceptedAuthMock,
}));

vi.mock("@/lib/auth", () => ({
  requireRole: requireRoleMock,
}));

vi.mock("@/lib/policy/cancellation", () => ({
  createDealerCancellationRequest: createCancellationMock,
  transitionDealerCancellationRequest: transitionCancellationMock,
  CancellationError: class CancellationError extends Error {},
}));

vi.mock("@/lib/email/cancellation-notifications", () => ({
  sendCancellationStatusEmail: sendCancellationMock,
}));

vi.mock("@/lib/monitoring", () => ({
  reportHandledException: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { processDealerCancellationRequest } from "@/actions/admin/cancellations";
import { requestDealerCancellation } from "@/actions/dealer/cancellation";

const requestId = "cllisting123456789012345678";

describe("cancellation correspondence routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAcceptedAuthMock.mockResolvedValue({
      id: "dealer-user",
      role: "DEALER",
      email: "owner@dealer.example",
      dealerProfile: { id: "dealer-1", name: "Isle Cars" },
    });
    requireRoleMock.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    createCancellationMock.mockResolvedValue({
      created: true,
      request: { id: requestId, status: "REQUESTED", periodEndAt: null },
    });
    transitionCancellationMock.mockResolvedValue({
      request: { id: requestId, status: "ACKNOWLEDGED" },
    });
    mockDb.dealerCancellationRequest.findUnique.mockResolvedValue({
      id: requestId,
      status: "ACKNOWLEDGED",
      periodEndAt: null,
      dealer: {
        id: "dealer-1",
        name: "Isle Cars",
        user: { email: "owner@dealer.example" },
      },
    });
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: "accounts@dealer.example",
      categories: ["SUBSCRIPTION"],
      copyAssignedToPrimary: false,
    });
  });

  it("sends a dealer cancellation request to the selected second address", async () => {
    await requestDealerCancellation({ confirmation: true });

    expect(sendCancellationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["accounts@dealer.example"],
        status: "REQUESTED",
      }),
    );
  });

  it("sends a staff cancellation update to the same selected address", async () => {
    await processDealerCancellationRequest({
      requestId,
      action: "ACKNOWLEDGE",
    });

    expect(sendCancellationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["accounts@dealer.example"],
        status: "ACKNOWLEDGED",
      }),
    );
  });

  it("keeps an unselected cancellation on the login address", async () => {
    mockDb.dealerCorrespondenceSettings.findUnique.mockResolvedValue({
      verifiedEmail: "accounts@dealer.example",
      categories: ["BUYER_ENQUIRIES"],
      copyAssignedToPrimary: false,
    });

    await requestDealerCancellation({ confirmation: true });

    expect(sendCancellationMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["owner@dealer.example"] }),
    );
  });
});
