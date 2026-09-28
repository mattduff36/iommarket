import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAuthMock,
  acceptPendingDealerUpgradeOfferMock,
  revalidatePathMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  acceptPendingDealerUpgradeOfferMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/policy/gate", () => ({
  requireAcceptedAuth: requireAuthMock,
}));
vi.mock("@/lib/dealers/upgrade-offers", () => ({
  acceptPendingDealerUpgradeOffer: acceptPendingDealerUpgradeOfferMock,
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/monitoring", () => ({
  captureException: captureExceptionMock,
}));

describe("acceptDealerUpgrade", () => {
  const offerId = "clofferxxxxxxxxxxxxxxxxxxx";
  const policyDigest = "a".repeat(64);

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      id: "cluserxxxxxxxxxxxxxxxxxxxxxx",
      role: "USER",
    });
    acceptPendingDealerUpgradeOfferMock.mockResolvedValue({
      kind: "accepted",
      dealerId: "cldealerxxxxxxxxxxxxxxxxxxx",
      grantEndsAt: new Date("2027-01-01T00:00:00.000Z"),
    });
  });

  it("requires explicit dealer policy acceptance", async () => {
    const { acceptDealerUpgrade } = await import("@/actions/dealer-upgrade");

    const result = await acceptDealerUpgrade({
      offerId,
      policyDigest,
      dealerPoliciesAccepted: false as true,
    });

    expect(result).toEqual({
      error: expect.objectContaining({
        dealerPoliciesAccepted: expect.arrayContaining([expect.any(String)]),
      }),
    });
    expect(acceptPendingDealerUpgradeOfferMock).not.toHaveBeenCalled();
  });

  it("activates only the authenticated user's pending offer", async () => {
    const { acceptDealerUpgrade } = await import("@/actions/dealer-upgrade");

    await expect(
      acceptDealerUpgrade({ offerId, policyDigest, dealerPoliciesAccepted: true }),
    ).resolves.toEqual({
      data: { success: true, alreadyAccepted: false },
    });
    expect(acceptPendingDealerUpgradeOfferMock).toHaveBeenCalledWith({
      userId: "cluserxxxxxxxxxxxxxxxxxxxxxx",
      offerId,
      policyDigest,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dealer/profile");
  });

  it("returns a safe error when the offer is no longer pending", async () => {
    acceptPendingDealerUpgradeOfferMock.mockResolvedValueOnce({
      kind: "not-pending",
    });
    const { acceptDealerUpgrade } = await import("@/actions/dealer-upgrade");

    await expect(
      acceptDealerUpgrade({ offerId, policyDigest, dealerPoliciesAccepted: true }),
    ).resolves.toEqual({
      error: "This dealer upgrade offer is no longer available.",
    });
  });

  it("requires current account-policy acceptance", async () => {
    requireAuthMock.mockRejectedValueOnce(
      new Error("Current policy acceptance is required."),
    );
    const { acceptDealerUpgrade } = await import("@/actions/dealer-upgrade");

    await expect(
      acceptDealerUpgrade({ offerId, policyDigest, dealerPoliciesAccepted: true }),
    ).rejects.toThrow("Current policy acceptance is required.");
    expect(acceptPendingDealerUpgradeOfferMock).not.toHaveBeenCalled();
  });
});
