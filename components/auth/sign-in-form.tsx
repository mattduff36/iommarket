"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  firstZodMessage,
  publicAuthErrorMessage,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { emailField } from "@/lib/validations/email";

function getSafeNextPath(nextPath: string | null): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return null;
  return nextPath;
}

function getDealerTierIntent(value: unknown): "STARTER" | "PRO" | null {
  if (value === "STARTER" || value === "PRO") return value;
  return null;
}

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNextPath(searchParams.get("next"));
  const signUpHref = next
    ? `/sign-up?next=${encodeURIComponent(next)}`
    : "/sign-up";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const nextErrors: FieldErrors = {};
    const parsedEmail = emailField.safeParse(email);
    if (!parsedEmail.success) {
      const message = firstZodMessage(parsedEmail.error);
      if (message) nextErrors.email = [message];
    }
    if (!password) {
      nextErrors.password = ["Enter your password."];
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: parsedEmail.success ? parsedEmail.data : email,
        password,
      });
      if (err) {
        setError(
          publicAuthErrorMessage(
            err.message,
            "We could not sign you in. Check your email and password and try again.",
          ),
        );
        return;
      }

      if (next) {
        router.push(next);
        router.refresh();
        return;
      }

      try {
        const res = await fetch("/api/me", { credentials: "same-origin" });
        if (res.ok) {
          const me = await res.json();
          if (me.role === "ADMIN") {
            router.push("/admin");
            router.refresh();
            return;
          }
        }
      } catch {
        // fall through to default destination
      }

      const dealerTierIntent = getDealerTierIntent(
        data.user?.user_metadata?.dealer_tier_intent,
      );
      if (dealerTierIntent) {
        router.push(`/dealer/subscribe?tier=${dealerTierIntent}`);
        router.refresh();
        return;
      }

      router.push("/account");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto w-full max-w-sm space-y-4">
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        error={firstFieldError(fieldErrors, "email")}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        error={firstFieldError(fieldErrors, "password")}
      />
      <div className="flex flex-col gap-3">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <Link
          href={`/forgot-password${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-sm text-text-secondary hover:text-text-brand text-center"
        >
          Forgot password?
        </Link>
        <p className="text-center text-sm text-text-secondary">
          Need an account to save favourites, searches, or review dealers?{" "}
          <Link href={signUpHref} className="text-text-brand hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </form>
  );
}
