"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
import {
  FREE_LAUNCH_FEATURES,
  SELLER_FEATURES,
  DEALER_STARTER_FEATURES,
  DEALER_PRO_FEATURES,
} from "@/components/pricing/pricing-cards";

function getSafeNextPath(nextPath: string | null | undefined): string {
  if (!nextPath) return "/";
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/";
  return nextPath;
}

function getDealerTierFromNextPath(nextPath: string): "STARTER" | "PRO" | null {
  if (!nextPath.startsWith("/dealer/subscribe")) return null;
  const query = nextPath.split("?")[1] ?? "";
  const tier = new URLSearchParams(query).get("tier");
  if (tier === "PRO") return "PRO";
  if (tier === "STARTER") return "STARTER";
  return null;
}

function buildAuthCallbackUrl(nextPath: string): string {
  const fallbackOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    fallbackOrigin ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return `${appUrl}/auth/callback?next=${encodeURIComponent(
    getSafeNextPath(nextPath),
  )}`;
}

interface PlanCard {
  id: string;
  title: string;
  description: string;
  price: string;
  priceSuffix: string;
  features: string[];
  borderColor: string;
  focusRingColor: string;
  checkBg: string;
  checkColor: string;
  buttonVariant: "premium" | "trust" | "energy";
  buttonLabel: string;
  nextPath: string;
  badge?: string;
  badgeBg?: string;
  gradientFrom?: string;
}

interface SignUpWithPlansProps {
  showFreeOffer: boolean;
  slotsRemaining: number;
  slotsTotal: number;
  isFreeWindowActive: boolean;
  dealerTierIntent: "STARTER" | "PRO" | null;
}

