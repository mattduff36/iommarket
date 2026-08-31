"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { firstZodMessage, publicAuthErrorMessage } from "@/lib/forms/action-error";
import { emailField } from "@/lib/validations/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "");

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedEmail = emailField.safeParse(email);
    if (!parsedEmail.success) {
      setEmailError(firstZodMessage(parsedEmail.error));
      return;
    }
    setEmailError(undefined);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${APP_URL}/auth/callback?next=${encodeURIComponent("/account/change-password")}`;
      const { error: err } = await supabase.auth.resetPasswordForEmail(parsedEmail.data, {
        redirectTo,
      });
      if (err) {
        setError(
          publicAuthErrorMessage(
            err.message,
            "We could not send a reset email. Check the address and try again.",
          ),
        );
        return;
      }
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <p className="text-center text-text-primary">
        Check your email for a link to reset your password. If you don&apos;t see it, check your spam folder.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto w-full max-w-sm space-y-4">
      <FormErrorSummary messages={error ? [error] : []} />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        error={emailError}
      />
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
