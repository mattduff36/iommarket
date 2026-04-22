export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { SignUpWithPlans } from "@/components/auth/sign-up-with-plans";
import {
  getFreeLaunchSlotsRemaining,
  isListingFreeNowAsync,
} from "@/lib/config/marketplace";

export const metadata: Metadata = {
  title: "Sign Up",
  description:
    "Create your itrader.im account to save favourites, save searches, review dealers, and sell when you're ready.",
};

interface Props {
  searchParams?: Promise<{ next?: string }>;
}

type DealerTierIntent = "STARTER" | "PRO";

function getDealerTierIntent(nextPath: string | undefined): DealerTierIntent | null {
  if (!nextPath?.startsWith("/dealer/subscribe")) return null;
  const query = nextPath.split("?")[1] ?? "";
  const tier = new URLSearchParams(query).get("tier");
  return tier === "PRO" ? "PRO" : "STARTER";
}

export default async function SignUpPage({ searchParams }: Props) {
  if (!isSupabaseAuthConfigured()) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-muted-foreground text-center">
          Sign-up is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to enable authentication.
        </p>
      </div>
    );
  }

  const params = searchParams ? await searchParams : {};
  const dealerTierIntent = getDealerTierIntent(params.next);

  const [slotsRemaining, isFreeWindowActive] = await Promise.all([
    getFreeLaunchSlotsRemaining(),
    isListingFreeNowAsync(),
  ]);
  const showFreeOffer = isFreeWindowActive || slotsRemaining > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="text-center mb-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-neon-blue-500">
          Get Started
        </p>
        <h1 className="mt-3 text-3xl font-bold text-text-primary font-heading sm:text-4xl">
          Create Your Account
        </h1>
        <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
          Join the Isle of Man&apos;s trusted vehicle marketplace. Save favourites,
          track searches, and sell when you&apos;re ready.
        </p>
      </div>

      <SignUpWithPlans
        showFreeOffer={showFreeOffer}
        slotsRemaining={slotsRemaining}
        isFreeWindowActive={isFreeWindowActive}
        dealerTierIntent={dealerTierIntent}
      />
    </div>
  );
}
