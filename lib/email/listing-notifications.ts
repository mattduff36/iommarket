import type { ListingLifecycleAction, ListingModerationReason } from "@prisma/client";
import { db } from "@/lib/db";
import { getModerationInbox, sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import {
  getModerationSubReason,
  moderationReasonLabelForHistory,
} from "@/lib/listings/moderation-reasons";
import {
  isListingResubmit,
  shouldNotifyAdminSubmission,
  shouldNotifySellerStatusChange,
  type ListingNotificationIntent,
} from "@/lib/listings/notification-intents";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

const SELLER_COPY: Record<
  ListingLifecycleAction,
  { title: string; intro: string } | null
> = {
  SUBMIT: {
    title: "Listing submitted for review",
    intro: "We have received your listing and will review it shortly.",
  },
  WITHDRAW: null,
  APPROVE: {
    title: "Your listing is now live",
    intro: "Your listing has been approved and is visible on iTrader.im.",
  },
  REJECT: {
    title: "Your listing was not approved",
    intro: "Our team could not approve this listing in its current form.",
  },
  TAKE_DOWN: {
    title: "Your listing was taken down",
    intro: "This listing is no longer visible on iTrader.im.",
  },
  EXPIRE: {
    title: "Your listing has expired",
    intro: "This listing is no longer active. You can renew it from your account.",
  },
  MARK_SOLD: {
    title: "Listing marked as sold",
    intro: "Your listing has been marked as sold and removed from live results.",
  },
  RENEW: {
    title: "Listing returned to draft",
    intro: "Your expired listing is back in draft so you can update and resubmit it.",
  },
  REINSTATE_LIVE: {
    title: "Your listing is live again",
    intro: "An administrator has reinstated your listing.",
  },
  RETURN_TO_DRAFT: {
    title: "Your listing was returned to draft",
    intro: "You can edit this listing and submit it for review again.",
  },
  ACCOUNT_DISABLE: {
    title: "Your listing was taken down",
    intro: "This listing was taken down because the account is disabled.",
  },
  ACCOUNT_DISABLE_PENDING: {
    title: "Your listing was not approved",
    intro: "This pending listing was closed because the account is disabled.",
  },
  SYSTEM_BACKFILL: null,
  SUBMIT_REVISION: {
    title: "Listing changes submitted",
    intro: "Your proposed changes are awaiting review. The current live listing stays public.",
  },
  APPROVE_REVISION: {
    title: "Listing changes approved",
    intro: "Your updated listing details are now live.",
  },
  REJECT_REVISION: {
    title: "Listing changes were not approved",
    intro: "Your live listing is unchanged. You can submit a new edit after reviewing the reason.",
  },
};

function publicReasonLabel(
  reasonCode: ListingModerationReason | null,
  moderationSubReason?: string | null,
) {
  if (!reasonCode) return null;
  return moderationReasonLabelForHistory(reasonCode, moderationSubReason);
}

export function buildListingStatusEmail(input: {
  action: ListingLifecycleAction;
  listingTitle: string;
  listingId?: string;
  reasonCode?: ListingModerationReason | null;
  moderationSubReason?: string | null;
  moderationTaxonomyVersion?: string | null;
}) {
  const copy = SELLER_COPY[input.action];
  if (!copy) return null;
  const reasonLabel = publicReasonLabel(
    input.reasonCode ?? null,
    input.moderationSubReason,
  );
  const bodyLines = [`Listing: ${input.listingTitle}`];
  if (input.listingId) {
    const appUrl = getAppUrl();
    bodyLines.push(
      `Open listing: ${appUrl}/listings/${input.listingId}`,
      `Your listings: ${appUrl}/account/listings`,
    );
  }
  if (reasonLabel) {
    bodyLines.push(`Reason: ${reasonLabel}`);
  }
  const subReason = getModerationSubReason(input.moderationSubReason, {
    includeRetired: true,
  });
  if (subReason && subReason.parent === input.reasonCode) {
    bodyLines.push(
      subReason.sellerExplanation,
      `Correction: ${subReason.correction}`,
      `Resubmission: ${subReason.resubmit}`,
      `Appeal: ${subReason.appeal}`,
      `Refunds: ${subReason.refundAdvisory}`,
    );
  }
  return {
    subject: `${copy.title}: ${input.listingTitle}`,
    ...renderBrandedEmail({
      title: copy.title,
      intro: copy.intro,
      bodyLines,
    }),
  };
}

export function buildAdminSubmissionEmail(input: {
  listingTitle: string;
  listingId: string;
  isResubmit: boolean;
  isRevision: boolean;
}) {
  const appUrl = getAppUrl();
  const title = input.isRevision
    ? "Live listing changes awaiting review"
    : input.isResubmit
      ? "Listing resubmitted for review"
      : "New listing submitted for review";
  return {
    subject: `${title}: ${input.listingTitle}`,
    ...renderBrandedEmail({
      title,
      intro: "A listing is waiting in the moderation queue.",
      bodyLines: [
        `Listing: ${input.listingTitle}`,
        `ID: ${input.listingId}`,
        `Review: ${appUrl}/admin/listings`,
      ],
    }),
  };
}

async function sendOneNotification(intent: ListingNotificationIntent) {
  const listing = await db.listing.findUnique({
    where: { id: intent.listingId },
    select: {
      id: true,
      title: true,
      user: { select: { email: true } },
    },
  });
  if (!listing) return;

  if (shouldNotifySellerStatusChange(intent) || intent.action.endsWith("_REVISION")) {
    const sellerEmail = buildListingStatusEmail({
      action: intent.action,
      listingTitle: listing.title,
      listingId: listing.id,
      reasonCode: intent.reasonCode,
      moderationSubReason: intent.moderationSubReason,
      moderationTaxonomyVersion: intent.moderationTaxonomyVersion,
    });
    if (sellerEmail && listing.user.email) {
      await sendResendEmail({
        to: listing.user.email,
        subject: sellerEmail.subject,
        text: sellerEmail.text,
        html: sellerEmail.html,
      });
    }
  }

  if (shouldNotifyAdminSubmission(intent)) {
    const adminEmail = buildAdminSubmissionEmail({
      listingTitle: listing.title,
      listingId: listing.id,
      isResubmit: isListingResubmit(intent),
      isRevision: intent.action === "SUBMIT_REVISION",
    });
    const inbox = getModerationInbox();
    if (inbox.length > 0) {
      await sendResendEmail({
        to: inbox,
        subject: adminEmail.subject,
        text: adminEmail.text,
        html: adminEmail.html,
      });
    }
  }
}

export async function dispatchListingNotifications(
  intents: Array<ListingNotificationIntent | null | undefined>,
) {
  for (const intent of intents) {
    if (!intent) continue;
    try {
      await sendOneNotification(intent);
      await captureBusinessEvent({
        source: "BUSINESS",
        severity: "LOW",
        title: "Listing notification sent",
        message: "A listing lifecycle notification was dispatched.",
        action: "dispatchListingNotifications",
        tags: { listingId: intent.listingId, action: intent.action },
      });
    } catch (error) {
      try {
        await captureException({
          source: "BUSINESS",
          error,
          severity: "MEDIUM",
          title: "Listing notification failed",
          action: "dispatchListingNotifications",
          tags: { listingId: intent.listingId, action: intent.action },
        });
      } catch {
        // Email is best-effort; never fail the lifecycle mutation.
      }
    }
  }
}
