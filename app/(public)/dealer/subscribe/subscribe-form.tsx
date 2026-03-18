"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";
import { createSelfServiceDealerProfile } from "@/actions/dealer";
import { createDealerSubscription } from "@/actions/payments";

interface SubscribeFormProps {
  tier: "STARTER" | "PRO";
  tierLabel: string;
  tierPrice: string;
  features: readonly string[];
  hasDealerProfile: boolean;
}

export function SubscribeForm({
  tier,
  tierLabel,
  tierPrice,
  features,
  hasDealerProfile: initialHasProfile,
}: SubscribeFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [hasProfile, setHasProfile] = useState(initialHasProfile);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleCreateProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createSelfServiceDealerProfile({
        name: businessName.trim(),
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
      });
      if (result.error) {
        const msg =
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat().join(", ");
        setError(msg);
        return;
      }
      setHasProfile(true);
      router.refresh();
    });
  }

  function handleSubscribe() {
    setError(null);
    startTransition(async () => {
      const result = await createDealerSubscription(tier);
      if (result.error) {
        const msg =
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat().join(", ");
        setError(msg);
        return;
      }
      if (result.data?.checkoutUrl) {
        window.location.href = result.data.checkoutUrl;
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            {tierLabel} Plan Features
          </h2>
          <ul className="space-y-2">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-blue-500/10">
                  <Check className="h-3 w-3 text-neon-blue-500" />
                </div>
                <span className="text-text-secondary">{feature}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-lg font-bold text-text-primary">
            {tierPrice}
            <span className="text-sm font-normal text-text-secondary">
              {" "}
              / month
            </span>
          </p>
        </CardContent>
      </Card>

      {!hasProfile ? (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-1">
              Step 1: Set Up Your Dealer Profile
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              We need a few details to create your dealer profile before you
              can subscribe.
            </p>
            <form onSubmit={handleCreateProfile} className="space-y-4">
              <Input
                label="Business Name"
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                placeholder="e.g. Island Motors"
              />
              <Input
                label="Phone (optional)"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 01624 123456"
              />
              <Input
                label="Website (optional)"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="e.g. https://islandmotors.im"
              />
              {error && (
                <p className="text-sm text-text-energy" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                loading={isPending}
              >
                Create Dealer Profile
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-1">
              Subscribe to {tierLabel}
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              You&apos;ll be redirected to our secure payment provider (Stripe) to
              complete your subscription.
            </p>
            {error && (
              <p className="text-sm text-text-energy mb-4" role="alert">
                {error}
              </p>
            )}
            <Button
              onClick={handleSubscribe}
              className="w-full"
              loading={isPending}
            >
              Subscribe &mdash; {tierPrice}/month
            </Button>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-text-secondary">
        Want a different plan?{" "}
        <Link href="/pricing" className="text-text-trust hover:underline">
          View all plans
        </Link>
      </p>
    </div>
  );
}
