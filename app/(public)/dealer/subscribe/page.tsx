export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEALER_TIER_LABELS } from "@/lib/config/dealer-tiers";
import { SubscribeForm } from "./subscribe-form";

export const metadata: Metadata = {
  title: "Dealer Subscription",
  description: "Subscribe to a dealer plan on itrader.im.",
};

const TIER_DETAILS = {
  STARTER: {
    price: "£29.99",
    features: [
      "Up to 30 active listings",
      "Dedicated dealer profile page",
      "Up to 20 photos per listing",
      "Priority moderation",
      "Phone number displayed",
      "Cancel anytime",
    ],
  },
  PRO: {
    price: "£49.99",
    features: [
      "Up to 100 active listings",
      "All Starter features",
      "Priority moderation",
      "Dealer dashboard",
      "Ideal for larger inventories",
      "Cancel anytime",
    ],
  },
} as const;

interface Props {
  searchParams?: Promise<{ tier?: string }>;
}

export default async function DealerSubscribePage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const tier =
    params.tier === "PRO" || params.tier === "STARTER"
      ? params.tier
      : "STARTER";
  const intendedSubscribePath = `/dealer/subscribe?tier=${tier}`;

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/sign-up?next=${encodeURIComponent(intendedSubscribePath)}`);
  }

  const dealerProfile = user.dealerProfile;

  if (dealerProfile) {
    const activeSubscription = await db.subscription.findFirst({
      where: { dealerId: dealerProfile.id, status: "ACTIVE" },
      select: { id: true },
    });
    if (activeSubscription) {
      redirect("/dealer/dashboard");
    }
  }

  const tierLabel = DEALER_TIER_LABELS[tier];
  const details = TIER_DETAILS[tier];

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-text-primary font-heading">
          Dealer {tierLabel} Plan
        </h1>
        <p className="mt-2 text-text-secondary">
          {details.price}/month &middot; Cancel anytime
        </p>
      </div>

      <SubscribeForm
        tier={tier}
        tierLabel={tierLabel}
        tierPrice={details.price}
        features={details.features}
        hasDealerProfile={Boolean(dealerProfile)}
      />
    </div>
  );
}
