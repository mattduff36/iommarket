export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import {
  getFreeLaunchSlotsRemaining,
  getFreeLaunchSlotsTotal,
  isListingFreeNowAsync,
} from "@/lib/config/marketplace";
import { getMarketplacePricing } from "@/lib/config/marketplace-pricing";
import { getCurrentUser } from "@/lib/auth";
import { PricingCards } from "@/components/pricing/pricing-cards";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple pricing for sellers and dealers on itrader.im.",
};

export default async function PricingPage() {
  const [slotsRemaining, slotsTotal, isFreeWindowActive, user, pricing] = await Promise.all([
    getFreeLaunchSlotsRemaining(),
    getFreeLaunchSlotsTotal(),
    isListingFreeNowAsync(),
    getCurrentUser(),
    getMarketplacePricing(),
  ]);
  const showFreeOffer = isFreeWindowActive || slotsRemaining > 0;
  const signUpWithNext = (href: string) =>
    `/sign-up?next=${encodeURIComponent(href)}`;
  const cta = (href: string, label: string) =>
    user ? { href, label } : { href: signUpWithNext(href), label: "Sign Up" };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
      <div className="mb-10 text-center sm:mb-16">
        <p className="text-sm font-semibold uppercase tracking-widest text-neon-blue-500">
          Pricing
        </p>
        <h1 className="mt-3 text-3xl font-bold text-text-primary font-heading sm:text-4xl">
          Simple, Transparent Pricing
        </h1>
        <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
          No hidden fees. Just straightforward pricing for Isle of Man sellers.
        </p>
      </div>

      <PricingCards
        pricing={pricing}
        showFreeOffer={showFreeOffer}
        slotsRemaining={slotsRemaining}
        slotsTotal={slotsTotal}
        freeLaunchCta={cta("/sell/private", "Claim Your Free Listing")}
        privateSellerCta={cta("/sell/private", "List an Item")}
        dealerStarterCta={cta("/dealer/subscribe?tier=STARTER", "Choose Starter")}
        dealerProCta={cta("/dealer/subscribe?tier=PRO", "Choose Pro")}
      />
    </div>
  );
}
