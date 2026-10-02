import { cookies } from "next/headers";
import { syncUser } from "@/lib/auth";
import { checkSignupRateLimit } from "@/lib/auth/signup-rate-limit";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { db } from "@/lib/db";
import { notifyAdminOfNewSignup } from "@/lib/email/signup-notifications";
import { buildSignupAcceptanceReceipt } from "@/lib/policy/acceptance";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SignUpInput } from "@/lib/validations/auth";
import { EARLY_ACCESS_CLAIM_COOKIE } from "@/lib/waitlist/early-access/tokens";
import { readVerifiedEarlyAccessClaim } from "@/lib/waitlist/early-access/invite";

const CLAIM_LEASE_MS = 2 * 60 * 1000;

function emailsMatch(actual: string, expected: string) {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

function duplicateAccount(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered")
  );
}

async function releaseClaimLease(recipientId: string) {
  await db.waitlistEarlyAccessRecipient.updateMany({
    where: { id: recipientId, claimedAt: null },
    data: { claimLeaseExpiresAt: null },
  });
}

async function completeClaim(recipientId: string) {
  const completed = await db.waitlistEarlyAccessRecipient.updateMany({
    where: { id: recipientId, claimedAt: null },
    data: { claimedAt: new Date(), claimLeaseExpiresAt: null },
  });
  return completed.count === 1;
}

async function clearClaimCookie() {
  const store = await cookies();
  store.set(EARLY_ACCESS_CLAIM_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function completeInvitedSignUp(
  input: SignUpInput,
  clientAddress: string,
) {
  if (!isSupabaseAuthConfigured()) {
    return { error: "Account sign-up is temporarily unavailable. Please try again shortly." };
  }
  const claim = await readVerifiedEarlyAccessClaim();
  if (!claim) {
    return { error: "Use the invitation in your email to create an early-access account." };
  }
  if (!emailsMatch(input.email, claim.email)) {
    return { error: "This invitation is locked to the email address it was sent to." };
  }

  const rateLimit = await checkSignupRateLimit({
    email: claim.email,
    clientAddress,
  });
  if (!rateLimit.allowed) {
    return { error: "Too many signup attempts. Please wait a moment and try again." };
  }

  const leased = await db.waitlistEarlyAccessRecipient.updateMany({
    where: {
      id: claim.recipientId,
      claimedAt: null,
      OR: [
        { claimLeaseExpiresAt: null },
        { claimLeaseExpiresAt: { lt: new Date() } },
      ],
    },
    data: { claimLeaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS) },
  });
  if (leased.count !== 1) {
    return { error: "This invitation is already being used. Please wait a moment and try again." };
  }

  const receipt = buildSignupAcceptanceReceipt();
  const userMetadata = { full_name: input.name };
  const admin = createSupabaseAdminClient();
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email: claim.email,
      password: input.password,
      email_confirm: true,
      user_metadata: userMetadata,
      app_metadata: {
        policy_acceptance: receipt,
        early_access: true,
      },
    });
    if (error) {
      if (!duplicateAccount(error.message)) {
        await releaseClaimLease(claim.recipientId);
        return { error: "We could not create your account. Please try again shortly." };
      }
      await completeClaim(claim.recipientId);
      await clearClaimCookie();
      return { error: "An account with this email already exists. Please sign in instead." };
    }
    if (!data.user?.id) {
      await releaseClaimLease(claim.recipientId);
      return { error: "We could not create your account. Please try again shortly." };
    }
    await notifyAdminOfNewSignup({
      userId: data.user.id,
      email: claim.email,
      name: input.name,
      source: "early_access",
      createdAt: new Date(),
    });

    const supabase = await createSupabaseServerClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: claim.email,
      password: input.password,
    });
    await syncUser(data.user.id, claim.email, input.name, receipt);
    await completeClaim(claim.recipientId);
    await clearClaimCookie();
    if (signInError) {
      return { error: "Your account is ready. Sign in with the password you just chose." };
    }
    return { data: { email: claim.email, signedIn: true as const } };
  } catch {
    await releaseClaimLease(claim.recipientId);
    return { error: "We could not create your account. Please try again shortly." };
  }
}
