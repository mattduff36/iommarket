"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { buildWaitlistEarlyAccessEmail } from "@/lib/email/waitlist-early-access";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitActionError } from "@/lib/rate-limit-result";
import { captureException } from "@/lib/monitoring";
import {
  EARLY_ACCESS_CAMPAIGN_KEY,
  earlyAccessAudienceWhere,
} from "@/lib/waitlist/early-access/audience";
import { deliverEarlyAccessBatch } from "@/lib/waitlist/early-access/delivery";
import {
  canSendEarlyAccessBulk,
  canSendEarlyAccessTest,
} from "@/lib/waitlist/early-access/guard";
import { earlyAccessClaimUrlForRecipient } from "@/lib/waitlist/early-access/invite";
import { createEarlyAccessNonce } from "@/lib/waitlist/early-access/tokens";
import {
  confirmEarlyAccessSchema,
  earlyAccessBodySchema,
} from "@/lib/validations/waitlist-early-access";

const CAMPAIGN_PATH = "/admin/waitlist/early-access";
const SEND_RATE = { windowMs: 10 * 60_000, maxRequests: 5, policy: "waitlist-early-access" };

async function saveDraft(adminId: string, bodyText: string) {
  const existing = await db.waitlistEarlyAccessCampaign.findUnique({
    where: { key: EARLY_ACCESS_CAMPAIGN_KEY },
  });
  if (existing && existing.status !== "DRAFT") return existing;
  if (existing) {
    return db.waitlistEarlyAccessCampaign.update({
      where: { id: existing.id },
      data: { bodyText },
    });
  }
  return db.waitlistEarlyAccessCampaign.create({
    data: {
      key: EARLY_ACCESS_CAMPAIGN_KEY,
      bodyText,
      createdByAdminId: adminId,
    },
  });
}

export async function saveEarlyAccessDraft(input: { bodyText: string }) {
  const admin = await requireRole("ADMIN");
  const parsed = earlyAccessBodySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  try {
    const campaign = await saveDraft(admin.id, parsed.data.bodyText);
    await logAdminAction({
      adminId: admin.id,
      action: "SAVE_WAITLIST_EARLY_ACCESS_DRAFT",
      entityType: "WaitlistEarlyAccessCampaign",
      entityId: campaign.id,
      details: { status: campaign.status },
    });
    revalidatePath(CAMPAIGN_PATH);
    return { data: { campaignId: campaign.id, status: campaign.status } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "saveEarlyAccessDraft",
      route: CAMPAIGN_PATH,
      requestPath: CAMPAIGN_PATH,
      userId: admin.id,
    });
    return { error: "The draft could not be saved." };
  }
}

export async function sendEarlyAccessTest(input: { bodyText: string }) {
  const admin = await requireRole("ADMIN");
  const parsed = earlyAccessBodySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  if (!canSendEarlyAccessTest()) {
    return { error: "Test invitations are available on Preview, or while the launch gate is closed." };
  }
  const rateError = rateLimitActionError(
    await checkRateLimit(`waitlist-early-access-test:${admin.id}`, SEND_RATE),
    "Too many test invitations. Wait a few minutes and try again.",
  );
  if (rateError) return { error: rateError };

  try {
    const campaign = await saveDraft(admin.id, parsed.data.bodyText);
    const nonce = createEarlyAccessNonce();
    const recipient = await db.waitlistEarlyAccessRecipient.upsert({
      where: {
        campaignId_testAdminUserId: {
          campaignId: campaign.id,
          testAdminUserId: admin.id,
        },
      },
      create: {
        campaignId: campaign.id,
        testAdminUserId: admin.id,
        nonce,
        deliveryStatus: "PENDING",
      },
      update: {
        nonce,
        deliveryStatus: "PENDING",
        claimedAt: null,
        claimLeaseExpiresAt: null,
        lastError: null,
        sentAt: null,
      },
    });
    const claimUrl = earlyAccessClaimUrlForRecipient(recipient);
    if (!claimUrl) return { error: "The test invitation link could not be signed." };
    const email = buildWaitlistEarlyAccessEmail({
      bodyText: campaign.status === "DRAFT" ? parsed.data.bodyText : campaign.bodyText,
      claimUrl,
      test: true,
    });
    const sent = await sendStrictResendEmail({
      to: admin.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { "X-Entity-Ref-ID": `waitlist-ea-test-${recipient.id}-${Date.now()}` },
    });
    await db.waitlistEarlyAccessRecipient.update({
      where: { id: recipient.id },
      data: {
        deliveryStatus: "SENT",
        sentAt: new Date(),
        resendMessageId: sent.id,
      },
    });
    await logAdminAction({
      adminId: admin.id,
      action: "SEND_WAITLIST_EARLY_ACCESS_TEST",
      entityType: "WaitlistEarlyAccessRecipient",
      entityId: recipient.id,
      details: { campaignId: campaign.id },
    });
    revalidatePath(CAMPAIGN_PATH);
    return { data: { recipientId: recipient.id } };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "sendEarlyAccessTest",
      route: CAMPAIGN_PATH,
      requestPath: CAMPAIGN_PATH,
      userId: admin.id,
    });
    return { error: "The test invitation was not sent." };
  }
}

