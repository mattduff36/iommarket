"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  RippleDemoCheckoutDialog,
  useRippleDemoCheckout,
} from "@/components/payments/ripple-demo-checkout-dialog";
import { Check } from "lucide-react";
import { createSelfServiceDealerProfile } from "@/actions/dealer";
import {
  createDealerSubscription,
  simulateDemoDealerSubscriptionOutcome,
} from "@/actions/payments";
import { isRippleDemoCheckoutUrl } from "@/lib/payments/demo-checkout";
import { PaymentAwaitingStatus } from "@/components/payments/payment-awaiting-status";
import { Checkbox } from "@/components/ui/checkbox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { DEALER_TERMS_ACCEPTANCE_MESSAGE } from "@/lib/validations/payment";

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
  const [isSimulatingDemoOutcome, startSimulatingDemoOutcome] = useTransition();
  const { demoCheckoutUrl, demoDialogOpen, openCheckout, setDemoDialogOpen } =
    useRippleDemoCheckout();
  const [hasProfile, setHasProfile] = useState(initialHasProfile);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [demoOutcomeError, setDemoOutcomeError] = useState<string | null>(null);
  const [isAwaitingPayment, setIsAwaitingPayment] = useState(false);
  const [acceptedDealerTerms, setAcceptedDealerTerms] = useState(false);

  function handleCreateProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createSelfServiceDealerProfile({
        name: businessName.trim(),
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
      });
      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(split.formError);
        return;
      }
      setHasProfile(true);
      router.refresh();
    });
  }

  function handleSubscribe() {
    setError(null);
    setFieldErrors({});
    setNotice(null);
    setDemoOutcomeError(null);
    if (!acceptedDealerTerms) {
      setFieldErrors({
        acceptedDealerTerms: [DEALER_TERMS_ACCEPTANCE_MESSAGE],
      });
      return;
    }
    startTransition(async () => {
      const result = await createDealerSubscription({
        tier,
        acceptedDealerTerms: true,
      });
      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(split.formError);
        return;
      }
      if (result.data?.checkoutUrl) {
        openCheckout(result.data.checkoutUrl);
        setIsAwaitingPayment(true);
        if (isRippleDemoCheckoutUrl(result.data.checkoutUrl)) {
          setNotice(
            "Demo checkout is ready in the modal below. Use the temporary outcome buttons after previewing the hosted tab."
          );
        } else {
          setNotice(
            "Ripple checkout is open in another tab. Keep this page open so we can confirm your subscription."
          );
        }
      }
    });
  }

  function handleSimulatedDemoOutcome(outcome: "success" | "declined") {
    setDemoOutcomeError(null);
    startSimulatingDemoOutcome(async () => {
      const result = await simulateDemoDealerSubscriptionOutcome({
        tier,
        outcome,
      });

      if (result.error) {
        setDemoOutcomeError(
          typeof result.error === "string"
            ? result.error
            : "Could not simulate the demo subscription outcome."
        );
        return;
      }

      setDemoDialogOpen(false);

      if (result.data?.nextUrl) {
        router.push(result.data.nextUrl);
        return;
      }

      router.refresh();
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
            <form onSubmit={handleCreateProfile} noValidate className="space-y-4">
              <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
              <Input
                label="Business Name"
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                placeholder="e.g. Island Motors"
                error={firstFieldError(fieldErrors, "name")}
              />
              <Input
                label="Phone (optional)"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 01624 123456"
                error={firstFieldError(fieldErrors, "phone")}
              />
              <Input
                label="Website (optional)"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="e.g. https://islandmotors.im"
                error={firstFieldError(fieldErrors, "website")}
              />
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
              A secure Ripple checkout will open in a new tab so you can keep
              this subscription page open while you complete payment.
            </p>
            <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
            {notice && (
              <p className="text-sm text-text-secondary mb-4" role="status">
                {notice}
              </p>
            )}
            <Checkbox
              checked={acceptedDealerTerms}
              onCheckedChange={(checked) => setAcceptedDealerTerms(checked === true)}
              required
              error={firstFieldError(fieldErrors, "acceptedDealerTerms")}
              label={
                <>
                  I accept the{" "}
                  <Link href="/dealer-terms" className="text-text-trust hover:underline">
                    Dealer Terms
                  </Link>
                  ,{" "}
                  <Link href="/acceptable-use" className="text-text-trust hover:underline">
                    Acceptable Use Policy
                  </Link>
                  , and{" "}
                  <Link href="/refunds" className="text-text-trust hover:underline">
                    Refund Policy
                  </Link>
                </>
              }
            />
            <Button
              onClick={handleSubscribe}
              className="w-full mt-4"
              loading={isPending}
            >
              Subscribe - {tierPrice}/month
            </Button>
            <div className="mt-4">
              <PaymentAwaitingStatus
                isAwaitingPayment={isAwaitingPayment}
                message="This page checks for subscription confirmation automatically. Ripple does not redirect back after payment."
              />
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-text-secondary">
        Want a different plan?{" "}
        <Link href="/pricing" className="text-text-trust hover:underline">
          View all plans
        </Link>
      </p>

      <RippleDemoCheckoutDialog
        open={demoDialogOpen}
        onOpenChange={setDemoDialogOpen}
        checkoutUrl={demoCheckoutUrl}
        checkoutLabel={`${tierLabel.toLowerCase()} subscription`}
        demoOutcomeControls={{
          isPending: isSimulatingDemoOutcome,
          error: demoOutcomeError,
          onSimulateSuccess: () => handleSimulatedDemoOutcome("success"),
          onSimulateDeclined: () => handleSimulatedDemoOutcome("declined"),
        }}
      />
    </div>
  );
}
