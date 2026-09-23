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
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
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
            accountPoliciesAccepted: policiesAccepted,
            dealerPoliciesAccepted: policiesAccepted,
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
        required
        label="I confirm I am 18 or over."
      />
      <Checkbox
        checked={policiesAccepted}
        onCheckedChange={(value) => setPoliciesAccepted(value === true)}
        required
        label={
          <span>
            I acknowledge and accept the current{" "}
            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-text-trust hover:underline">Terms</Link>,{" "}
            <Link href="/dealer-terms" target="_blank" rel="noopener noreferrer" className="text-text-trust hover:underline">Dealer Terms</Link>,{" "}
            <Link href="/acceptable-use" target="_blank" rel="noopener noreferrer" className="text-text-trust hover:underline">Acceptable Use Policy</Link>,{" "}
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-text-trust hover:underline">Privacy Policy</Link>, and{" "}
            <Link href="/refunds" target="_blank" rel="noopener noreferrer" className="text-text-trust hover:underline">Refund Policy</Link>.
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
