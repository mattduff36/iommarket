"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptDealerUpgrade } from "@/actions/dealer-upgrade";
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
import { acceptDealerUpgradeSchema } from "@/lib/validations/dealer-upgrade";

export function DealerUpgradeForm({
  offerId,
  policyDigest,
}: {
  offerId: string;
  policyDigest: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const parsed = acceptDealerUpgradeSchema.safeParse({
      offerId,
      policyDigest,
      dealerPoliciesAccepted: accepted,
    });
    if (!parsed.success) {
      setFieldErrors(flattenZodFieldErrors(parsed.error));
      return;
    }

    startTransition(async () => {
      const result = await acceptDealerUpgrade(parsed.data);
      if (result.error) {
        const split = splitActionError(result.error);
        setFieldErrors(split.fieldErrors);
        setError(split.formError);
        return;
      }
      router.push("/dealer/profile");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <Checkbox
        checked={accepted}
        onCheckedChange={(value) => setAccepted(value === true)}
        required
        error={firstFieldError(fieldErrors, "dealerPoliciesAccepted")}
        label={
          <span>
            I have read and agree to the current{" "}
            <Link
              href="/dealer-terms"
              target="_blank"
              rel="noreferrer"
              className="text-text-trust hover:underline"
            >
              Dealer Terms
            </Link>
            ,{" "}
            <Link
              href="/acceptable-use"
              target="_blank"
              rel="noreferrer"
              className="text-text-trust hover:underline"
            >
              Acceptable Use Policy
            </Link>
            , and{" "}
            <Link
              href="/refunds"
              target="_blank"
              rel="noreferrer"
              className="text-text-trust hover:underline"
            >
              Refund Policy
            </Link>
            .
          </span>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={isPending}>
          Accept and activate dealer access
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href="/account">Not now</Link>
        </Button>
      </div>
    </form>
  );
}
