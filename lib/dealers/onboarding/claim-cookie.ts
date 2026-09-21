import { cookies } from "next/headers";
import {
  ONBOARDING_CLAIM_COOKIE,
  ONBOARDING_CLAIM_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/dealers/onboarding/tokens";

export async function readOnboardingClaimCookie() {
  const store = await cookies();
  return store.get(ONBOARDING_CLAIM_COOKIE)?.value ?? null;
}

export async function writeOnboardingClaimCookie(token: string) {
  const store = await cookies();
  store.set(ONBOARDING_CLAIM_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONBOARDING_CLAIM_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearOnboardingClaimCookie() {
  const store = await cookies();
  store.delete(ONBOARDING_CLAIM_COOKIE);
}
