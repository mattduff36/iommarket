"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { captureException } from "@/lib/monitoring";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import {
  commitOnboardingClaim,
  markOnboardingCompleted,
  OnboardingClaimError,
} from "@/lib/dealers/onboarding/activate";
import {
  generateDealerRecoveryLink,
  invalidateDealerAuthSessions,
  revokeAuthUserSessions,
  updateAuthUserEmail,
} from "@/lib/dealers/onboarding/auth-admin";
import {
  clearOnboardingClaimCookie,
  readOnboardingClaimCookie,
  writeOnboardingClaimCookie,
} from "@/lib/dealers/onboarding/claim-cookie";
import { buildOnboardingRedirectUrl } from "@/lib/dealers/onboarding/recovery-link";
import { displayOnboardingStatus } from "@/lib/dealers/onboarding/statuses";
import {
  createLeaseToken,
  hashOnboardingToken,
  ONBOARDING_LEASE_MS,
  onboardingTokenMatches,
  sanitizeOnboardingError,
} from "@/lib/dealers/onboarding/tokens";
import {
  onboardingAcceptanceSchema,
  onboardingClaimSchema,
} from "@/lib/validations/dealer-onboarding";

const CLAIM_RATE = { windowMs: 10 * 60_000, maxRequests: 8 };

export async function beginDealerOnboardingClaim(input: { token: string }) {
  const parsed = onboardingClaimSchema.safeParse(input);
  if (!parsed.success) return { error: "This invitation link is not valid." };
  const tokenHash = hashOnboardingToken(parsed.data.token);
  const bootstrapRateError = rateLimitActionError(
    await checkRateLimit(`dealer-onboarding-bootstrap:${tokenHash}`, {
      ...CLAIM_RATE,
      policy: "dealer-onboarding-bootstrap",
    }),
    "Too many attempts. Wait a few minutes and try again.",
  );
  if (bootstrapRateError) return { error: bootstrapRateError };

  try {
    const invite = await db.dealerOnboardingInvite.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!invite || !onboardingTokenMatches(parsed.data.token, invite.tokenHash)) {
      return { error: "This invitation link is not valid." };
    }
    const displayed = displayOnboardingStatus(invite.status, invite.expiresAt, now);
    if (displayed === "EXPIRED") {
      await db.dealerOnboardingInvite.updateMany({
        where: { id: invite.id, status: invite.status },
        data: { status: "EXPIRED" },
      });
      return { error: "This invitation has expired. Ask iTrader to send a new one." };
    }
    if (
      invite.status !== "SENT" &&
      invite.status !== "CLAIMING" &&
      invite.status !== "FINALIZING_AUTH"
    ) {
      return { error: "This invitation is no longer valid." };
    }

    const recovery = await generateRecoveryForInvite(invite);
    if (recovery.authUserId !== invite.targetAuthUserId) {
      return { error: "This invitation does not match the dealer account." };
    }
    await writeOnboardingClaimCookie(parsed.data.token);
    if (invite.status !== "FINALIZING_AUTH") {
      await db.dealerOnboardingInvite.updateMany({
        where: { id: invite.id, status: { in: ["SENT", "CLAIMING"] }, tokenHash },
        data: { status: "CLAIMING", claimedAt: invite.claimedAt ?? now },
      });
    }
    redirect(recovery.actionLink);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    await captureException({
      source: "SERVER",
      error,
      action: "beginDealerOnboardingClaim",
      route: "/dealer/onboarding/claim",
      requestPath: "/dealer/onboarding/claim",
    });
    return { error: "Unable to continue this invitation. Try the email link again." };
  }
}

