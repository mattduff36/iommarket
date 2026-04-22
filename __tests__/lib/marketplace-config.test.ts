import { beforeEach, describe, expect, it } from "vitest";
import {
  getListingFeePence,
  getPrivateListingPaymentLinkUrl,
  getLaunchFreeUntil,
  isListingFreeNow,
} from "@/lib/config/marketplace";

describe("marketplace config", () => {
  beforeEach(() => {
    delete process.env.LISTING_FEE_PENCE;
    delete process.env.RIPPLE_LISTING_PAYMENT_URL;
    delete process.env.LAUNCH_FREE_UNTIL;
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
});
