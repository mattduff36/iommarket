"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  disableDealerCorrespondence,
  resendDealerCorrespondenceVerification,
  saveDealerCorrespondenceSettings,
} from "@/actions/dealer/correspondence";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  CORRESPONDENCE_SECURITY_NOTE,
  DEALER_EMAIL_CATEGORY_OPTIONS,
  canonicalCorrespondenceCategories,
  correspondenceRoutingNote,
  type DealerCorrespondenceCategory,
} from "@/lib/dealers/correspondence";
import {
  firstFieldError,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";

interface Props {
  primaryEmail: string;
  verifiedEmail: string | null;
  pendingEmail: string | null;
  verificationExpiresAt: string | null;
  categories: readonly DealerCorrespondenceCategory[];
  copyAssignedToPrimary: boolean;
}

export function DealerCorrespondenceSettingsCard({
  primaryEmail,
  verifiedEmail,
  pendingEmail,
  verificationExpiresAt,
  categories: initialCategories,
  copyAssignedToPrimary: initialCopy,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(Boolean(verifiedEmail || pendingEmail));
  const [email, setEmail] = useState(pendingEmail ?? verifiedEmail ?? "");
  const [categories, setCategories] = useState<DealerCorrespondenceCategory[]>(
    canonicalCorrespondenceCategories(initialCategories),
  );
  const [copyAssignedToPrimary, setCopyAssignedToPrimary] = useState(initialCopy);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [isResending, startResend] = useTransition();
  const isPending = isSaving || isResending;

  function resetFeedback() {
    setError(null);
    setFieldErrors({});
    setSuccess(null);
  }

  function applyResult(result: { error?: unknown }) {
    if (!result.error) return false;
    const split = splitActionError(result.error);
    setFieldErrors(split.fieldErrors);
    setError(
      split.formError ??
        (Object.keys(split.fieldErrors).length > 0
          ? null
          : "We could not save your email preferences. Try again."),
    );
    return true;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    startSave(async () => {
      if (!enabled) {
        const result = await disableDealerCorrespondence();
        if (applyResult(result)) return;
        setSuccess("All iTrader emails will go to your login address.");
        router.refresh();
        return;
      }

      const result = await saveDealerCorrespondenceSettings({
        email,
        categories,
        copyAssignedToPrimary,
      });
      if (applyResult(result) || !("data" in result)) return;
      if (result.data.status === "pending" && result.data.emailSent) {
        setSuccess(
          `We sent a confirmation link to ${result.data.email}. Selected emails stay on your current address until it is confirmed.`,
        );
      } else if (result.data.status === "pending") {
        setSuccess(
          `Correspondence preferences saved. ${result.data.email} is still waiting for confirmation.`,
        );
      } else {
        setSuccess("Correspondence preferences saved.");
      }
      router.refresh();
    });
  }

  function handleResend() {
    resetFeedback();
    startResend(async () => {
      const result = await resendDealerCorrespondenceVerification();
      if (applyResult(result) || !("data" in result)) return;
      setSuccess(
        result.data?.email
          ? `We sent a new confirmation link to ${result.data.email}.`
          : "We sent a new confirmation link.",
      );
      router.refresh();
    });
  }

  function toggleCategory(category: DealerCorrespondenceCategory, checked: boolean) {
    setCategories((current) =>
      canonicalCorrespondenceCategories(
        checked ? [...current, category] : current.filter((item) => item !== category),
      ),
    );
  }

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Email preferences</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Login email: </span>
            {primaryEmail}
          </p>
          <p className="text-sm text-text-secondary">{CORRESPONDENCE_SECURITY_NOTE}</p>
          <Switch
            checked={enabled}
            disabled={isPending}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              resetFeedback();
            }}
            label="Use a second correspondence email"
          />
          {enabled ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                {correspondenceRoutingNote({
                  primaryEmail,
                  verifiedEmail,
                  pendingEmail,
                  verificationExpiresAt,
                })}
              </p>
              <Input
                label="Second email address"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={320}
                error={firstFieldError(fieldErrors, "email")}
              />
              {pendingEmail ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  loading={isResending}
                  onClick={handleResend}
                >
                  Resend confirmation link
                </Button>
              ) : null}
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-text-primary">
                  Send these emails to the second address
                </legend>
                <p className="text-sm text-text-secondary">
                  Anything you leave unselected goes to your login address. These choices can be saved before the second address is confirmed, but they do not take effect until then.
                </p>
                {DEALER_EMAIL_CATEGORY_OPTIONS.map((option) => (
                  <Checkbox
                    key={option.value}
                    checked={categories.includes(option.value)}
                    disabled={isPending}
                    onCheckedChange={(checked) => toggleCategory(option.value, checked === true)}
                    label={
                      <span>
                        {option.label}
                        <span className="mt-0.5 block text-text-secondary">{option.description}</span>
                      </span>
                    }
                  />
                ))}
              </fieldset>
              <Switch
                checked={copyAssignedToPrimary}
                disabled={isPending}
                onCheckedChange={(checked) => setCopyAssignedToPrimary(checked)}
                label="Also send assigned emails to my login address"
              />
              <p className="text-sm text-text-secondary">
                Off by default. When on, every email assigned to the second address is also sent to your login address.
              </p>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              All iTrader emails go to your login address.
            </p>
          )}
          <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
          {success ? <p className="text-sm text-neon-blue-400">{success}</p> : null}
          <Button type="submit" loading={isSaving} disabled={isPending}>
            Save email preferences
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
