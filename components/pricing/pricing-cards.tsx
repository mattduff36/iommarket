import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Check } from "lucide-react";

export const SELLER_FEATURES = [
  "30-day listing duration",
  "Up to 10 photos",
  "Contact form included",
  "Moderation within 1-2 days",
  "Renew for another £4.99",
  "Upgrade to featured listing for £10",
  "Choose to support a new local business!",
];

export const DEALER_STARTER_FEATURES = [
  "Up to 30 active listings",
  "Dedicated dealer profile page",
  "Up to 20 photos per listing",
  "Priority moderation",
  "Phone number displayed",
  "Cancel anytime",
];

export const DEALER_PRO_FEATURES = [
  "Up to 100 active listings",
  "All Starter features",
  "Priority moderation",
  "Dealer dashboard",
  "Ideal for larger inventories",
  "Cancel anytime",
];

export const FREE_LAUNCH_FEATURES = [
  "One free listing per person",
  "30-day listing duration",
  "Up to 10 photos",
  "Contact form included",
  "Moderation within 1-2 days",
];

interface CardCta {
  label: string;
  href: string;
}

export interface PricingCardsProps {
  showFreeOffer: boolean;
  slotsRemaining: number;
  slotsTotal: number;
  freeLaunchCta: CardCta;
  privateSellerCta: CardCta;
  dealerStarterCta: CardCta;
  dealerProCta: CardCta;
}

export function PricingCards({
  showFreeOffer,
  slotsRemaining,
  slotsTotal,
  freeLaunchCta,
  privateSellerCta,
  dealerStarterCta,
  dealerProCta,
}: PricingCardsProps) {
  return (
    <div className="flex flex-col gap-6 w-full">
      {showFreeOffer && (
        <Card className="relative flex flex-row items-center p-4 ring-2 ring-premium-gold-500 shadow-high w-full min-h-[7rem] bg-gradient-to-r from-premium-gold-500/5 to-transparent overflow-hidden">
          <div className="absolute top-0 right-0 bg-premium-gold-500 text-black text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg">
            {slotsRemaining} {slotsRemaining === 1 ? "spot" : "spots"} left
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
            <CardTitle className="text-lg">Free Launch Offer</CardTitle>
            <CardDescription className="text-left">
              FREE private seller listing — {slotsRemaining} of {slotsTotal} spots left!
            </CardDescription>
            <div className="mt-2">
              <span className="text-2xl font-bold text-premium-gold-500">
                £0
              </span>
              <span className="text-text-secondary text-xs"> / listing</span>
            </div>
            <Button asChild variant="premium" size="sm" className="mt-3">
              <Link href={freeLaunchCta.href}>{freeLaunchCta.label}</Link>
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

      <Card className="flex flex-row items-center p-4 ring-2 ring-neon-blue-500 shadow-high w-full min-h-[7rem]">
        <div className="flex shrink-0 flex-col items-start gap-1 pr-8">
          <CardTitle className="text-lg">Private Seller</CardTitle>
          <CardDescription className="text-left">
            Perfect for selling individual items
          </CardDescription>
          <div className="mt-2">
            <span className="text-2xl font-bold text-text-primary">£4.99</span>
            <span className="text-text-secondary text-xs"> / listing</span>
          </div>
          <Button asChild variant="trust" size="sm" className="mt-3">
            <Link href={privateSellerCta.href}>
              {privateSellerCta.label}
            </Link>
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
            <Link href={dealerStarterCta.href}>
              {dealerStarterCta.label}
            </Link>
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

      <Card className="relative flex flex-row items-center p-4 ring-2 ring-red-500 shadow-high w-full min-h-[7rem] bg-gradient-to-r from-red-500/5 to-transparent overflow-hidden">
        <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg">
          Pro
        </div>
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
          <Button asChild variant="energy" size="sm" className="mt-3">
            <Link href={dealerProCta.href}>{dealerProCta.label}</Link>
          </Button>
        </div>
        <CardContent className="flex flex-1 flex-wrap gap-x-6 gap-y-1 p-0">
          {DEALER_PRO_FEATURES.map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-xs">
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <Check className="h-2.5 w-2.5 text-red-500" />
              </div>
              <span className="text-text-secondary">{feature}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
