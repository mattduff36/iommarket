"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export const SIGNUP_VERIFICATION_POLL_MS = 10_000;
export const SIGNUP_VERIFICATION_RATE_LIMIT_POLL_MS = 30_000;
export const SIGNUP_VERIFICATION_WINDOW_MS = 15 * 60_000;

type VerificationPhase = "waiting" | "needs-sign-in" | "timed-out";

export function signupVerificationRetryDelayMs(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("rate") || lower.includes("too many")) {
    return SIGNUP_VERIFICATION_RATE_LIMIT_POLL_MS;
  }
  return SIGNUP_VERIFICATION_POLL_MS;
}

interface SignupVerificationWaitProps {
  email: string;
  password: string;
  nextPath: string;
  signInHref: string;
}

export function SignupVerificationWait({
  email,
  password,
  nextPath,
  signInHref,
}: SignupVerificationWaitProps) {
  const router = useRouter();
  const navigateRef = useRef(router.push);
  const refreshRef = useRef(router.refresh);
  navigateRef.current = router.push;
  refreshRef.current = router.refresh;
  const [phase, setPhase] = useState<VerificationPhase>("waiting");

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    function stop(nextPhase: Exclude<VerificationPhase, "waiting">) {
      stopped = true;
      if (timer) clearTimeout(timer);
      setPhase(nextPhase);
    }

    function schedule(delayMs: number) {
      if (stopped) return;
      const remaining = SIGNUP_VERIFICATION_WINDOW_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        stop("timed-out");
        return;
      }
      timer = setTimeout(() => {
        void attempt();
      }, Math.min(delayMs, remaining));
    }

    async function attempt() {
      if (stopped || inFlight) return;
      if (Date.now() - startedAt >= SIGNUP_VERIFICATION_WINDOW_MS) {
        stop("timed-out");
        return;
      }

      inFlight = true;
      try {
        const supabase = createSupabaseBrowserClient();
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (stopped) return;
        if (!result || result.error) {
          schedule(signupVerificationRetryDelayMs(result?.error?.message ?? ""));
          return;
        }

        const response = await fetch("/api/me", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (stopped) return;
        if (!response.ok) {
          stop("needs-sign-in");
          return;
        }

        stopped = true;
        if (timer) clearTimeout(timer);
        navigateRef.current(nextPath);
        refreshRef.current();
      } catch {
        if (!stopped) schedule(SIGNUP_VERIFICATION_POLL_MS);
      } finally {
        inFlight = false;
      }
    }

    void attempt();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [email, nextPath, password]);

  const heading =
    phase === "needs-sign-in"
      ? "Verified — sign in to continue"
      : phase === "timed-out"
        ? "Sign in to continue"
        : "Check your email";
  const fallbackMessage =
    phase === "needs-sign-in"
      ? "Your email is verified, but this browser still needs you to sign in before your account can open."
      : "We could not finish signing you in automatically. Open the confirmation link if you have not already, then sign in.";

  return (
    <div className="mx-auto max-w-sm space-y-4 py-20 text-center">
      <h2 className="text-2xl font-bold text-text-primary">{heading}</h2>
      <p className="text-text-secondary" role="status">
        {phase === "waiting" ? (
          <>
            We&apos;ve sent a confirmation link to{" "}
            <span className="font-medium text-text-primary">{email}</span>. This page
            will open your account after this browser signs in.
          </>
        ) : (
          fallbackMessage
        )}
      </p>
      <Button asChild variant="ghost" className="w-full">
        <Link href={signInHref}>Go to sign in</Link>
      </Button>
    </div>
  );
}
