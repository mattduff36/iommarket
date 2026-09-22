"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { captureException } from "@/lib/monitoring";
import { getCanonicalBaseUrl } from "@/lib/seo/structured-data";
import { buildDealerOnboardingEmail } from "@/lib/email/dealer-onboarding";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { findAuthUserByEmail, invalidateDealerAuthSessions } from "@/lib/dealers/onboarding/auth-admin";
import {
  buildLaunchCampaignWindow,
  InvalidLaunchDateError,
  LAUNCH_PROMOTION_KEY,
} from "@/lib/dealers/onboarding/campaign-window";
import { planPromotionGrant } from "@/lib/dealers/onboarding/grant-plan";
import {
  canResendOnboardingInvite,
  canRevokeOnboardingInvite,
  LIVE_ONBOARDING_STATUSES,
} from "@/lib/dealers/onboarding/statuses";
import {
  createOnboardingToken,
  hashOnboardingToken,
  ONBOARDING_INVITE_TTL_MS,
  sanitizeOnboardingError,
} from "@/lib/dealers/onboarding/tokens";
import {
  createLaunchCampaignSchema,
  onboardingInviteIdSchema,
  sendDealerOnboardingSchema,
} from "@/lib/validations/dealer-onboarding";

const SEND_RATE = { windowMs: 10 * 60_000, maxRequests: 10 };

