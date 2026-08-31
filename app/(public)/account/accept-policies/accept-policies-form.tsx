"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptCurrentPolicies } from "@/actions/policy/accept";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  flattenZodFieldErrors,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { acceptPoliciesSchema } from "@/lib/validations/auth";

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const parsed = acceptPoliciesSchema.safeParse({
        ageAttested,
        policiesAccepted,
      });
      if (!parsed.success) {
        setFieldErrors(flattenZodFieldErrors(parsed.error));
        return;
      }

      const result = await acceptCurrentPolicies(parsed.data);
      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(split.formError);
        return;
      }
      router.push(getSafeNextPath(searchParams.get("next")));
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <Checkbox
        checked={ageAttested}
        onCheckedChange={(value) => setAgeAttested(value === true)}
        required
        error={firstFieldError(fieldErrors, "ageAttested")}
        label="I confirm I am 18 or over."
      />
      <Checkbox
        checked={policiesAccepted}
        onCheckedChange={(value) => setPoliciesAccepted(value === true)}
        required
        error={firstFieldError(fieldErrors, "policiesAccepted")}
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
      <Button type="submit" loading={loading}>
        Continue
      </Button>
    </form>
  );
}
