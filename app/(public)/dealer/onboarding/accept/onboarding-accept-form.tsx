"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { completeDealerOnboardingClaim } from "@/actions/dealer-onboarding";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function OnboardingAcceptForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ageAttested, setAgeAttested] = useState(false);
  const [accountPoliciesAccepted, setAccountPoliciesAccepted] = useState(false);
  const [dealerPoliciesAccepted, setDealerPoliciesAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (completed) {
    return (
      <div className="space-y-3">
        <p className="text-text-primary">Your dealer account is ready.</p>
        <p className="text-sm text-text-secondary">
          Sign in with the owner email from the invitation and the password you just chose.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await completeDealerOnboardingClaim({
            password,
            confirmPassword,
            ageAttested,
            accountPoliciesAccepted,
            dealerPoliciesAccepted,
          });
          if (result.error) {
            setError(typeof result.error === "string" ? result.error : "Check the form and try again.");
            return;
          }
          setCompleted(true);
        });
      }}
    >
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      <Checkbox
        checked={ageAttested}
        onCheckedChange={(value) => setAgeAttested(value === true)}
        label="I confirm I am 18 or over."
      />
      <Checkbox
        checked={accountPoliciesAccepted}
        onCheckedChange={(value) => setAccountPoliciesAccepted(value === true)}
        label={
          <span>
            I acknowledge the current{" "}
            <Link href="/terms" className="text-text-trust hover:underline">Terms</Link>,{" "}
            <Link href="/acceptable-use" className="text-text-trust hover:underline">Acceptable Use Policy</Link>, and{" "}
            <Link href="/privacy" className="text-text-trust hover:underline">Privacy Policy</Link>.
          </span>
        }
      />
      <Checkbox
        checked={dealerPoliciesAccepted}
        onCheckedChange={(value) => setDealerPoliciesAccepted(value === true)}
        label={
          <span>
            I accept the{" "}
            <Link href="/dealer-terms" className="text-text-trust hover:underline">Dealer Terms</Link>,{" "}
            <Link href="/acceptable-use" className="text-text-trust hover:underline">Acceptable Use Policy</Link>, and{" "}
            <Link href="/refunds" className="text-text-trust hover:underline">Refund Policy</Link>.
          </span>
        }
      />
      {error ? <p className="text-sm text-text-error">{error}</p> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Activating…" : "Accept and activate account"}
      </Button>
    </form>
  );
}
