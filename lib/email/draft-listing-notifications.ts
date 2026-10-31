import { db } from "@/lib/db";
import { resolveDealerMailRecipients } from "@/lib/dealers/correspondence-routing";
import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { getEmailAppOrigin } from "@/lib/email/links";

/** Called only after the stock-to-draft transaction commits. */
export async function notifyReceivedDraftListings(input: { userId: string; dealerId: string; count: number; deliveryKey: string }) {
  if (!Number.isInteger(input.count) || input.count < 1) return;
  const owner = await db.user.findFirst({
    where: { id: input.userId, disabledAt: null, deletedAt: null, dealerProfile: { id: input.dealerId } },
    select: { email: true },
  });
  if (!owner) return;
  const to = await resolveDealerMailRecipients({
    dealerId: input.dealerId, primaryEmail: owner.email, category: "LISTING_UPDATES", notificationPreference: "draftListings",
  });
  if (!to.length) return;
  const noun = input.count === 1 ? "draft listing" : "draft listings";
  await sendResendEmail({
    to, subject: `${input.count} ${noun} ready for your review`, idempotencyKey: `draft-listings:${input.deliveryKey}`,
    ...renderBrandedEmail({
      title: "New drafts to review",
      intro: `${input.count} ${noun} ${input.count === 1 ? "has" : "have"} been added to your account for review.`,
      bodyLines: ["Check the details and photos, fix any highlighted issues, then submit when ready. You can also delete drafts you do not want.", "Existing live listings remain unchanged while you review proposed changes.", "You can turn these emails off under New draft listings in your notification settings."],
      actionHref: `${getEmailAppOrigin()}/dealer/listings?status=DRAFT`, actionLabel: "Review my drafts",
      secondaryHref: `${getEmailAppOrigin()}/account/notifications`, secondaryLabel: "Notification settings",
    }),
  });
}
