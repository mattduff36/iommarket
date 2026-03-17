export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Check } from "lucide-react";
import {
  getFreeLaunchSlotsRemaining,
  getFreeLaunchSlotsTotal,
} from "@/lib/config/marketplace";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple pricing for sellers and dealers on itrader.im.",
};

const SELLER_FEATURES = [
  "30-day listing duration",
  "Up to 10 photos",
  "Contact form included",
  "Moderation within 1-2 days",
  "Renew for another £4.99",
  "Option to upgrade to a featured listing",
  "Optional £5 support contribution at checkout",
];

const DEALER_STARTER_FEATURES = [
  "Up to 10 active listings",
  "Dedicated dealer profile page",
  "Up to 20 photos per listing",
  "Priority moderation",
  "Phone number displayed",
  "Cancel anytime",
];

const DEALER_PRO_FEATURES = [
  "Up to 30 active listings",
  "All Starter features",
  "Priority moderation",
  "Dealer dashboard",
  "Ideal for larger inventories",
  "Cancel anytime",
];

const FREE_LAUNCH_FEATURES = [
  "One free listing per person",
  "30-day listing duration",
  "Up to 10 photos",
  "Contact form included",
  "Moderation within 1-2 days",
];

export default async function PricingPage() {
  const [slotsRemaining, slotsTotal] = await Promise.all([
    getFreeLaunchSlotsRemaining(),
    getFreeLaunchSlotsTotal(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
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

      <div className="flex flex-col gap-6 w-full">
        {/* Free Launch Offer - First 100 */}
        {slotsRemaining > 0 && (
          <Card className="flex flex-row items-center p-4 ring-2 ring-premium-gold-500 shadow-high w-full min-h-[7rem]">
            <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
              <CardTitle className="text-lg text-premium-gold-500">
                Free Launch Offer
              </CardTitle>
              <CardDescription className="text-left">
                FREE private seller listing for the first {slotsTotal} people only
              </CardDescription>
              <div className="mt-2">
                <span className="text-2xl font-bold text-premium-gold-500">
                  £0
                </span>
                <span className="text-text-secondary text-xs"> / listing</span>
              </div>
              <p className="text-sm font-semibold text-premium-gold-500 mt-1">
                {slotsRemaining} spots left
              </p>
              <Button asChild variant="energy" size="sm" className="mt-3">
                <Link href="/sell/private">Claim Your Free Listing</Link>
              </Button>
            </div>
            <CardContent className="flex flex-1 flex-wrap gap-x-6 gap-y-1 p-0">
              {FREE_LAUNCH_FEATURES.map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-xs">
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-premium-gold-500/10">
                    <Check className="h-2.5 w-2.5 text-premium-gold-500" />
                  </div>
                  <span className="text-text-secondary">{feature}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Private Seller */}
        <Card className="flex flex-row items-center p-4 ring-2 ring-neon-blue-500 shadow-high w-full min-h-[7rem]">
          <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
            <CardTitle className="text-lg">
              Private Seller{" "}
              <span className="font-normal text-text-tertiary">
                - (Choose to support a new local business!)
              </span>
            </CardTitle>
            <CardDescription className="text-left">
              Perfect for selling individual items
            </CardDescription>
            <div className="mt-2">
              <span className="text-2xl font-bold text-text-primary">
                £4.99
              </span>
              <span className="text-text-secondary text-xs"> / listing</span>
            </div>
            <Button asChild variant="trust" size="sm" className="mt-3">
              <Link href="/sell/private">List an Item</Link>
            </Button>
          </div>
          <CardContent className="flex flex-1 flex-wrap gap-x-6 gap-y-1 p-0">
            {SELLER_FEATURES.map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-xs">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10">
                  <Check className="h-2.5 w-2.5 text-neon-blue-500" />
                </div>
                <span className="text-text-secondary">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Dealer tiers */}
        <Card className="flex flex-row items-center p-4 ring-2 ring-red-500 shadow-high w-full min-h-[7rem]">
          <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
            <CardTitle className="text-lg">Dealer Starter</CardTitle>
            <CardDescription className="text-left">
              For smaller dealerships getting started
            </CardDescription>
            <div className="mt-2">
              <span className="text-2xl font-bold text-text-primary">
                £29.99
              </span>
              <span className="text-text-secondary text-xs"> / month</span>
            </div>
            <Button asChild variant="energy" size="sm" className="mt-3">
              <Link href="/sell/dealer">Choose Starter</Link>
            </Button>
          </div>
          <CardContent className="flex flex-1 flex-wrap gap-x-6 gap-y-1 p-0">
            {DEALER_STARTER_FEATURES.map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-xs">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                  <Check className="h-2.5 w-2.5 text-red-500" />
                </div>
                <span className="text-text-secondary">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="flex flex-row items-center p-4 ring-2 ring-neon-blue-500 shadow-high w-full min-h-[7rem]">
          <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
            <CardTitle className="text-lg">Dealer Pro</CardTitle>
            <CardDescription className="text-left">
              For dealers with larger monthly inventory
            </CardDescription>
            <div className="mt-2">
              <span className="text-2xl font-bold text-text-primary">
                £49.99
              </span>
              <span className="text-text-secondary text-xs"> / month</span>
            </div>
            <Button asChild variant="trust" size="sm" className="mt-3">
              <Link href="/sell/dealer">Choose Pro</Link>
            </Button>
          </div>
          <CardContent className="flex flex-1 flex-wrap gap-x-6 gap-y-1 p-0">
            {DEALER_PRO_FEATURES.map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-xs">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10">
                  <Check className="h-2.5 w-2.5 text-neon-blue-500" />
                </div>
                <span className="text-text-secondary">{feature}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
