"use client";

import { useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { joinWaitlist } from "@/actions/waitlist";
import { Checkbox } from "@/components/ui/checkbox";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  flattenZodFieldErrors,
  splitActionError,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import {
  joinWaitlistSchema,
  type WaitlistInterest,
} from "@/lib/validations/waitlist";

const INTEREST_OPTIONS: Array<{ id: WaitlistInterest; label: string }> = [
  { id: "BUYING_CARS", label: "I'm interested in BUYING cars" },
  { id: "SELLING_CARS", label: "I'm interested in SELLING cars" },
  { id: "DEALER", label: "I'm a DEALER" },
];

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [interests, setInterests] = useState<WaitlistInterest[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const interestsRef = useRef<HTMLFieldSetElement>(null);
  const consentRef = useRef<HTMLButtonElement>(null);

  const interestsSelected = useMemo(() => new Set(interests), [interests]);
  const summaryMessages = uniqueErrorMessages(fieldErrors, error);
  const emailError = firstFieldError(fieldErrors, "email");
  const interestsError = firstFieldError(fieldErrors, "interests");
  const consentError = firstFieldError(fieldErrors, "marketingConsent");

  function toggleInterest(interest: WaitlistInterest, checked: boolean) {
    setInterests((prev) => {
      if (checked) return prev.includes(interest) ? prev : [...prev, interest];
      return prev.filter((item) => item !== interest);
    });
  }

  function showFieldErrors(nextErrors: FieldErrors) {
    setFieldErrors(nextErrors);
    setError(null);
    if (nextErrors.email) {
      emailRef.current?.focus();
      return;
    }
    if (nextErrors.interests) {
      interestsRef.current?.focus();
      return;
    }
    if (nextErrors.marketingConsent) {
      consentRef.current?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setFieldErrors({});

    const parsed = joinWaitlistSchema.safeParse({
      email,
      interests,
      source: "coming_soon_page",
      marketingConsent,
    });
    if (!parsed.success) {
      setIsSubmitting(false);
      showFieldErrors(flattenZodFieldErrors(parsed.error));
      return;
    }

    const result = await joinWaitlist(parsed.data);

    setIsSubmitting(false);
    if (result.error) {
      const split = splitActionError(result.error);
      if (Object.keys(split.fieldErrors).length > 0) {
        showFieldErrors(split.fieldErrors);
        if (split.formError) setError(split.formError);
        return;
      }
      setError(split.formError);
      return;
    }

    setSubmitted(true);
    setEmail("");
    setInterests([]);
    setMarketingConsent(false);
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        Thanks! We&apos;ll notify you when the marketplace launches.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <FormErrorSummary messages={summaryMessages} />
      <Input
        ref={emailRef}
        label="Email Address"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
        error={emailError}
      />

      <fieldset
        ref={interestsRef}
        tabIndex={-1}
        aria-invalid={interestsError ? true : undefined}
        aria-describedby={interestsError ? "waitlist-interests-error" : undefined}
        className={[
          "space-y-3 rounded-md p-1 text-center outline-none",
          interestsError ? "ring-1 ring-neon-red-500" : "",
        ].join(" ")}
      >
        <legend className="w-full text-sm font-medium text-text-primary">
          What are you interested in?
        </legend>
        <p className="text-xs text-text-secondary">Select at least one.</p>
        <div className="inline-flex flex-col items-stretch gap-2">
          {INTEREST_OPTIONS.map((option) => {
            const selected = interestsSelected.has(option.id);
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                size="md"
                aria-pressed={selected}
                onClick={() => toggleInterest(option.id, !selected)}
                className={[
                  "border text-sm normal-case not-italic whitespace-nowrap",
                  "focus-visible:ring-neon-blue-500",
                  selected
                    ? "border-neon-blue-500 bg-neon-blue-500/15 text-text-primary shadow-glow-blue"
                    : "border-border bg-surface-elevated text-text-secondary hover:bg-surface",
                ].join(" ")}
              >
                <span className="flex items-center justify-center gap-2">
                  <span
                    aria-hidden="true"
                    className={[
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2",
                      selected
                        ? "border-neon-blue-500 bg-neon-blue-500 text-white"
                        : "border-text-secondary bg-surface",
                    ].join(" ")}
                  >
                    {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  {option.label}
                </span>
              </Button>
            );
          })}
        </div>
        {interestsError ? (
          <p id="waitlist-interests-error" className="text-xs text-text-error">
            {interestsError}
          </p>
        ) : null}
      </fieldset>

      <Checkbox
        ref={consentRef}
        checked={marketingConsent}
        onCheckedChange={(value) => setMarketingConsent(value === true)}
        required
        error={consentError}
        label="I want launch updates from iTrader.im. I can unsubscribe or request removal at any time."
      />
      <p className="text-xs leading-relaxed text-text-tertiary">
        To unsubscribe or remove your details, email hello@itrader.im or use the
        unsubscribe link in any launch email.
      </p>

      <div className="mt-5 flex justify-center">
        <Button type="submit" className="w-full sm:w-auto" loading={isSubmitting}>
          Join Waiting List
        </Button>
      </div>
    </form>
  );
}
