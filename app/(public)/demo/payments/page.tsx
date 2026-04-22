export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import {
  DEALER_PRO_FEATURES,
  DEALER_STARTER_FEATURES,
  SELLER_FEATURES,
} from "@/components/pricing/pricing-cards";
import { RippleDemoShowcase, type RippleDemoFlow } from "@/components/payments/ripple-demo-showcase";
import { getFeaturedFeePence, getListingFeePence } from "@/lib/config/marketplace";
import {
  createDealerSubscriptionCheckout,
  createFeaturedUpgradeCheckout,
  createListingCheckout,
  getPaymentProviderCapabilities,
  getPaymentProviderName,
  getPaymentProviderPortalUrl,
} from "@/lib/payments/provider";

export const metadata: Metadata = {
  title: "Ripple Payments Demo",
  description:
    "Client-facing preview of iomarket's Ripple payment journeys before onboarding is complete.",
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

interface Props {
  searchParams: Promise<{
    return?: "success" | "cancel";
    flow?: string;
  }>;
}

function formatPounds(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100);
}

function buildReturnUrl(kind: "success" | "cancel", flow: string) {
  return `${APP_URL}/demo/payments?return=${kind}&flow=${flow}`;
}

function getReturnBanner(
  returnState: "success" | "cancel" | undefined,
  flow: string | undefined
) {
  if (!returnState || !flow) return null;

  const label = flow
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  if (returnState === "success") {
    return `Ripple returned to this preview page for the ${label} flow. Once onboarding is complete, this is where iomarket can resume with real webhook-backed confirmation.`;
  }

  return `The ${label} preview flow returned in a cancelled state. This still demonstrates the redirect out to Ripple and back again.`;
}

export default async function DemoPaymentsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const listingFee = getListingFeePence();
  const featuredFee = getFeaturedFeePence();
  const providerName = getPaymentProviderName();
  const portalUrl = getPaymentProviderPortalUrl();
  const capabilities = getPaymentProviderCapabilities();

  const [listingCheckout, featuredCheckout, starterCheckout, proCheckout] =
    await Promise.all([
      createListingCheckout({
        listingId: "demo-listing-preview",
        listingTitle: "2019 BMW 320d M Sport",
        amountInPence: listingFee,
        checkoutType: "listing_payment",
        customerEmail: "preview@iomarket.im",
        successUrl: buildReturnUrl("success", "listing"),
        cancelUrl: buildReturnUrl("cancel", "listing"),
        idempotencyKey: "preview-listing-payment",
      }),
      createFeaturedUpgradeCheckout({
        listingId: "demo-featured-preview",
        listingTitle: "2019 BMW 320d M Sport",
        customerEmail: "preview@iomarket.im",
        amountInPence: featuredFee,
        successUrl: buildReturnUrl("success", "featured"),
        cancelUrl: buildReturnUrl("cancel", "featured"),
      }),
      createDealerSubscriptionCheckout({
        dealerId: "demo-dealer-preview",
        tier: "STARTER",
        customerEmail: "dealer-preview@iomarket.im",
        successUrl: buildReturnUrl("success", "dealer-starter"),
        cancelUrl: buildReturnUrl("cancel", "dealer-starter"),
      }),
      createDealerSubscriptionCheckout({
        dealerId: "demo-dealer-preview",
        tier: "PRO",
        customerEmail: "dealer-preview@iomarket.im",
        successUrl: buildReturnUrl("success", "dealer-pro"),
        cancelUrl: buildReturnUrl("cancel", "dealer-pro"),
      }),
    ]);

  const flows: RippleDemoFlow[] = [
    {
      id: "listing",
      eyebrow: "Flow 1",
      title: "Private Listing Fee",
      price: `${formatPounds(listingFee)} / listing`,
      description:
        "Shows the hosted payment step a private seller sees after creating a listing draft in iomarket.",
      highlights: SELLER_FEATURES.slice(0, 4),
      actions: [
        {
          id: "listing-payment",
          label: "Preview listing checkout",
          checkoutLabel: "listing payment",
          checkoutUrl: listingCheckout.url,
          variant: "trust",
        },
      ],
    },
    {
      id: "featured",
      eyebrow: "Flow 2",
      title: "Featured Upgrade",
      price: `${formatPounds(featuredFee)} one-off`,
      description:
        "Demonstrates the upsell path from a live listing into Ripple's hosted featured upgrade payment page.",
      highlights: [
        "Promoted placement on search and homepage surfaces.",
        "One-off checkout separate from the base listing fee.",
        "Keeps the same iomarket-to-Ripple redirect pattern as launch.",
      ],
      actions: [
        {
          id: "featured-upgrade",
          label: "Preview featured checkout",
          checkoutLabel: "featured upgrade",
          checkoutUrl: featuredCheckout.url,
          variant: "premium",
        },
      ],
    },
    {
      id: "dealer",
      eyebrow: "Flow 3",
      title: "Dealer Subscription",
      price: "Starter + Pro tiers",
      description:
        "Shows the dealer subscription journey using Ripple-hosted signup pages instead of an on-site billing form.",
      highlights: [
        DEALER_STARTER_FEATURES[0],
        DEALER_STARTER_FEATURES[1],
        DEALER_PRO_FEATURES[0],
        "Real plan IDs and subscription sync will replace the demo mapping after onboarding.",
      ],
      actions: [
        {
          id: "dealer-starter",
          label: "Preview Starter",
          checkoutLabel: "dealer starter subscription",
          checkoutUrl: starterCheckout.url,
          variant: "trust",
        },
        {
          id: "dealer-pro",
          label: "Preview Pro",
          checkoutLabel: "dealer pro subscription",
          checkoutUrl: proCheckout.url,
          variant: "energy",
        },
      ],
    },
  ];

  const returnBanner = getReturnBanner(sp.return, sp.flow);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mb-8 rounded-2xl border border-border bg-surface/70 p-6 shadow-high sm:mb-10 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neon-blue-400">
          Client Preview
        </p>
        <h1 className="mt-3 font-heading text-3xl font-bold text-text-primary sm:text-4xl">
          Ripple Payments Demo
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary sm:text-base">
          This page lets you walk the client through the three payment journeys
          that matter most in `iomarket` without creating real listings or using
          live Ripple credentials. Every action below uses the current demo-mode
          fallback that will later be swapped for live account-specific values.
        </p>

        <div className="mt-6 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.16em]">
          <span className="rounded-full border border-neon-blue-500/30 bg-neon-blue-500/10 px-3 py-1 text-neon-blue-300">
            {providerName} Hosted Checkout
          </span>
          <span className="rounded-full border border-premium-gold-500/30 bg-premium-gold-500/10 px-3 py-1 text-premium-gold-400">
            Demo URLs Active
          </span>
          <span className="rounded-full border border-border bg-canvas/70 px-3 py-1 text-text-secondary">
            Webhook Sync Pending Onboarding
          </span>
        </div>
      </div>

      {returnBanner ? (
        <div className="mb-6 rounded-xl border border-neon-blue-500/25 bg-neon-blue-500/10 px-5 py-4 text-sm leading-6 text-text-primary">
          {returnBanner}
        </div>
      ) : null}

      <RippleDemoShowcase
        providerName={providerName}
        preferredCheckoutSurface={capabilities.preferredCheckoutSurface}
        supportsEmbeddedCheckout={capabilities.supportsEmbeddedCheckout}
        portalUrl={portalUrl}
        flows={flows}
      />
    </div>
  );
}