export async function createLaunchPromotionCampaign(input: { launchAtLocal: string }) {
  const admin = await requireRole("ADMIN");
  const parsed = createLaunchCampaignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const campaignRateError = rateLimitActionError(
    await checkRateLimit(`dealer-onboarding-campaign:${admin.id}`, {
      ...SEND_RATE,
      policy: "dealer-onboarding-campaign",
    }),
    "Too many campaign updates. Wait a few minutes and try again.",
  );
  if (campaignRateError) return { error: campaignRateError };

  try {
    const window = buildLaunchCampaignWindow(parsed.data.launchAtLocal);
    const existing = await db.dealerPromotionCampaign.findUnique({
      where: { key: LAUNCH_PROMOTION_KEY },
      include: { invites: { select: { sentAt: true }, take: 1, where: { sentAt: { not: null } } } },
    });
    if (existing?.lockedAt || (existing?.invites.length ?? 0) > 0) {
      return { error: "The launch campaign is locked because an invitation has been sent." };
    }

    const campaign = existing
      ? await (async () => {
          const updated = await db.dealerPromotionCampaign.updateMany({
            where: { id: existing.id, lockedAt: null },
            data: {
              timezone: window.timezone,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              tier: "PRO",
            },
          });
          if (updated.count !== 1) {
            return null;
          }
          return db.dealerPromotionCampaign.findUniqueOrThrow({ where: { id: existing.id } });
        })()
      : await db.dealerPromotionCampaign.create({
          data: {
            key: window.key,
            timezone: window.timezone,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            tier: "PRO",
            createdByAdminId: admin.id,
          },
        });
    if (!campaign) {
      return { error: "The launch campaign is locked because an invitation has been sent." };
    }

    await logAdminAction({
      adminId: admin.id,
      action: existing ? "UPDATE_DEALER_PROMOTION_CAMPAIGN" : "CREATE_DEALER_PROMOTION_CAMPAIGN",
      entityType: "DealerPromotionCampaign",
      entityId: campaign.id,
      details: {
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
        timezone: campaign.timezone,
      },
    });
    revalidatePath("/admin/dealer-onboarding");
    return {
      data: {
        id: campaign.id,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof InvalidLaunchDateError) return { error: error.message };
    await captureException({
      source: "SERVER",
      error,
      action: "createLaunchPromotionCampaign",
      route: "/admin/dealer-onboarding",
      requestPath: "/admin/dealer-onboarding",
      userId: admin.id,
    });
    return { error: "Unable to save the launch campaign." };
  }
}

export async function sendDealerOnboardingInvite(input: {
  dealerId: string;
  recipientEmail: string;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = sendDealerOnboardingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  const sendRateError = rateLimitActionError(
    await checkRateLimit(`dealer-onboarding-send:${admin.id}`, {
      ...SEND_RATE,
      policy: "dealer-onboarding-send",
    }),
    "Too many onboarding emails. Wait a few minutes and try again.",
  );
  if (sendRateError) return { error: sendRateError };

  const recipientEmailNorm = parsed.data.recipientEmail.trim().toLowerCase();
  try {
    const prepared = await prepareInvite({
      dealerId: parsed.data.dealerId,
      recipientEmailNorm,
      adminId: admin.id,
    });
    if ("error" in prepared) return { error: prepared.error };

    const origin = getCanonicalBaseUrl().origin;
    const claimUrl = `${origin}/dealer/onboarding/claim?token=${encodeURIComponent(prepared.token)}`;
    const email = buildDealerOnboardingEmail({
      dealerName: prepared.dealerName,
      claimUrl,
      expiresAt: prepared.expiresAt,
      campaignStartsAt: prepared.campaignStartsAt,
      campaignEndsAt: prepared.campaignEndsAt,
    });

    let sent: { id: string };
    try {
      sent = await sendStrictResendEmail({
        to: recipientEmailNorm,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (error) {
      const lastError = sanitizeOnboardingError(error);
      await db.dealerOnboardingInvite.update({
        where: { id: prepared.inviteId },
        data: { status: "SEND_FAILED", lastError },
      });
      await db.dealerOnboardingInviteEvent.create({
        data: {
          inviteId: prepared.inviteId,
          fromStatus: prepared.previousStatus,
          toStatus: "SEND_FAILED",
          actorUserId: admin.id,
          source: "ADMIN",
          metadata: { reason: lastError },
        },
      });
      return { error: "The invitation email was not sent. No acceptance has been recorded." };
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.dealerOnboardingInvite.update({
          where: { id: prepared.inviteId },
          data: {
            status: "SENT",
            sentAt: new Date(),
            resendMessageId: sent.id,
            lastError: null,
          },
        });
        await tx.dealerPromotionCampaign.update({
          where: { id: prepared.campaignId },
          data: { lockedAt: prepared.campaignLockedAt ?? new Date() },
        });
        await tx.dealerOnboardingInviteEvent.create({
          data: {
            inviteId: prepared.inviteId,
            fromStatus: prepared.previousStatus,
            toStatus: "SENT",
            actorUserId: admin.id,
            source: "ADMIN",
            metadata: { resendMessageId: sent.id },
          },
        });
      });
    } catch (error) {
      await captureException({
        source: "SERVER",
        error,
        action: "sendDealerOnboardingInvite",
        route: "/admin/dealer-onboarding",
        requestPath: "/admin/dealer-onboarding",
        userId: admin.id,
        tags: { inviteId: prepared.inviteId },
      });
      return {
        error:
          "The invitation email was sent, but its status was not saved. Refresh this page before sending again.",
      };
    }

    await logAdminAction({
      adminId: admin.id,
      action: prepared.resent ? "RESEND_DEALER_ONBOARDING_INVITE" : "SEND_DEALER_ONBOARDING_INVITE",
      entityType: "DealerOnboardingInvite",
      entityId: prepared.inviteId,
      details: {
        dealerId: parsed.data.dealerId,
        recipientEmailNorm,
        campaignEndsAt: prepared.campaignEndsAt.toISOString(),
      },
    });
    revalidatePath("/admin/dealer-onboarding");
    revalidatePath("/admin/dealers");
    return { data: { inviteId: prepared.inviteId, status: "SENT" as const } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "sendDealerOnboardingInvite",
      route: "/admin/dealer-onboarding",
      requestPath: "/admin/dealer-onboarding",
      userId: admin.id,
      tags: { dealerId: parsed.data.dealerId },
    });
    return { error: "Unable to prepare the dealer invitation." };
  }
}

export async function revokeDealerOnboardingInvite(input: { inviteId: string }) {
  const admin = await requireRole("ADMIN");
  const parsed = onboardingInviteIdSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const invite = await db.dealerOnboardingInvite.findUnique({
      where: { id: parsed.data.inviteId },
    });
    if (!invite) return { error: "Invitation not found." };
    if (!canRevokeOnboardingInvite(invite.status)) {
      return { error: "This invitation can no longer be revoked." };
    }
    await invalidateDealerAuthSessions(invite.targetAuthUserId);
    const now = new Date();
    await db.$transaction(async (tx) => {
      const revoked = await tx.dealerOnboardingInvite.updateMany({
        where: { id: invite.id, status: invite.status },
        data: {
          status: "REVOKED",
          revokedAt: now,
          tokenHash: hashOnboardingToken(createOnboardingToken()),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (revoked.count !== 1) {
        throw new Error("Invitation changed before it could be revoked.");
      }
      await tx.dealerOnboardingInviteEvent.create({
        data: {
          inviteId: invite.id,
          fromStatus: invite.status,
          toStatus: "REVOKED",
          actorUserId: admin.id,
          source: "ADMIN",
        },
      });
    });
    await logAdminAction({
      adminId: admin.id,
      action: "REVOKE_DEALER_ONBOARDING_INVITE",
      entityType: "DealerOnboardingInvite",
      entityId: invite.id,
      details: { dealerId: invite.dealerId },
    });
    revalidatePath("/admin/dealer-onboarding");
    return { data: { status: "REVOKED" as const } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "revokeDealerOnboardingInvite",
      route: "/admin/dealer-onboarding",
      requestPath: "/admin/dealer-onboarding",
      userId: admin.id,
    });
    return { error: "Unable to revoke the invitation." };
  }
}

async function prepareInvite(input: {
  dealerId: string;
  recipientEmailNorm: string;
  adminId: string;
}) {
  const campaign = await db.dealerPromotionCampaign.findUnique({
    where: { key: LAUNCH_PROMOTION_KEY },
  });
  if (!campaign) return { error: "Create the launch campaign before sending invitations." };

  const dealer = await db.dealerProfile.findUnique({
    where: { id: input.dealerId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          authUserId: true,
          role: true,
          disabledAt: true,
          deletedAt: true,
        },
      },
      subscriptions: {
        select: {
          source: true,
          status: true,
          grantStartsAt: true,
          grantEndsAt: true,
          revokedAt: true,
          currentPeriodEnd: true,
        },
      },
    },
  });
  if (!dealer || dealer.isAdminPreview) {
    return { error: "Choose an active dealer account." };
  }
  if (
    dealer.user.role !== "DEALER" ||
    dealer.user.disabledAt ||
    dealer.user.deletedAt ||
    !dealer.user.authUserId
  ) {
    return { error: "This dealer account cannot be invited." };
  }

  const now = new Date();
  const grant = planPromotionGrant({
    subscriptions: dealer.subscriptions,
    campaignStartsAt: campaign.startsAt,
    campaignEndsAt: campaign.endsAt,
    now,
  });
  if ("blocked" in grant) {
    return { error: "This dealer has a paid subscription, so onboarding was not sent." };
  }

  const localOwner = await db.user.findFirst({
    where: {
      email: { equals: input.recipientEmailNorm, mode: "insensitive" },
      NOT: { id: dealer.userId },
    },
    select: { id: true },
  });
  if (localOwner) return { error: "That email address is already used by another account." };

  const authOwner = await findAuthUserByEmail(input.recipientEmailNorm);
  if (authOwner && authOwner.id !== dealer.user.authUserId) {
    return { error: "That email address is already used by another account." };
  }

  const token = createOnboardingToken();
  const tokenHash = hashOnboardingToken(token);
  const expiresAt = new Date(now.getTime() + ONBOARDING_INVITE_TTL_MS);
  const existing = await db.dealerOnboardingInvite.findFirst({
    where: { dealerId: dealer.id, status: { in: [...LIVE_ONBOARDING_STATUSES] } },
  });
  if (existing?.status === "FINALIZING_AUTH") {
    return { error: "This dealer has already started activation." };
  }
  if (
    existing &&
    !canResendOnboardingInvite(existing.status, existing.expiresAt, now)
  ) {
    return { error: "This invitation can no longer be sent." };
  }

  const lockedCampaign = await lockCampaignForSend(campaign);
  if (!lockedCampaign.ok) return { error: lockedCampaign.error };

  try {
    const invite = existing
      ? await db.dealerOnboardingInvite.update({
          where: { id: existing.id },
          data: {
            recipientEmailNorm: input.recipientEmailNorm,
            tokenHash,
            expiresAt,
            status: "SEND_FAILED",
            campaignStartsAt: campaign.startsAt,
            campaignEndsAt: campaign.endsAt,
            campaignTier: "PRO",
            lastError: null,
            leaseToken: null,
            leaseExpiresAt: null,
            sendAttemptCount: { increment: 1 },
          },
        })
      : await db.dealerOnboardingInvite.create({
          data: {
            campaignId: campaign.id,
            userId: dealer.userId,
            dealerId: dealer.id,
            targetAuthUserId: dealer.user.authUserId,
            originalEmail: dealer.user.email,
            recipientEmailNorm: input.recipientEmailNorm,
            tokenHash,
            expiresAt,
            status: "SEND_FAILED",
            campaignStartsAt: campaign.startsAt,
            campaignEndsAt: campaign.endsAt,
            campaignTier: "PRO",
            sendAttemptCount: 1,
            createdByAdminId: input.adminId,
          },
        });
    return {
      token,
      inviteId: invite.id,
      campaignId: lockedCampaign.id,
      campaignLockedAt: lockedCampaign.lockedAt,
      campaignStartsAt: lockedCampaign.startsAt,
      campaignEndsAt: lockedCampaign.endsAt,
      expiresAt,
      dealerName: dealer.name,
      previousStatus: existing?.status ?? "SEND_FAILED",
      resent: Boolean(existing),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "That dealer or email already has an open invitation." };
    }
    throw error;
  }
}

async function lockCampaignForSend(campaign: {
  id: string;
  lockedAt: Date | null;
  startsAt: Date;
  endsAt: Date;
}): Promise<
  | {
      ok: true;
      id: string;
      lockedAt: Date;
      startsAt: Date;
      endsAt: Date;
    }
  | { ok: false; error: string }
> {
  if (campaign.lockedAt) {
    return {
      ok: true,
      id: campaign.id,
      lockedAt: campaign.lockedAt,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
    };
  }
  const lockedAt = new Date();
  const locked = await db.dealerPromotionCampaign.updateMany({
    where: {
      id: campaign.id,
      lockedAt: null,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
    },
    data: { lockedAt },
  });
  if (locked.count !== 1) {
    return { ok: false, error: "The launch campaign changed. Refresh and try again." };
  }
  return {
    ok: true,
    id: campaign.id,
    lockedAt,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
  };
}
