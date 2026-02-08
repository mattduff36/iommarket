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
    <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="text-center mb-16">
        <p className="text-sm font-semibold uppercase tracking-widest text-royal-600">
          Pricing
        </p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900 sm:text-4xl">
          Simple, Transparent Pricing
        </h1>
        <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
          No hidden fees. Just straightforward pricing for Isle of Man sellers.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 max-w-3xl mx-auto">
        {/* Private Seller */}
        <Card className="p-2">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Private Seller</CardTitle>
            <CardDescription>
              Perfect for selling individual items
            </CardDescription>
            <div className="mt-6">
              <span className="text-4xl font-bold text-slate-900">
                £4.99
              </span>
              <span className="text-slate-500 text-sm"> / listing</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {SELLER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-3 w-3 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild className="w-full mt-8">
              <Link href="/sell">List an Item</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Dealer */}
        <Card className="relative p-2 ring-2 ring-royal-500 shadow-lg">
          <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
            <Badge variant="info" className="px-4 py-1 text-xs font-bold">Most Popular</Badge>
          </div>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Dealer</CardTitle>
            <CardDescription>
              For businesses with multiple items to sell
            </CardDescription>
            <div className="mt-6">
              <span className="text-4xl font-bold text-slate-900">
                £29.99
              </span>
              <span className="text-slate-500 text-sm"> / month</span>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {DEALER_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-3 w-3 text-emerald-600" />
                  </div>
                  <span className="text-slate-700">{feature}</span>
                </li>
              ))}
            </ul>
            <Button asChild className="w-full mt-8">
              <Link href="/sell">Get Started</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
