import { beforeEach, describe, expect, it, vi } from "vitest";

const { dealerFindFirstMock } = vi.hoisted(() => ({
  dealerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    siteSetting: { findMany: vi.fn().mockResolvedValue([]) },
    dealerProfile: {
      findFirst: dealerFindFirstMock,
    },
  },
}));

import {
  hasPublicListingSellerAccess,
  publicListingSellerWhere,
} from "@/lib/listings/dealer-visibility";

describe("public listing seller visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires every listing owner to be enabled and undeleted", () => {
    const where = publicListingSellerWhere(
      new Date("2026-10-02T10:00:00.000Z"),
    );

    expect(where).toMatchObject({
      user: {
        disabledAt: null,
        deletedAt: null,
      },
      OR: [
        { dealerId: null },
        {
          dealer: {
            is: {
              user: {
                disabledAt: null,
                deletedAt: null,
              },
            },
          },
        },
      ],
    });
  });

  it("hides disabled private and dealer listings and restores access when enabled", async () => {
    dealerFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "dealer-enabled" });

    await expect(
      hasPublicListingSellerAccess(null, true, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess(null, false, false),
    ).resolves.toBe(true);
    await expect(
      hasPublicListingSellerAccess("dealer-disabled", true, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess("dealer-expired", false, false),
    ).resolves.toBe(false);
    await expect(
      hasPublicListingSellerAccess("dealer-enabled", false, false),
    ).resolves.toBe(true);

    expect(dealerFindFirstMock).toHaveBeenCalledTimes(2);
    expect(dealerFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: "dealer-enabled" },
          {
            user: {
              role: { in: ["DEALER", "ADMIN"] },
              disabledAt: null,
              deletedAt: null,
            },
            subscriptions: {
              some: { OR: expect.any(Array) },
            },
          },
        ],
      },
      select: { id: true },
    });
  });
});
