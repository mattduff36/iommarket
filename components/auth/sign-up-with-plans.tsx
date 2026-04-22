"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronRight, Heart, Search, ShieldCheck, Star } from "lucide-react";

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

interface SignUpWithPlansProps {
  showFreeOffer: boolean;
  slotsRemaining: number;
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
  const defaultNextPath = initialNextPath === "/" ? "/account" : initialNextPath;
  const [signedUpNextPath, setSignedUpNextPath] = useState(defaultNextPath);
  const signInHref = signedUpNextPath !== "/"
    ? `/sign-in?next=${encodeURIComponent(signedUpNextPath)}`
    : "/sign-in";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const isDealerSignup = dealerTierIntent !== null;
  const isPrivateSellerIntent =
    defaultNextPath.startsWith("/sell") && !defaultNextPath.startsWith("/dealer/");
  const submitLabel = isDealerSignup
    ? `Create account and continue to ${dealerTierIntent === "PRO" ? "Dealer Pro" : "Dealer Starter"}`
    : isPrivateSellerIntent
      ? "Create account and continue to sell"
      : "Create account";

  const benefitCards = [
    {
      icon: Heart,
      title: "Save listings",
      description: "Keep your favourites in one place and come back when you are ready.",
    },
    {
      icon: Search,
      title: "Save searches",
      description: "Reuse your filters in one click and stay on top of new matches.",
    },
    {
      icon: Star,
      title: "Review dealers",
      description: "Signed-in members can leave named feedback on dealer profiles.",
    },
  ];

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please enter your email and password above first.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const safeNextPath = getSafeNextPath(defaultNextPath);
    setSignedUpNextPath(safeNextPath);
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const dealerTierIntent = getDealerTierFromNextPath(safeNextPath);
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
          emailRedirectTo: buildAuthCallbackUrl(safeNextPath),
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

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-neon-blue-500/25 bg-surface p-6 shadow-low sm:p-8"
      >
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-neon-blue-500">
            {isDealerSignup
              ? "Dealer setup"
              : isPrivateSellerIntent
                ? "Private selling"
                : "Member account"}
          </p>
          <h2 className="mt-3 text-2xl font-bold text-text-primary font-heading">
            {isDealerSignup
              ? "Create your account to continue to dealer setup"
              : isPrivateSellerIntent
                ? "Create your account and keep selling when you are ready"
                : "Create an account for buying, browsing, and selling later"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            {isDealerSignup
              ? "You are one step away from choosing your dealer plan. Create your account now and we will take you straight back to dealer setup after you confirm your email."
              : isPrivateSellerIntent
                ? "Create a free account first, then continue into the private seller flow. You can still save favourites, save searches, and leave dealer reviews along the way."
                : "Your account lets you save favourites, save searches, leave named dealer reviews, and move into private selling or dealer upgrade flows whenever you choose."}
          </p>
        </div>

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
          <Button type="submit" variant="trust" className="w-full" loading={loading}>
            {loading ? "Creating account…" : submitLabel}
          </Button>
          <p className="text-xs leading-5 text-text-secondary">
            By joining, you can use buyer tools immediately and choose to list privately or
            upgrade to a dealer plan later on the same account.
          </p>
        </div>
      </form>

      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface-elevated/70 p-6 shadow-low">
          <h3 className="text-lg font-semibold text-text-primary">What your account unlocks</h3>
          <div className="mt-5 space-y-4">
            {benefitCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="flex gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10 text-neon-blue-400">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary">{card.title}</h4>
                    <p className="mt-1 text-sm leading-6 text-text-secondary">
                      {card.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-low">
          <h3 className="text-lg font-semibold text-text-primary">After you join</h3>
          <div className="mt-4 space-y-3 text-sm text-text-secondary">
            <div className="flex gap-3 rounded-lg border border-border/70 bg-surface-elevated/60 p-4">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10 text-neon-blue-400">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <p className="font-medium text-text-primary">Private selling stays available</p>
                <p className="mt-1">
                  Use the same account to post a private listing any time from the sell flow.
                </p>
                {showFreeOffer ? (
                  <p className="mt-2 text-xs text-premium-gold-500">
                    {isFreeWindowActive
                      ? "Private seller listings are currently free during launch."
                      : `${slotsRemaining} free private seller launch spots are still available.`}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex gap-3 rounded-lg border border-border/70 bg-surface-elevated/60 p-4">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-red-500/10 text-neon-red-500">
                <ShieldCheck className="h-3 w-3" />
              </div>
              <div>
                <p className="font-medium text-text-primary">Dealer upgrade when you need it</p>
                <p className="mt-1">
                  Start as a member today, then move into a dealer plan when your inventory grows.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild variant={isDealerSignup ? "energy" : "ghost"} size="sm">
              <Link href={isDealerSignup ? defaultNextPath : "/pricing"}>
                {isDealerSignup ? "Review dealer plan" : "Compare dealer plans"}
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={isPrivateSellerIntent ? "/sell" : "/search"}>
                {isPrivateSellerIntent ? "Back to sell flow" : "Browse marketplace"}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
