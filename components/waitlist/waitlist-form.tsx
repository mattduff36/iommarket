"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { joinWaitlist } from "@/actions/waitlist";
import type { WaitlistInterest } from "@/lib/validations/waitlist";

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
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string[];
    interests?: string[];
  }>({});

  const interestsSelected = useMemo(() => new Set(interests), [interests]);

  function toggleInterest(interest: WaitlistInterest, checked: boolean) {
    setInterests((prev) => {
      if (checked) return prev.includes(interest) ? prev : [...prev, interest];
      return prev.filter((item) => item !== interest);
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setFieldErrors({});

    const result = await joinWaitlist({
      email,
      interests,
      source: "coming_soon_page",
    });

    setIsSubmitting(false);
    if (result.error) {
      if (typeof result.error === "string") {
        setError(result.error);
      } else {
        setFieldErrors(result.error);
      }
      return;
    }

    setSubmitted(true);
    setEmail("");
    setInterests([]);
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        Thanks! We&apos;ll notify you when the marketplace launches.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email Address"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        required
        error={fieldErrors.email?.[0]}
      />

      <fieldset className="space-y-3 text-center">
        <legend className="sr-only">Interests</legend>
        <div className="flex flex-col items-center gap-2">
          {INTEREST_OPTIONS.map((option) => {
            const selected = interestsSelected.has(option.id);
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                size="lg"
                aria-pressed={selected}
                onClick={() => toggleInterest(option.id, !selected)}
                className={[
                  "w-full max-w-md border text-base normal-case not-italic",
                  "focus-visible:ring-neon-blue-500",
                  selected
                    ? "border-neon-blue-500 bg-neon-blue-500/15 text-text-primary shadow-glow-blue"
                    : "border-border bg-surface-elevated text-text-secondary hover:bg-surface",
                ].join(" ")}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        {fieldErrors.interests?.[0] ? (
          <p className="text-xs text-text-energy">{fieldErrors.interests[0]}</p>
        ) : null}
      </fieldset>

      {error ? <p className="text-xs text-text-error">{error}</p> : null}

      <div className="mt-5 flex justify-center">
        <Button type="submit" className="w-full sm:w-auto" loading={isSubmitting}>
          Join Waiting List
        </Button>
      </div>
    </form>
  );
}
