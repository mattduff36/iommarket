import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const { getNumberSettingMock, getStringSettingMock, mockDb } = vi.hoisted(() => ({
  getNumberSettingMock: vi.fn(),
  getStringSettingMock: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    freeListingClaim: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    listing: {
      findMany: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mockDb,
}));

vi.mock("@/lib/config/site-settings", () => ({
  SETTING_KEYS: {
    LISTING_FEE_PENCE: "listing_fee_pence",
    FEATURED_FEE_PENCE: "featured_fee_pence",
    FREE_LISTING_WINDOW_DAYS: "free_listing_window_days",
    LAUNCH_FREE_UNTIL: "launch_free_until",
    FREE_LAUNCH_SLOTS_TOTAL: "free_launch_slots_total",
  },
  getNumberSetting: getNumberSettingMock,
  getStringSetting: getStringSettingMock,
}));

import {
  claimFreeListingSlot,
  getFreeLaunchSlotsTotal,
  getPrivateListingPaymentLinkUrl,
  getLaunchFreeUntil,
  isPrivateListingFreeForUser,
  isListingFreeNow,
} from "@/lib/config/marketplace";

describe("marketplace config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RIPPLE_LISTING_PAYMENT_URL;
    delete process.env.LAUNCH_FREE_UNTIL;
    getNumberSettingMock.mockImplementation(async (_key: string, fallback: number) => fallback);
    getStringSettingMock.mockImplementation(async (_key: string, fallback: string) => fallback);
    mockDb.payment.findMany.mockResolvedValue([]);
    mockDb.listing.findMany.mockResolvedValue([]);
    mockDb.freeListingClaim.count.mockResolvedValue(0);
    mockDb.freeListingClaim.findUnique.mockResolvedValue(null);
    mockDb.freeListingClaim.create.mockResolvedValue({ id: "claim_1" });
    mockDb.$transaction.mockImplementation(async (callback) => callback(mockDb));
  });

  it("reads the private listing Ripple payment link from env", () => {
    process.env.RIPPLE_LISTING_PAYMENT_URL = "https://portal.startyourripple.co.uk/pay/listing";
    expect(getPrivateListingPaymentLinkUrl()).toBe(
      "https://portal.startyourripple.co.uk/pay/listing"
    );
  });

  it("detects free window from launch date env", () => {
    process.env.LAUNCH_FREE_UNTIL = "2099-01-01T00:00:00.000Z";
    expect(getLaunchFreeUntil()).not.toBeNull();
    expect(isListingFreeNow(new Date("2080-01-01T00:00:00.000Z"))).toBe(true);
    expect(isListingFreeNow(new Date("2100-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("defaults the free launch allotment to 200 listings", async () => {
    await expect(getFreeLaunchSlotsTotal()).resolves.toBe(200);
  });

  it("does not grant another free listing during the launch window", async () => {
    getStringSettingMock.mockImplementation(async (key: string, fallback: string) =>
      key === "launch_free_until" ? "2099-01-01T00:00:00.000Z" : fallback
    );
    mockDb.freeListingClaim.findUnique.mockResolvedValue({ id: "claim_1" });

    await expect(isPrivateListingFreeForUser("user_1")).resolves.toBe(false);
  });

  it("requires an available slot even when the launch window is active", async () => {
    getStringSettingMock.mockImplementation(async (key: string, fallback: string) =>
      key === "launch_free_until" ? "2099-01-01T00:00:00.000Z" : fallback
    );
    mockDb.freeListingClaim.count.mockResolvedValue(200);

    await expect(isPrivateListingFreeForUser("user_1")).resolves.toBe(false);
  });

  it("claims one free slot only after the related submission succeeds", async () => {
    const operations: string[] = [];
    const onClaim = vi.fn().mockImplementation(async () => {
      operations.push("submission");
      return { id: "listing_1", status: "PENDING" };
    });
    mockDb.freeListingClaim.create.mockImplementation(async () => {
      operations.push("claim");
      return { id: "claim_1" };
    });

    await expect(
      claimFreeListingSlot({
        userId: "user_1",
        listingId: "listing_1",
        onClaim,
      })
    ).resolves.toEqual({
      status: "claimed",
      data: { id: "listing_1", status: "PENDING" },
    });

    expect(onClaim).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["submission", "claim"]);
    expect(mockDb.freeListingClaim.create).toHaveBeenCalledWith({
      data: { userId: "user_1", listingId: "listing_1" },
    });
  });

  it("does not submit or decrement when the account already has a claim", async () => {
    mockDb.freeListingClaim.findUnique.mockResolvedValue({ id: "claim_1" });
    const onClaim = vi.fn();

    await expect(
      claimFreeListingSlot({
        userId: "user_1",
        listingId: "listing_2",
        onClaim,
      })
    ).resolves.toEqual({ status: "already-claimed" });

    expect(onClaim).not.toHaveBeenCalled();
    expect(mockDb.freeListingClaim.create).not.toHaveBeenCalled();
  });

  it("does not create a claim when submission fails", async () => {
    const onClaim = vi.fn().mockRejectedValue(new Error("submission failed"));

    await expect(
      claimFreeListingSlot({
        userId: "user_1",
        listingId: "listing_1",
        onClaim,
      })
    ).rejects.toThrow("submission failed");

    expect(mockDb.freeListingClaim.create).not.toHaveBeenCalled();
  });
});
