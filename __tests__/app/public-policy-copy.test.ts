import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEALER_PRO_FEATURES,
  DEALER_STARTER_FEATURES,
  getSellerFeatures,
} from "@/components/pricing/pricing-cards";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const pricing = {
  privateListingPence: 499,
  featuredUpgradePence: 500,
  dealerStarterMonthlyPence: 2999,
  dealerProMonthlyPence: 4999,
  optionalListingSupportPence: 500,
};

describe("public policy copy", () => {
  it("POL-MOD-001 does not promise a moderation time", () => {
    const success = source("app/(public)/sell/success/page.tsx");
    const sellerFeatures = getSellerFeatures(pricing).join(" ");
    expect(success).not.toMatch(/1-2|1–2/);
    expect(success).toContain("does not promise a review time");
    expect(sellerFeatures).not.toMatch(/1-2|1–2|priority moderation/i);
    expect(source("app/(public)/dealer/subscribe/page.tsx")).not.toMatch(/priority moderation/i);
  });

  it("POL-GEO-001 describes Isle of Man-first search with UK locations", () => {
    const search = source("app/(public)/search/page.tsx");
    const pricingPage = source("app/(public)/pricing/page.tsx");
    const faq = source("lib/faq/categories-marketplace.ts");
    expect(search).toContain("Isle of Man and the United Kingdom");
    expect(pricingPage).toContain("United Kingdom");
    expect(pricingPage).toContain("current launch offer");
    expect(faq).toContain("Isle of Man or the United Kingdom");
    expect(faq).not.toContain("advertising a vehicle located here");
  });

  it("POL-ROLE-001 keeps dealer and private selling separate", () => {
    const signUp = source("components/auth/sign-up-with-plans.tsx");
    const account = source("app/(public)/account/page.tsx");
    expect(signUp).not.toContain("Private selling stays available");
    expect(signUp).not.toContain("post a private listing at any time");
    expect(signUp).toContain("does not also post private listings");
    expect(account).toContain("Start a dealer listing");
    expect(account).toContain("Start selling privately");
  });

  it("POL-DASH-001 offers the dashboard on Starter and Pro", () => {
    expect(DEALER_STARTER_FEATURES).toContain("Dealer dashboard");
    expect(DEALER_PRO_FEATURES).toContain("Dealer dashboard");
  });
});
