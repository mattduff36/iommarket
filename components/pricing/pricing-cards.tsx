import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { VariantProps } from "class-variance-authority";
import { Check } from "lucide-react";
import type { MarketplacePricing } from "@/lib/config/marketplace-pricing-definitions";
import { formatGbpFromPence } from "@/lib/formatting/gbp";

const PRIVATE_SELLER_LISTING_BENEFITS = [
  "60-day listing duration",
  "Up to 10 photos",
  "Contact form included",
  "Moderation within 1-2 days",
];

export function getSellerFeatures(pricing: MarketplacePricing): string[] {
  return [
  "Private seller listing",
  ...PRIVATE_SELLER_LISTING_BENEFITS,
    `Renew for another ${formatGbpFromPence(pricing.privateListingPence)}`,
    `Upgrade to featured listing for ${formatGbpFromPence(pricing.featuredUpgradePence)}`,
  ];
}

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

export function getFreeLaunchFeatures(pricing: MarketplacePricing): string[] {
  return ["Private seller listing — free", ...getSellerFeatures(pricing).slice(1)];
}

interface CardCta {
  label: string;
  href: string;
}

interface PricingCardProps {
  title: string;
  description: string;
  price: string;
  billingPeriod: string;
  cta: CardCta;
  features: readonly string[];
  accentClassName: string;
  iconClassName: string;
  iconColorClassName: string;
  buttonVariant: VariantProps<typeof buttonVariants>["variant"];
  badge?: string;
  badgeClassName?: string;
  highlightClassName?: string;
}

export interface PricingCardsProps {
  pricing: MarketplacePricing;
  showFreeOffer: boolean;
  slotsRemaining: number;
  slotsTotal: number;
  freeLaunchCta: CardCta;
  privateSellerCta: CardCta;
  dealerStarterCta: CardCta;
  dealerProCta: CardCta;
}

function FeatureList({
  features,
  iconClassName,
  iconColorClassName,
}: Pick<PricingCardProps, "features" | "iconClassName" | "iconColorClassName">) {
  return (
    <ul className="grid w-full grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {features.map((feature) => (
        <li
          key={feature}
          className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 text-xs leading-5"
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
          >
            <Check className={`h-2.5 w-2.5 ${iconColorClassName}`} />
          </span>
          <span className="min-w-0 text-text-secondary">{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function PricingCard({
  title,
  description,
  price,
  billingPeriod,
  cta,
  features,
  accentClassName,
  iconClassName,
  iconColorClassName,
  buttonVariant,
  badge,
  badgeClassName,
  highlightClassName,
}: PricingCardProps) {
  return (
    <Card
      className={`relative flex w-full flex-col gap-6 p-4 shadow-high md:flex-row md:items-center md:gap-8 ${accentClassName} ${highlightClassName ?? ""}`}
    >
      {badge && (
        <span className={`absolute right-0 top-0 rounded-bl-lg px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${badgeClassName}`}>
          {badge}
        </span>
      )}
      <div className={`flex min-w-0 flex-col items-start gap-1 md:w-60 md:shrink-0 ${badge ? "pr-24 md:pr-0" : ""}`}>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription className="text-left">{description}</CardDescription>
        <div className="mt-2">
          <span className="text-2xl font-bold text-text-primary">{price}</span>
          <span className="text-text-secondary text-xs"> / {billingPeriod}</span>
        </div>
        <Button asChild variant={buttonVariant} size="sm" className="mt-3">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      </div>
      <CardContent className="w-full min-w-0 flex-1 p-0">
        <FeatureList
          features={features}
          iconClassName={iconClassName}
          iconColorClassName={iconColorClassName}
        />
      </CardContent>
    </Card>
  );
}

export function PricingCards({
  pricing,
  showFreeOffer,
  slotsRemaining,
  slotsTotal,
  freeLaunchCta,
  privateSellerCta,
  dealerStarterCta,
  dealerProCta,
}: PricingCardsProps) {
  const sellerFeatures = getSellerFeatures(pricing);
  const freeLaunchFeatures = getFreeLaunchFeatures(pricing);

  return (
    <div className="flex flex-col gap-6 w-full">
      {showFreeOffer && (
        <PricingCard
          title="Free Launch Offer"
          description={`FREE private seller listing — ${slotsRemaining} of ${slotsTotal} spots left!`}
          price={formatGbpFromPence(0)}
          billingPeriod="listing"
          cta={freeLaunchCta}
          features={freeLaunchFeatures}
          accentClassName="ring-2 ring-premium-gold-500"
          iconClassName="bg-premium-gold-500/10"
          iconColorClassName="text-premium-gold-500"
          buttonVariant="premium"
          badge={`${slotsRemaining} ${slotsRemaining === 1 ? "spot" : "spots"} left`}
          badgeClassName="bg-premium-gold-500 text-black"
          highlightClassName="overflow-hidden bg-gradient-to-r from-premium-gold-500/5 to-transparent"
        />
      )}

      <PricingCard
        title="Private Seller"
        description="Perfect for selling individual items"
        price={formatGbpFromPence(pricing.privateListingPence)}
        billingPeriod="listing"
        cta={privateSellerCta}
        features={sellerFeatures}
        accentClassName="ring-2 ring-neon-blue-500"
        iconClassName="bg-neon-blue-500/10"
        iconColorClassName="text-neon-blue-500"
        buttonVariant="trust"
      />

      <PricingCard
        title="Dealer Starter"
        description="For smaller dealerships getting started"
        price={formatGbpFromPence(pricing.dealerStarterMonthlyPence)}
        billingPeriod="month"
        cta={dealerStarterCta}
        features={DEALER_STARTER_FEATURES}
        accentClassName="ring-2 ring-red-500"
        iconClassName="bg-red-500/10"
        iconColorClassName="text-red-500"
        buttonVariant="energy"
      />

      <PricingCard
        title="Dealer Pro"
        description="For dealers with larger monthly inventory"
        price={formatGbpFromPence(pricing.dealerProMonthlyPence)}
        billingPeriod="month"
        cta={dealerProCta}
        features={DEALER_PRO_FEATURES}
        accentClassName="ring-2 ring-red-500"
        iconClassName="bg-red-500/10"
        iconColorClassName="text-red-500"
        buttonVariant="energy"
        badge="Pro"
        badgeClassName="bg-red-500 text-white"
        highlightClassName="overflow-hidden bg-gradient-to-r from-red-500/5 to-transparent"
      />
    </div>
  );
}
