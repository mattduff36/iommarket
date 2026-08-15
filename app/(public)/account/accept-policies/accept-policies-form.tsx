"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptCurrentPolicies } from "@/actions/policy/accept";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

function getSafeNextPath(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/account";
  }
  return nextPath;
}

export function AcceptPoliciesForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ageAttested, setAgeAttested] = useState(false);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await acceptCurrentPolicies({
        ageAttested,
        policiesAccepted,
      });
      if (result.error) {
        setError(
          typeof result.error === "string"
            ? result.error
            : Object.values(result.error).flat()[0] ?? "Unable to save acceptance.",
        );
        return;
      }
      router.push(getSafeNextPath(searchParams.get("next")));
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            I acknowledge the current{" "}
            <Link href="/terms" className="text-text-trust hover:underline">
              Terms
            </Link>
            ,{" "}
            <Link href="/acceptable-use" className="text-text-trust hover:underline">
              Acceptable Use Policy
            </Link>
            , and{" "}
            <Link href="/privacy" className="text-text-trust hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        }
      />
      {error ? (
        <p className="text-sm text-text-energy" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={loading}>
        Continue
      </Button>
    </form>
  );
}
