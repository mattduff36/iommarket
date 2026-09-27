import { db } from "@/lib/db";
import { getModerationInbox, sendResendEmail } from "@/lib/email/client";
import { getEmailAppOrigin } from "@/lib/email/links";
import { renderBrandedEmail } from "@/lib/email/layout";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";

export type DealerReviewNotificationIntent =
  | { kind: "RESPONSE_SUBMITTED"; revisionId: string }
  | { kind: "RESPONSE_DECIDED"; revisionId: string }
  | { kind: "DISPUTE_OPENED"; disputeId: string }
  | { kind: "DISPUTE_DECIDED"; disputeId: string };

export function buildDealerReviewAdminEmail(input: {
  kind: "RESPONSE_SUBMITTED" | "DISPUTE_OPENED";
  dealerName: string;
  entityId: string;
}) {
  const isResponse = input.kind === "RESPONSE_SUBMITTED";
  const title = isResponse
    ? "Dealer response awaiting review"
    : "Dealer review dispute opened";
  return {
    subject: `${title}: ${input.dealerName}`,
    ...renderBrandedEmail({
      title,
      intro: isResponse
        ? "A dealer response is waiting in the moderation queue."
        : "A dealer has opened a review dispute for administrator assessment.",
      details: [
        { label: "Dealer", value: input.dealerName },
        { label: "Reference", value: input.entityId },
      ],
      actionHref: `${getEmailAppOrigin()}/admin/reviews`,
      actionLabel: "Review in admin",
    }),
  };
}

export function buildDealerReviewDecisionEmail(input: {
  kind: "RESPONSE_DECIDED" | "DISPUTE_DECIDED";
  dealerName: string;
  status: string;
  reasonCode?: string | null;
}) {
  const isResponse = input.kind === "RESPONSE_DECIDED";
  const title = isResponse
    ? input.status === "APPROVED"
      ? "Your review response was approved"
      : "Your review response was not approved"
    : input.status === "RESOLVED"
      ? "Your review dispute was resolved"
      : "Your review dispute was rejected";
  return {
    subject: title,
    ...renderBrandedEmail({
      title,
      intro: isResponse
        ? "An administrator has completed moderation of your response."
        : "An administrator has completed assessment of your dispute.",
      details: [
        { label: "Dealer", value: input.dealerName },
        { label: "Status", value: input.status },
      ],
      paragraphs: input.reasonCode ? [`Reason: ${input.reasonCode}`] : [],
      actionHref: `${getEmailAppOrigin()}/dealer/dashboard#review-management`,
      actionLabel: "Manage reviews",
    }),
  };
}

async function sendIntent(intent: DealerReviewNotificationIntent) {
  if ("revisionId" in intent) {
    const revision = await db.dealerReviewResponseRevision.findUnique({
      where: { id: intent.revisionId },
      select: {
        id: true,
        status: true,
        reasonCode: true,
        response: {
          select: {
            review: {
              select: {
                dealer: {
                  select: {
                    name: true,
                    user: { select: { email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!revision) return;
    const dealer = revision.response.review.dealer;
    if (intent.kind === "RESPONSE_SUBMITTED") {
      const inbox = getModerationInbox();
      if (inbox.length === 0) return;
      const email = buildDealerReviewAdminEmail({
        kind: intent.kind,
        dealerName: dealer.name,
        entityId: revision.id,
      });
      await sendResendEmail({ to: inbox, ...email });
      return;
    }
    if (!dealer.user.email) return;
    const email = buildDealerReviewDecisionEmail({
      kind: intent.kind,
      dealerName: dealer.name,
      status: revision.status,
      reasonCode: revision.reasonCode,
    });
    await sendResendEmail({ to: dealer.user.email, ...email });
    return;
  }

  const dispute = await db.dealerReviewDispute.findUnique({
    where: { id: intent.disputeId },
    select: {
      id: true,
      status: true,
      decisionReasonCode: true,
      review: {
        select: {
          dealer: {
            select: {
              name: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
  });
  if (!dispute) return;
  const dealer = dispute.review.dealer;
  if (intent.kind === "DISPUTE_OPENED") {
    const inbox = getModerationInbox();
    if (inbox.length === 0) return;
    const email = buildDealerReviewAdminEmail({
      kind: intent.kind,
      dealerName: dealer.name,
      entityId: dispute.id,
    });
    await sendResendEmail({ to: inbox, ...email });
    return;
  }
  if (!dealer.user.email) return;
  const email = buildDealerReviewDecisionEmail({
    kind: intent.kind,
    dealerName: dealer.name,
    status: dispute.status,
    reasonCode: dispute.decisionReasonCode,
  });
  await sendResendEmail({ to: dealer.user.email, ...email });
}

export async function dispatchDealerReviewNotifications(
  intents: Array<DealerReviewNotificationIntent | null | undefined>,
) {
  for (const intent of intents) {
    if (!intent) continue;
    try {
      await sendIntent(intent);
      await captureBusinessEvent({
        source: "BUSINESS",
        severity: "LOW",
        title: "Dealer review notification sent",
        message: "A dealer review workflow notification was dispatched.",
        action: "dispatchDealerReviewNotifications",
        tags: {
          kind: intent.kind,
          entityId:
            "revisionId" in intent ? intent.revisionId : intent.disputeId,
        },
      });
    } catch (error) {
      try {
        await captureException({
          source: "BUSINESS",
          error,
          severity: "MEDIUM",
          title: "Dealer review notification failed",
          action: "dispatchDealerReviewNotifications",
          tags: { kind: intent.kind },
        });
      } catch {
        // Notification delivery is best-effort after the database commit.
      }
    }
  }
}
