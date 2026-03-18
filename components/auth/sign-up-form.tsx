"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            ...(name ? { full_name: name } : {}),
          },
          emailRedirectTo: buildAuthCallbackUrl(next),
        },
      });
      if (err) {
        setError(err.message);
        return;
      }
      // Supabase silently "succeeds" for existing emails to prevent enumeration.
      // An empty identities array is the reliable signal that the email is already registered.
      if (data.user && data.user.identities?.length === 0) {
        setError(
          "An account with this email already exists. Please sign in instead.",
        );
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
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
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-sm space-y-4">
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Input
        label="Name (optional)"
        type="text"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {error && (
        <p className="text-sm text-text-energy" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <Button type="submit" className="w-full" disabled={loading}>
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