export function SignUpWithPlans({
  showFreeOffer,
  slotsRemaining,
  isFreeWindowActive,
  dealerTierIntent,
}: SignUpWithPlansProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialNextPath = getSafeNextPath(searchParams.get("next"));
  const [signedUpNextPath, setSignedUpNextPath] = useState(initialNextPath);
  const signInHref = signedUpNextPath !== "/"
    ? `/sign-in?next=${encodeURIComponent(signedUpNextPath)}`
    : "/sign-in";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  async function handleSubmit(planNextPath: string) {
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and password above first.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const safePlanNextPath = getSafeNextPath(planNextPath);
    setSignedUpNextPath(safePlanNextPath);
    setSelectedPlan(safePlanNextPath);
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const dealerTierIntent = getDealerTierFromNextPath(safePlanNextPath);
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            ...(name ? { full_name: name } : {}),
            ...(dealerTierIntent
              ? { dealer_tier_intent: dealerTierIntent }
              : {}),
          },
          emailRedirectTo: buildAuthCallbackUrl(safePlanNextPath),
        },
      });
      if (err) {
        setError(err.message);
        return;
      }
      if (data.user && data.user.identities?.length === 0) {
        setError(
          "An account with this email already exists. Please sign in instead.",
        );
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setLoading(false);
      setSelectedPlan(null);
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-sm space-y-4 text-center py-20">
        <h2 className="text-2xl font-bold text-text-primary">Check your email</h2>
        <p className="text-text-secondary">
          We&apos;ve sent a confirmation link to <span className="font-medium text-text-primary">{email}</span>.
          Click the link to activate your account.
        </p>
        <Button asChild variant="ghost" className="w-full">
          <Link href={signInHref}>Go to sign in</Link>
        </Button>
      </div>
    );
  }

  const plans: PlanCard[] = [
    ...(showFreeOffer
      ? [
          {
            id: "free-launch",
            title: "Free Launch Offer",
            description: isFreeWindowActive
              ? "FREE during our launch period"
              : `${slotsRemaining} free spots remaining`,
            price: "£0",
            priceSuffix: " / listing",
            features: FREE_LAUNCH_FEATURES.slice(0, 4),
            borderColor: "border-premium-gold-500",
            focusRingColor: "focus:ring-premium-gold-500",
            checkBg: "bg-premium-gold-500/10",
            checkColor: "text-premium-gold-500",
            buttonVariant: "premium" as const,
            buttonLabel: "Sign Up Free",
            nextPath: "/sell/private",
            badge: "Launch Offer",
            badgeBg: "bg-premium-gold-500 text-black",
          },
        ]
      : []),
    {
      id: "private-seller",
      title: "Private Seller",
      description: "Sell individual items",
      price: "£4.99",
      priceSuffix: " / listing",
      features: SELLER_FEATURES.slice(0, 4),
      borderColor: "border-neon-blue-500",
      focusRingColor: "focus:ring-neon-blue-500",
      checkBg: "bg-neon-blue-500/10",
      checkColor: "text-neon-blue-500",
      buttonVariant: "trust" as const,
      buttonLabel: "Sign Up to Sell",
      nextPath: "/sell/private",
    },
    {
      id: "dealer-starter",
      title: "Dealer Starter",
      description: "For dealerships getting started",
      price: "£29.99",
      priceSuffix: " / month",
      features: DEALER_STARTER_FEATURES.slice(0, 4),
      borderColor: "border-red-500",
      focusRingColor: "focus:ring-red-500",
      checkBg: "bg-red-500/10",
      checkColor: "text-red-500",
      buttonVariant: "energy" as const,
      buttonLabel: "Sign Up for Starter",
      nextPath: "/dealer/subscribe?tier=STARTER",
      gradientFrom: dealerTierIntent === "STARTER" ? "from-red-500/5" : undefined,
      badge: dealerTierIntent === "STARTER" ? "Selected" : undefined,
      badgeBg: dealerTierIntent === "STARTER" ? "bg-red-500 text-white" : undefined,
    },
    {
      id: "dealer-pro",
      title: "Dealer Pro",
      description: "For larger monthly inventory",
      price: "£49.99",
      priceSuffix: " / month",
      features: DEALER_PRO_FEATURES.slice(0, 4),
      borderColor: "border-red-500",
      focusRingColor: "focus:ring-red-500",
      checkBg: "bg-red-500/10",
      checkColor: "text-red-500",
      buttonVariant: "energy" as const,
      buttonLabel: "Sign Up for Pro",
      nextPath: "/dealer/subscribe?tier=PRO",
      badge: dealerTierIntent === "PRO" ? "Selected" : "Pro",
      badgeBg: "bg-red-500 text-white",
      gradientFrom: "from-red-500/5",
    },
  ];

  return (
    <div className="space-y-12">
      <div className="mx-auto max-w-sm">
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label="Name (optional)"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p className="text-sm text-text-energy" role="alert">
              {error}
            </p>
          )}
          <p className="text-center text-sm text-text-secondary">
            Already have an account?{" "}
            <Link href={signInHref} className="text-text-trust hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold text-text-primary text-center mb-6">
          Choose your plan to create your account
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              disabled={loading}
              onClick={() => handleSubmit(plan.nextPath)}
              className={`relative flex flex-col p-4 rounded-lg border-2 text-left transition-all
                ${plan.borderColor}
                ${plan.gradientFrom ? `bg-gradient-to-br ${plan.gradientFrom} to-transparent` : ""}
                hover:shadow-high focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface
                ${plan.focusRingColor}
                disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {plan.badge && (
                <span className={`absolute top-0 right-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-bl-lg ${plan.badgeBg}`}>
                  {plan.badge}
                </span>
              )}
              <div className="mb-2">
                <h3 className="text-base font-semibold text-text-primary">{plan.title}</h3>
                <p className="text-xs text-text-secondary">{plan.description}</p>
              </div>
              <div className="mb-3">
                <span className="text-xl font-bold text-text-primary">{plan.price}</span>
                <span className="text-text-secondary text-xs">{plan.priceSuffix}</span>
              </div>
              <div className="flex flex-col gap-1 mb-4 flex-1">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-1.5 text-xs">
                    <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${plan.checkBg}`}>
                      <Check className={`h-2 w-2 ${plan.checkColor}`} />
                    </div>
                    <span className="text-text-secondary">{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto">
                <Button
                  variant={plan.buttonVariant}
                  size="sm"
                  className="w-full pointer-events-none"
                  tabIndex={-1}
                  disabled={loading && selectedPlan === plan.nextPath}
                >
                  {loading && selectedPlan === plan.nextPath
                    ? "Creating account\u2026"
                    : plan.buttonLabel}
                </Button>
              </div>
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-text-secondary">
          Want more details?{" "}
          <Link href="/pricing" className="text-text-trust hover:underline">
            View full pricing breakdown
          </Link>
        </p>
      </div>
    </div>
  );
}
