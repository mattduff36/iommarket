"use server";

import { cookies } from "next/headers";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { shouldEnforceLaunchGate } from "@/lib/launch/gate";
import {
  createEarlyAccessClaimCookie,
  resolveEarlyAccessInvite,
} from "@/lib/waitlist/early-access/invite";
import { EARLY_ACCESS_CLAIM_COOKIE } from "@/lib/waitlist/early-access/tokens";
import { earlyAccessClaimSchema } from "@/lib/validations/waitlist-early-access";

export async function continueEarlyAccessClaim(input: {
  recipientId: string;
  proof: string;
}) {
  const parsed = earlyAccessClaimSchema.safeParse(input);
  if (!parsed.success || !shouldEnforceLaunchGate()) {
    return { error: "This invitation is no longer available." };
  }
  const rateError = rateLimitActionError(
    await checkRateLimit(
      makeRateLimitKey("early-access-claim", parsed.data.recipientId),
      { windowMs: 10 * 60_000, maxRequests: 10, policy: "early-access-claim" },
    ),
    "Too many attempts. Please wait a moment and try again.",
  );
  if (rateError) return { error: rateError };

  const invite = await resolveEarlyAccessInvite(parsed.data.recipientId, parsed.data.proof);
  if (!invite) return { error: "This invitation is no longer available." };
  const issued = createEarlyAccessClaimCookie(invite.recipientId, invite.nonce);
  if (!issued) return { error: "This invitation is no longer available." };

  const store = await cookies();
  store.set(EARLY_ACCESS_CLAIM_COOKIE, issued.value, issued.options);
  return { data: { redirect: "/sign-up" } };
}
