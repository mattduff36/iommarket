import type { Prisma } from "@prisma/client";
import { recordAcceptance } from "@/lib/policy/acceptance";
import { planPromotionGrant, type PromotionGrantSnapshot } from "@/lib/dealers/onboarding/grant-plan";
import { buildOnboardingPolicySnapshot } from "@/lib/dealers/onboarding/policy-snapshot";

type ClaimClient = Prisma.TransactionClient;

export class OnboardingClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingClaimError";
  }
}

export async function commitOnboardingClaim(
  tx: ClaimClient,
  input: {
    inviteId: string;
    tokenHash: string;
    leaseToken: string;
    now: Date;
    leaseExpiresAt: Date;
    recipientEmailNorm: string;
    actorUserId: string;
  },
) {
  const invite = await tx.dealerOnboardingInvite.findUnique({
    where: { id: input.inviteId },
  });
  if (!invite || invite.tokenHash !== input.tokenHash) {
    throw new OnboardingClaimError("This invitation link is no longer valid.");
  }
  if (invite.recipientEmailNorm !== input.recipientEmailNorm) {
    throw new OnboardingClaimError("This invitation link is no longer valid.");
  }
  if (invite.status === "COMPLETED") return { kind: "already-complete" as const };
  if (invite.status === "REVOKED" || invite.status === "EXPIRED") {
    throw new OnboardingClaimError("This invitation is no longer valid.");
  }
  if (invite.status === "FINALIZING_AUTH") {
    const resumed = await tx.dealerOnboardingInvite.updateMany({
      where: {
        id: invite.id,
        tokenHash: input.tokenHash,
        status: "FINALIZING_AUTH",
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: input.now } },
          { leaseToken: input.leaseToken },
        ],
      },
      data: {
        leaseToken: input.leaseToken,
        leaseExpiresAt: input.leaseExpiresAt,
        lastError: null,
      },
    });
    if (resumed.count !== 1) {
      throw new OnboardingClaimError(
        "This invitation is already being completed. Wait a moment and try again.",
      );
    }
    return { kind: "resume" as const };
  }

  if (invite.expiresAt.getTime() <= input.now.getTime()) {
    throw new OnboardingClaimError("This invitation has expired. Ask iTrader to send a new one.");
  }
  if (invite.status !== "SENT" && invite.status !== "CLAIMING") {
    throw new OnboardingClaimError("This invitation is no longer valid.");
  }

  const claimed = await tx.dealerOnboardingInvite.updateMany({
    where: {
      id: invite.id,
      tokenHash: input.tokenHash,
      status: { in: ["SENT", "CLAIMING"] },
      expiresAt: { gt: input.now },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: input.now } },
        { leaseToken: input.leaseToken },
      ],
    },
    data: {
      status: "CLAIMING",
      leaseToken: input.leaseToken,
      leaseExpiresAt: input.leaseExpiresAt,
      claimedAt: invite.claimedAt ?? input.now,
    },
  });
  if (claimed.count !== 1) {
    throw new OnboardingClaimError(
      "This invitation is already being completed. Wait a moment and try again.",
    );
  }

  const dealer = await tx.dealerProfile.findUnique({
    where: { id: invite.dealerId },
    include: {
      user: { select: { id: true, authUserId: true, email: true, role: true, disabledAt: true, deletedAt: true } },
      subscriptions: {
        select: {
          id: true,
          source: true,
          status: true,
          grantStartsAt: true,
          grantEndsAt: true,
          revokedAt: true,
          currentPeriodEnd: true,
        },
      },
      listings: { select: { id: true, userId: true, dealerId: true } },
    },
  });
  if (
    !dealer ||
    dealer.isAdminPreview ||
    dealer.userId !== invite.userId ||
    dealer.user.id !== invite.userId ||
    dealer.user.authUserId !== invite.targetAuthUserId ||
    dealer.user.role !== "DEALER" ||
    dealer.user.disabledAt ||
    dealer.user.deletedAt ||
    dealer.listings.some(
      (listing) => listing.userId !== dealer.userId || listing.dealerId !== dealer.id,
    )
  ) {
    throw new OnboardingClaimError("This dealer account can no longer be claimed.");
  }

  const emailOwner = await tx.user.findFirst({
    where: {
      email: { equals: input.recipientEmailNorm, mode: "insensitive" },
      NOT: { id: dealer.userId },
    },
    select: { id: true },
  });
  if (emailOwner) {
    throw new OnboardingClaimError("That email address is already used by another account.");
  }

  const grant = planPromotionGrant({
    subscriptions: dealer.subscriptions as PromotionGrantSnapshot[],
    campaignStartsAt: invite.campaignStartsAt,
    campaignEndsAt: invite.campaignEndsAt,
    now: input.now,
  });
  if ("blocked" in grant) {
    throw new OnboardingClaimError("This dealer already has a paid subscription.");
  }

  await tx.user.update({
    where: { id: dealer.userId },
    data: { email: input.recipientEmailNorm },
  });
  const updatedUser = await tx.user.findUnique({
    where: { id: dealer.userId },
    select: { id: true, authUserId: true, email: true },
  });
  if (
    updatedUser?.id !== dealer.userId ||
    updatedUser.authUserId !== invite.targetAuthUserId ||
    updatedUser.email.toLowerCase() !== input.recipientEmailNorm
  ) {
    throw new OnboardingClaimError("This dealer account can no longer be claimed.");
  }

  await recordAcceptance(tx, {
    userId: dealer.userId,
    acceptanceType: "AGE_18",
    source: "ONBOARDING",
  });
  await recordAcceptance(tx, {
    userId: dealer.userId,
    acceptanceType: "ACCOUNT_BUNDLE",
    source: "ONBOARDING",
  });
  await recordAcceptance(tx, {
    userId: dealer.userId,
    acceptanceType: "PRIVACY_NOTICE",
    source: "ONBOARDING",
  });
  await recordAcceptance(tx, {
    userId: dealer.userId,
    acceptanceType: "DEALER_BUNDLE",
    source: "ONBOARDING",
  });

  await tx.dealerProfile.update({
    where: { id: dealer.id },
    data: { tier: "PRO" },
  });

  const grantData = {
    paymentProvider: "ADMIN" as const,
    source: "ADMIN_GRANT" as const,
    status: "ACTIVE" as const,
    currentPeriodEnd: grant.endsAt,
    grantStartsAt: grant.startsAt,
    grantEndsAt: grant.endsAt,
    revokedAt: null,
    promotionCampaignId: invite.campaignId,
    grantedByAdminId: invite.createdByAdminId,
  };
  const activeGrant = dealer.subscriptions.find(
    (subscription) => subscription.source === "ADMIN_GRANT" && subscription.status === "ACTIVE",
  );
  if (activeGrant) {
    await tx.subscription.update({ where: { id: activeGrant.id }, data: grantData });
  } else {
    await tx.subscription.create({ data: { dealerId: dealer.id, ...grantData } });
  }

  const finalized = await tx.dealerOnboardingInvite.updateMany({
    where: { id: invite.id, status: "CLAIMING", leaseToken: input.leaseToken },
    data: { status: "FINALIZING_AUTH", finalizingAt: input.now, lastError: null },
  });
  if (finalized.count !== 1) {
    throw new OnboardingClaimError("This invitation changed during activation. Try again.");
  }

  await tx.dealerOnboardingInviteEvent.create({
    data: {
      inviteId: invite.id,
      fromStatus: invite.status,
      toStatus: "FINALIZING_AUTH",
      actorUserId: input.actorUserId,
      source: "CLAIM",
      policySnapshot: buildOnboardingPolicySnapshot(input.now),
      metadata: {
        preservedUserId: dealer.userId,
        preservedAuthUserId: invite.targetAuthUserId,
        preservedDealerId: dealer.id,
        listingCount: dealer.listings.length,
        grantStartsAt: grant.startsAt.toISOString(),
        grantEndsAt: grant.endsAt.toISOString(),
      },
    },
  });

  return { kind: "finalizing" as const };
}

export async function markOnboardingCompleted(
  tx: ClaimClient,
  input: {
    inviteId: string;
    userId: string;
    dealerId: string;
    targetAuthUserId: string;
    actorUserId: string;
    now: Date;
  },
) {
  const completed = await tx.dealerOnboardingInvite.updateMany({
    where: {
      id: input.inviteId,
      userId: input.userId,
      dealerId: input.dealerId,
      targetAuthUserId: input.targetAuthUserId,
      status: "FINALIZING_AUTH",
    },
    data: {
      status: "COMPLETED",
      completedAt: input.now,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  if (completed.count !== 1) {
    const current = await tx.dealerOnboardingInvite.findUnique({
      where: { id: input.inviteId },
      select: { status: true },
    });
    if (current?.status === "COMPLETED") return { already: true as const };
    throw new OnboardingClaimError("Unable to finish dealer onboarding.");
  }
  await tx.dealerOnboardingInviteEvent.create({
    data: {
      inviteId: input.inviteId,
      fromStatus: "FINALIZING_AUTH",
      toStatus: "COMPLETED",
      actorUserId: input.actorUserId,
      source: "AUTH",
      metadata: { authEmailUpdated: true },
    },
  });
  return { already: false as const };
}
