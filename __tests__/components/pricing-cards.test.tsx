import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DEALER_PRO_FEATURES,
  DEALER_STARTER_FEATURES,
  getFreeLaunchFeatures,
  getSellerFeatures,
  PricingCards,
} from "@/components/pricing/pricing-cards";
import { getDealerListingCapFeature } from "@/lib/config/dealer-tiers";

const pricing = {
  privateListingPence: 749,
  featuredUpgradePence: 875,
  dealerStarterMonthlyPence: 3999,
  dealerProMonthlyPence: 5999,
  optionalListingSupportPence: 500,
};

describe("PricingCards", () => {
  it("renders each plan's features as accessible list rows", () => {
    render(
      <PricingCards
        pricing={pricing}
        showFreeOffer
        slotsRemaining={198}
        slotsTotal={200}
        freeLaunchCta={{ href: "/sell/private", label: "Claim Your Free Listing" }}
        privateSellerCta={{ href: "/sell/private", label: "List an Item" }}
        dealerStarterCta={{ href: "/dealer/subscribe?tier=STARTER", label: "Choose Starter" }}
        dealerProCta={{ href: "/dealer/subscribe?tier=PRO", label: "Choose Pro" }}
      />,
    );

    const featureCount =
      getFreeLaunchFeatures(pricing).length +
      getSellerFeatures(pricing).length +
      DEALER_STARTER_FEATURES.length +
      DEALER_PRO_FEATURES.length;

    expect(screen.getAllByRole("list")).toHaveLength(4);
    expect(screen.getAllByRole("listitem")).toHaveLength(featureCount);
    expect(screen.getAllByText("60-day listing duration")).toHaveLength(2);
    const planLinks = [
      screen.getByRole("link", { name: "Claim Your Free Listing" }),
      screen.getByRole("link", { name: "List an Item" }),
      screen.getByRole("link", { name: "Choose Starter" }),
      screen.getByRole("link", { name: "Choose Pro" }),
    ];
    expect(planLinks[0].getAttribute("href")).toBe("/sell/private");
    expect(planLinks[1].getAttribute("href")).toBe("/sell/private");
    expect(planLinks[2].getAttribute("href")).toBe("/dealer/subscribe?tier=STARTER");
    expect(planLinks[3].getAttribute("href")).toBe("/dealer/subscribe?tier=PRO");
    for (const link of planLinks) {
      expect(link.querySelector("a, button")).toBeNull();
    }
    expect(screen.getByText("Claim Your Free Listing").className).toContain("h-9");
    expect(screen.getByText("£39.99")).toBeTruthy();
    expect(screen.getByText("£59.99")).toBeTruthy();
  });

  it("uses supplied prices for cards and renewal/featured copy", () => {
    expect(getSellerFeatures(pricing)).toEqual([
      "Private seller listing",
      "60-day listing duration",
      "Up to 10 photos",
      "Contact form included",
      "Moderation within 1-2 days",
      "Renew for another £7.49",
      "Upgrade to featured listing for £8.75",
    ]);
    expect(getFreeLaunchFeatures(pricing)).toEqual([
      "Private seller listing - free",
      ...getSellerFeatures(pricing).slice(1),
    ]);
  });

  it("advertises dealer listing caps from the shared tier helper", () => {
    expect(DEALER_STARTER_FEATURES[0]).toBe(getDealerListingCapFeature("STARTER"));
    expect(DEALER_PRO_FEATURES[0]).toBe(getDealerListingCapFeature("PRO"));
  });
});
