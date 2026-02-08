export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple pricing for sellers and dealers on IOM Market.",
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
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-text-primary">
          Simple, Transparent Pricing
        </h1>
        <p className="mt-2 text-text-secondary">
          No hidden fees. Just straightforward pricing for Isle of Man sellers.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 max-w-3xl mx-auto">
        {/* Private Seller */}
        <Card>
          <CardHeader>
            <CardTitle>Private Seller</CardTitle>
            <CardDescription>
              Perfect for selling individual items
            </CardDescription>
            <div className="mt-4">
              <span className="text-3xl font-bold text-text-primary">
                £4.99
              </span>
              <span className="text-text-secondary text-sm"> / listing</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {SELLER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                  <span className="text-text-primary">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild className="w-full mt-6">
              <Link href="/sell">List an Item</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Dealer */}
        <Card className="relative ring-2 ring-royal-500">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Badge variant="info">Most Popular</Badge>
          </div>
          <CardHeader>
            <CardTitle>Dealer</CardTitle>
            <CardDescription>
              For businesses with multiple items to sell
            </CardDescription>
            <div className="mt-4">
              <span className="text-3xl font-bold text-text-primary">
                £29.99
              </span>
              <span className="text-text-secondary text-sm"> / month</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {DEALER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                  <span className="text-text-primary">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild className="w-full mt-6">
              <Link href="/sell">Get Started</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
