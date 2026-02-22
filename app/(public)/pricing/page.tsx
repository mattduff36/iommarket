export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Check } from "lucide-react";

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
];

const DEALER_FEATURES = [
  "Unlimited active listings",
  "Dedicated dealer profile page",
  "Up to 20 photos per listing",
  "Priority moderation",
  "Analytics dashboard",
  "Phone number displayed",
  "Cancel anytime",
];

export default function PricingPage() {
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
        <p className="mt-4 inline-block rounded-lg border border-premium-gold-500/40 bg-premium-gold-500/10 px-4 py-3 text-base font-semibold text-premium-gold-500">
          Launch offer: all listings are currently FREE for a limited time only…
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 max-w-3xl mx-auto items-stretch">
        {/* Private Seller */}
        <Card className="flex flex-col p-2 h-full ring-2 ring-neon-blue-500 shadow-high">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Private Seller</CardTitle>
            <CardDescription>
              Perfect for selling individual items
            </CardDescription>
            <div className="mt-6">
              <span className="text-4xl font-bold text-text-primary">
                £4.99
              </span>
              <span className="text-text-secondary text-sm"> / listing</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <ul className="flex-1 space-y-4">
              {SELLER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10">
                    <Check className="h-3 w-3 text-neon-blue-500" />
                  </div>
                  <span className="text-text-secondary">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="trust" className="w-full mt-8">
              <Link href="/sell">List an Item</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Dealer */}
        <Card className="flex flex-col p-2 h-full ring-2 ring-red-500 shadow-high">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Dealer</CardTitle>
            <CardDescription>
              For businesses with multiple items to sell
            </CardDescription>
            <div className="mt-6">
              <span className="text-4xl font-bold text-text-primary">
                £29.99
              </span>
              <span className="text-text-secondary text-sm"> / month</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <ul className="flex-1 space-y-4">
              {DEALER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                    <Check className="h-3 w-3 text-red-500" />
                  </div>
                  <span className="text-text-secondary">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="energy" className="w-full mt-8">
              <Link href="/sell">Get Started</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