export async function confirmEarlyAccessCampaign(input: {
  bodyText: string;
  confirmation: string;
}) {
  const admin = await requireRole("ADMIN");
  const parsed = confirmEarlyAccessSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  if (!canSendEarlyAccessBulk()) {
    return {
      error: "Waitlist invitations can only be sent from production while the site is still closed.",
    };
  }
  const rateError = rateLimitActionError(
    await checkRateLimit(`waitlist-early-access-confirm:${admin.id}`, SEND_RATE),
    "Too many send attempts. Wait a few minutes and try again.",
  );
  if (rateError) return { error: rateError };

  try {
    const campaign = await saveDraft(admin.id, parsed.data.bodyText);
    if (campaign.status !== "DRAFT") {
      return { data: { campaignId: campaign.id, alreadyConfirmed: true as const } };
    }
    const confirmedAt = new Date();
    const enrolled = await db.$transaction(async (tx) => {
      const locked = await tx.waitlistEarlyAccessCampaign.updateMany({
        where: { id: campaign.id, status: "DRAFT" },
        data: {
          status: "QUEUED",
          bodyText: parsed.data.bodyText,
          confirmedAt,
          confirmedByAdminId: admin.id,
        },
      });
      if (locked.count !== 1) return null;
      const audience = await tx.waitlistUser.findMany({
        where: earlyAccessAudienceWhere(),
        select: { id: true },
      });
      if (audience.length > 0) {
        await tx.waitlistEarlyAccessRecipient.createMany({
          data: audience.map((user) => ({
            campaignId: campaign.id,
            waitlistUserId: user.id,
            nonce: createEarlyAccessNonce(),
            deliveryStatus: "PENDING" as const,
          })),
          skipDuplicates: true,
        });
      }
      await tx.waitlistEarlyAccessCampaign.update({
        where: { id: campaign.id },
        data: { recipientTotal: audience.length },
      });
      return audience.length;
    });
    if (enrolled === null) {
      return { data: { campaignId: campaign.id, alreadyConfirmed: true as const } };
    }
    await logAdminAction({
      adminId: admin.id,
      action: "CONFIRM_WAITLIST_EARLY_ACCESS",
      entityType: "WaitlistEarlyAccessCampaign",
      entityId: campaign.id,
      details: { recipientTotal: enrolled },
    });
    let delivery: { sent: number; failed: number; skipped: number } | null = null;
    try {
      delivery = await deliverEarlyAccessBatch();
    } catch (error) {
      await captureException({
        source: "SERVER",
        error,
        action: "confirmEarlyAccessCampaign",
        route: CAMPAIGN_PATH,
        requestPath: CAMPAIGN_PATH,
        userId: admin.id,
        tags: { campaignId: campaign.id },
      });
    }
    revalidatePath(CAMPAIGN_PATH);
    return { data: { campaignId: campaign.id, recipientTotal: enrolled, delivery } };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "This campaign was already confirmed. Refresh the page." };
    }
    await captureException({
      source: "SERVER",
      error,
      action: "confirmEarlyAccessCampaign",
      route: CAMPAIGN_PATH,
      requestPath: CAMPAIGN_PATH,
      userId: admin.id,
    });
    return { error: "The campaign could not be queued." };
  }
}

export async function retryEarlyAccessFailures() {
  const admin = await requireRole("ADMIN");
  if (!canSendEarlyAccessBulk()) {
    return { error: "Failed invitations can only be retried from closed production." };
  }
  try {
    const delivery = await deliverEarlyAccessBatch();
    await logAdminAction({
      adminId: admin.id,
      action: "RETRY_WAITLIST_EARLY_ACCESS",
      entityType: "WaitlistEarlyAccessCampaign",
      details: {
        sent: delivery.sent,
        failed: delivery.failed,
        skipped: delivery.skipped,
      },
    });
    revalidatePath(CAMPAIGN_PATH);
    return { data: delivery };
  } catch (error) {
    await captureException({
      source: "SERVER",
      error,
      action: "retryEarlyAccessFailures",
      route: CAMPAIGN_PATH,
      requestPath: CAMPAIGN_PATH,
      userId: admin.id,
    });
    return { error: "Failed invitations could not be retried." };
  }
}
