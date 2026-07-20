import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const { getNumberSettingMock, getStringSettingMock, mockDb } = vi.hoisted(() => ({
  getNumberSettingMock: vi.fn(),
  getStringSettingMock: vi.fn(),
  mockDb: {
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
  getFreeLaunchSlotsTotal,
  getListingFeePence,
  getPrivateListingPaymentLinkUrl,
  getLaunchFreeUntil,
  isPrivateListingFreeForUser,
  isListingFreeNow,
} from "@/lib/config/marketplace";

describe("marketplace config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LISTING_FEE_PENCE;
    delete process.env.RIPPLE_LISTING_PAYMENT_URL;
    delete process.env.LAUNCH_FREE_UNTIL;
    getNumberSettingMock.mockImplementation(async (_key: string, fallback: number) => fallback);
    getStringSettingMock.mockImplementation(async (_key: string, fallback: string) => fallback);
    mockDb.payment.findMany.mockResolvedValue([]);
    mockDb.listing.findMany.mockResolvedValue([]);
  });

  it("uses default listing fee when env is unset", () => {
    expect(getListingFeePence()).toBe(499);
  });

  it("parses listing fee from env", () => {
    process.env.LISTING_FEE_PENCE = "750";
    expect(getListingFeePence()).toBe(750);
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
    mockDb.listing.findMany.mockResolvedValue([{ id: "listing_1" }]);

    await expect(isPrivateListingFreeForUser("user_1")).resolves.toBe(false);
  });
});