export async function completeDealerOnboardingClaim(input: {
  password: string;
  confirmPassword: string;
  ageAttested: boolean;
  accountPoliciesAccepted: boolean;
  dealerPoliciesAccepted: boolean;
}) {
  const parsed = onboardingAcceptanceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const cookieToken = await readOnboardingClaimCookie();
  if (!cookieToken || cookieToken.length < 32) {
    return { error: "Open the invitation email and continue securely again." };
  }
  const tokenHash = hashOnboardingToken(cookieToken);
  const submitRateError = rateLimitActionError(
    await checkRateLimit(`dealer-onboarding-submit:${tokenHash}`, {
      ...CLAIM_RATE,
      policy: "dealer-onboarding-submit",
    }),
    "Too many attempts. Wait a few minutes and try again.",
  );
  if (submitRateError) return { error: submitRateError };

  const invite = await db.dealerOnboardingInvite.findUnique({ where: { tokenHash } });
  if (!invite || !onboardingTokenMatches(cookieToken, invite.tokenHash)) {
    return { error: "This invitation link is not valid." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== invite.targetAuthUserId) {
    return { error: "This secure link does not match the invitation." };
  }
  if (invite.status === "REVOKED" || invite.status === "EXPIRED") {
    return { error: "This invitation is no longer valid." };
  }

  const now = new Date();
  const leaseToken = invite.status === "COMPLETED" ? null : createLeaseToken();
  try {
    if (leaseToken) {
      const outcome = await runSerializable((tx) =>
        commitOnboardingClaim(tx, {
          inviteId: invite.id,
          tokenHash,
          leaseToken,
          now,
          leaseExpiresAt: new Date(now.getTime() + ONBOARDING_LEASE_MS),
          recipientEmailNorm: invite.recipientEmailNorm,
          actorUserId: invite.userId,
        }),
      );
      if (outcome.kind !== "already-complete") {
        await renewOnboardingLease(invite.id, leaseToken);
        const passwordResult = await supabase.auth.updateUser({
          password: parsed.data.password,
        });
        if (passwordResult.error) {
          await releaseOnboardingLease(invite.id, leaseToken);
          return { error: "Choose a stronger password, then try again." };
        }
        await renewOnboardingLease(invite.id, leaseToken);
        const updatedAuth = await updateAuthUserEmail({
          authUserId: invite.targetAuthUserId,
          email: invite.recipientEmailNorm,
        });
        if (
          updatedAuth.id !== invite.targetAuthUserId ||
          updatedAuth.email.trim().toLowerCase() !== invite.recipientEmailNorm
        ) {
          await releaseOnboardingLease(invite.id, leaseToken);
          throw new OnboardingClaimError("Unable to confirm the dealer email address.");
        }
      }
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error("Unable to finish signing out the old session.");
    }
    if (leaseToken) await renewOnboardingLease(invite.id, leaseToken);
    await revokeAuthUserSessions(session.access_token);
    await invalidateDealerAuthSessions(invite.targetAuthUserId);
    const signedOut = await supabase.auth.signOut({ scope: "global" });
    if (signedOut.error) {
      throw new Error("Unable to finish signing out the old session.");
    }
    await clearOnboardingClaimCookie();
    if (invite.status !== "COMPLETED") {
      await runSerializable((tx) =>
        markOnboardingCompleted(tx, {
          inviteId: invite.id,
          userId: invite.userId,
          dealerId: invite.dealerId,
          targetAuthUserId: invite.targetAuthUserId,
          actorUserId: invite.userId,
          now: new Date(),
        }),
      );
    }
    return { data: { completed: true as const } };
  } catch (error) {
    if (error instanceof OnboardingClaimError) {
      return { error: error.message };
    }
    const lastError = sanitizeOnboardingError(error);
    if (leaseToken) {
      await db.dealerOnboardingInvite.updateMany({
        where: {
          id: invite.id,
          leaseToken,
          status: { in: ["CLAIMING", "FINALIZING_AUTH"] },
        },
        data: { lastError, leaseToken: null, leaseExpiresAt: null },
      }).catch(() => undefined);
    }
    await captureException({
      source: "SERVER",
      error,
      action: "completeDealerOnboardingClaim",
      route: "/dealer/onboarding/accept",
      requestPath: "/dealer/onboarding/accept",
      userId: invite.userId,
      tags: { inviteId: invite.id },
    });
    return {
      error: "We could not finish activating this account. Submit the form again.",
    };
  }
}

async function generateRecoveryForInvite(invite: {
  status: string;
  originalEmail: string;
  recipientEmailNorm: string;
  targetAuthUserId: string;
}) {
  const emails = invite.status === "FINALIZING_AUTH"
    ? [invite.recipientEmailNorm, invite.originalEmail]
    : [invite.originalEmail];
  let lastError: unknown;
  for (const email of emails) {
    try {
      const recovery = await generateDealerRecoveryLink({
        email,
        redirectTo: buildOnboardingRedirectUrl(getCanonicalBaseUrl().origin),
      });
      if (recovery.authUserId === invite.targetAuthUserId) return recovery;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to start secure account claim.");
}

async function renewOnboardingLease(inviteId: string, leaseToken: string) {
  const renewed = await db.dealerOnboardingInvite.updateMany({
    where: {
      id: inviteId,
      leaseToken,
      status: { in: ["CLAIMING", "FINALIZING_AUTH"] },
    },
    data: { leaseExpiresAt: new Date(Date.now() + ONBOARDING_LEASE_MS) },
  });
  if (renewed.count !== 1) {
    throw new OnboardingClaimError(
      "This invitation is already being completed. Wait a moment and try again.",
    );
  }
}

async function releaseOnboardingLease(inviteId: string, leaseToken: string) {
  await db.dealerOnboardingInvite.updateMany({
    where: {
      id: inviteId,
      leaseToken,
      status: { in: ["CLAIMING", "FINALIZING_AUTH"] },
    },
    data: { leaseToken: null, leaseExpiresAt: null },
  }).catch(() => undefined);
}

async function runSerializable<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(callback, { isolationLevel: "Serializable" });
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === 1
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String(error.digest).startsWith("NEXT_REDIRECT")
  );
}
