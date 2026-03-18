"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(err.message);
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
          const data = await res.json();
          if (data.role === "ADMIN") {
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
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
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
          No account?{" "}
          <Link href={signUpHref} className="text-text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </form>
  );
}
