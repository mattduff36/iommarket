import { db } from "@/lib/db";
import { getModerationInbox, sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";

export type DealerReviewNotificationIntent =
  | { kind: "RESPONSE_SUBMITTED"; revisionId: string }
  | { kind: "RESPONSE_DECIDED"; revisionId: string }
  | { kind: "DISPUTE_OPENED"; disputeId: string }
  | { kind: "DISPUTE_DECIDED"; disputeId: string };

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

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
      bodyLines: [
        `Dealer: ${input.dealerName}`,
        `Reference: ${input.entityId}`,
        `Review: ${appUrl()}/admin/reviews`,
      ],
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
  const bodyLines = [
    `Dealer: ${input.dealerName}`,
    `Status: ${input.status}`,
    `Review management: ${appUrl()}/dealer/dashboard#review-management`,
  ];
  if (input.reasonCode) bodyLines.push(`Reason: ${input.reasonCode}`);
  return {
    subject: title,
    ...renderBrandedEmail({
      title,
      intro: isResponse
        ? "An administrator has completed moderation of your response."
        : "An administrator has completed assessment of your dispute.",
      bodyLines,
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
