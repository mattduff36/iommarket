"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
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
      const redirectTo = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback?next=${encodeURIComponent(next)}`;
      // eslint-disable-next-line no-console
      console.group("[DEBUG] supabase.auth.signUp");
      // eslint-disable-next-line no-console
      console.log("payload", { email, redirectTo, hasName: !!name });
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: name ? { full_name: name } : undefined,
          emailRedirectTo: redirectTo,
        },
      });
      // eslint-disable-next-line no-console
      console.log("raw result", JSON.parse(JSON.stringify(result)));
      // eslint-disable-next-line no-console
      console.log("error", result.error);
      if (result.error) {
        // eslint-disable-next-line no-console
        console.log("error.message", result.error.message);
        // eslint-disable-next-line no-console
        console.log("error.status", result.error.status);
        // eslint-disable-next-line no-console
        console.log("error.name", result.error.name);
        // eslint-disable-next-line no-console
        console.log("error (all keys)", Object.keys(result.error));
        // eslint-disable-next-line no-console
        console.log("error (stringified)", JSON.stringify(result.error));
      }
      // eslint-disable-next-line no-console
      console.groupEnd();
      if (result.error) {
        setError(result.error.message);
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
          <Link href="/sign-in">Go to sign in</Link>
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
          <Link href="/sign-in" className="text-text-trust hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </form>
  );
}
