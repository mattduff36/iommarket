import { db } from "@/lib/db";
import { buildWaitlistEarlyAccessEmail } from "@/lib/email/waitlist-early-access";
import { getEmailAppOrigin } from "@/lib/email/links";
import { sendStrictResendEmail } from "@/lib/email/send-strict";
import { EARLY_ACCESS_CAMPAIGN_KEY, isEligibleEarlyAccessWaitlistUser } from "@/lib/waitlist/early-access/audience";
import { canSendEarlyAccessBulk, sanitizeEarlyAccessError } from "@/lib/waitlist/early-access/guard";
import { buildEarlyAccessClaimUrl, signEarlyAccessInvite } from "@/lib/waitlist/early-access/tokens";

export const EARLY_ACCESS_DELIVERY_BATCH = 20;
export const EARLY_ACCESS_MAX_ATTEMPTS = 5;
const STALE_SENDING_MS = 15 * 60 * 1000;

export type EarlyAccessDeliveryResult = "SENT" | "FAILED" | "SKIPPED" | "BUSY";

function staleSendingAt(now: Date) {
  return new Date(now.getTime() - STALE_SENDING_MS);
}

function retryableWhere(now: Date) {
  return {
    waitlistUserId: { not: null },
    attemptCount: { lt: EARLY_ACCESS_MAX_ATTEMPTS },
    OR: [
      { deliveryStatus: "PENDING" as const },
      { deliveryStatus: "FAILED" as const },
      { deliveryStatus: "SENDING" as const, updatedAt: { lte: staleSendingAt(now) } },
    ],
  };
}

function claimUrlFor(recipient: { id: string; nonce: string }) {
  const proof = signEarlyAccessInvite({
    secret: process.env.DEV_GATE_SECRET,
    recipientId: recipient.id,
    nonce: recipient.nonce,
  });
  if (!proof) return null;
  return buildEarlyAccessClaimUrl(getEmailAppOrigin(), recipient.id, proof);
}

export async function deliverEarlyAccessBatch(limit = EARLY_ACCESS_DELIVERY_BATCH) {
  if (!canSendEarlyAccessBulk()) {
    return { sent: 0, failed: 0, skipped: 0, blocked: true as const };
  }
  const now = new Date();
  const rows = await db.waitlistEarlyAccessRecipient.findMany({
    where: {
      waitlistUserId: { not: null },
      attemptCount: { lt: EARLY_ACCESS_MAX_ATTEMPTS },
      OR: [
        { deliveryStatus: "PENDING" },
        {
          deliveryStatus: "FAILED",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { deliveryStatus: "SENDING", updatedAt: { lte: staleSendingAt(now) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const result = await deliverEarlyAccessRecipient(row.id);
    if (result === "SENT") sent += 1;
    else if (result === "FAILED") failed += 1;
    else if (result === "SKIPPED") skipped += 1;
  }
  await refreshEarlyAccessCampaignProgress();
  return { sent, failed, skipped, blocked: false as const };
}

export async function deliverEarlyAccessRecipient(id: string): Promise<EarlyAccessDeliveryResult> {
  if (!canSendEarlyAccessBulk()) return "BUSY";
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_SENDING_MS);
  const claimed = await db.waitlistEarlyAccessRecipient.updateMany({
    where: {
      id,
      waitlistUserId: { not: null },
      attemptCount: { lt: EARLY_ACCESS_MAX_ATTEMPTS },
      OR: [
        { deliveryStatus: { in: ["PENDING", "FAILED"] } },
        { deliveryStatus: "SENDING", updatedAt: { lte: stale } },
      ],
    },
    data: {
      deliveryStatus: "SENDING",
      attemptCount: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return "BUSY";

  const recipient = await db.waitlistEarlyAccessRecipient.findUnique({
    where: { id },
    include: {
      waitlistUser: {
        select: {
          email: true,
          deletedAt: true,
          marketingConsentAt: true,
          marketingWithdrawnAt: true,
          interests: true,
        },
      },
    },
  });
  if (!recipient?.waitlistUser || !isEligibleEarlyAccessWaitlistUser(recipient.waitlistUser)) {
    await db.waitlistEarlyAccessRecipient.update({
      where: { id },
      data: { deliveryStatus: "SKIPPED", skippedReason: "consent-or-interest" },
    });
    return "SKIPPED";
  }

  const claimUrl = claimUrlFor(recipient);
  if (!claimUrl) {
    await markDeliveryFailed(id, "Early-access link could not be signed.");
    return "FAILED";
  }

  try {
    const campaign = await db.waitlistEarlyAccessCampaign.findUnique({
      where: { id: recipient.campaignId },
      select: { bodyText: true },
    });
    if (!campaign) {
      await markDeliveryFailed(id, "Campaign was not found.");
      return "FAILED";
    }
    const email = buildWaitlistEarlyAccessEmail({
      bodyText: campaign.bodyText,
      claimUrl,
    });
    const sent = await sendStrictResendEmail({
      to: recipient.waitlistUser.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: {
        "X-Entity-Ref-ID": `waitlist-ea-${recipient.campaignId}-${recipient.id}-${recipient.attemptCount}`,
      },
    });
    await db.waitlistEarlyAccessRecipient.update({
      where: { id },
      data: {
        deliveryStatus: "SENT",
        sentAt: new Date(),
        resendMessageId: sent.id,
        lastError: null,
        nextAttemptAt: null,
      },
    });
    return "SENT";
  } catch (error) {
    await markDeliveryFailed(id, sanitizeEarlyAccessError(error));
    return "FAILED";
  }
}

async function markDeliveryFailed(id: string, lastError: string) {
  await db.waitlistEarlyAccessRecipient.update({
    where: { id },
    data: {
      deliveryStatus: "FAILED",
      lastError,
      nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

export async function refreshEarlyAccessCampaignProgress() {
  const campaign = await db.waitlistEarlyAccessCampaign.findUnique({
    where: { key: EARLY_ACCESS_CAMPAIGN_KEY },
    select: { id: true, status: true },
  });
  if (!campaign || campaign.status === "DRAFT" || campaign.status === "CANCELLED") return;

  const grouped = await db.waitlistEarlyAccessRecipient.groupBy({
    by: ["deliveryStatus"],
    where: { campaignId: campaign.id, waitlistUserId: { not: null } },
    _count: { _all: true },
  });
  const countFor = (status: string) =>
    grouped.find((group) => group.deliveryStatus === status)?._count._all ?? 0;
  const outstanding = await db.waitlistEarlyAccessRecipient.count({
    where: {
      campaignId: campaign.id,
      ...retryableWhere(new Date()),
    },
  });
  await db.waitlistEarlyAccessCampaign.update({
    where: { id: campaign.id },
    data: {
      recipientTotal: grouped.reduce((total, group) => total + group._count._all, 0),
      sentCount: countFor("SENT"),
      failedCount: countFor("FAILED"),
      skippedCount: countFor("SKIPPED"),
      status: outstanding === 0 ? "COMPLETED" : "SENDING",
      startedAt: campaign.status === "QUEUED" ? new Date() : undefined,
      completedAt: outstanding === 0 ? new Date() : null,
    },
  });
}
