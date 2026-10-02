"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import {
  firstFieldError,
  firstZodMessage,
  uniqueErrorMessages,
  type FieldErrors,
} from "@/lib/forms/action-error";
import { emailField } from "@/lib/validations/email";
import {
  signupFailureMessage,
  withoutFieldError,
  SIGNUP_PROVIDER_RETRY_MESSAGE,
} from "@/components/auth/signup-feedback";
import { profileNameSchema } from "@/lib/validations/profile-name";
import { trackMarketplaceEvent } from "@/lib/analytics/track-client";

function getSafeNextPath(nextPath: string | null): string {
  if (!nextPath) return "/";
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/";
  return nextPath;
}

function buildAuthCallbackUrl(nextPath: string): string {
  const fallbackOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    fallbackOrigin ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  return `${appUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = getSafeNextPath(searchParams.get("next"));
  const signInHref = next !== "/"
    ? `/sign-in?next=${encodeURIComponent(next)}`
    : "/sign-in";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitLock = useRef(false);
  const focusInvalidRef = useRef(false);

  function showFieldErrors(next: FieldErrors) {
    focusInvalidRef.current = Object.keys(next).length > 0;
    setFieldErrors(next);
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  useEffect(() => {
    if (!focusInvalidRef.current) return;
    focusInvalidRef.current = false;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [fieldErrors]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitLock.current) return;
    setError(null);
    const nextErrors: FieldErrors = {};
    const parsedEmail = emailField.safeParse(email);
    if (!parsedEmail.success) {
      const message = firstZodMessage(parsedEmail.error);
      if (message) nextErrors.email = [message];
    }
    if (password.length < 8) {
      nextErrors.password = ["Password must be at least 8 characters."];
    }
    const parsedName = profileNameSchema.safeParse(name);
    if (!parsedName.success) {
      const message = firstZodMessage(parsedName.error);
      if (message) nextErrors.name = [message];
    }
    if (Object.keys(nextErrors).length > 0) {
      showFieldErrors(nextErrors);
      return;
    }

    showFieldErrors({});
    submitLock.current = true;
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: err } = await supabase.auth.signUp({
        email: parsedEmail.success ? parsedEmail.data : email,
        password,
        options: {
          data: {
            full_name: parsedName.success ? parsedName.data : name,
          },
          emailRedirectTo: buildAuthCallbackUrl(next),
        },
      });
      if (err) {
        setError(signupFailureMessage(err.message, false));
        return;
      }
      if (data.user && data.user.identities?.length === 0) {
        setError(
          "An account with this email already exists. Please sign in instead.",
        );
        return;
      }
      trackMarketplaceEvent("signup_completed", { method: "password" });
      setSuccess(true);
      router.refresh();
    } catch {
      setError(SIGNUP_PROVIDER_RETRY_MESSAGE);
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-4 text-center">
        <p className="text-text-primary">
          Check your email to confirm your account. Then you can sign in.
        </p>
        <Button asChild variant="ghost" className="w-full">
          <Link href={signInHref}>Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="mx-auto w-full max-w-sm space-y-4"
    >
      <FormErrorSummary messages={uniqueErrorMessages(fieldErrors, error)} />
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clearFieldError("email");
        }}
        required
        error={firstFieldError(fieldErrors, "email")}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clearFieldError("password");
        }}
        required
        error={firstFieldError(fieldErrors, "password")}
      />
      <Input
        label="Name"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          clearFieldError("name");
        }}
        required
        minLength={2}
        maxLength={100}
        error={firstFieldError(fieldErrors, "name")}
      />
      <div className="flex flex-col gap-3">
        <Button
          type="submit"
          className="w-full"
          loading={loading}
          aria-busy={loading || undefined}
        >
          {loading ? "Creating account…" : "Sign up"}
        </Button>
        <p className="text-center text-sm text-text-secondary">
          Already have an account?{" "}
          <Link href={signInHref} className="text-text-trust hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
