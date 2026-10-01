import { renderBrandedEmail } from "@/lib/email/layout";
import { getEmailAppOrigin } from "@/lib/email/links";
import { sendStrictResendEmail } from "@/lib/email/send-strict";

export function buildDealerAccessRevokedEmail() {
  return {
    subject: "Your complimentary iTrader dealer membership has ended",
    ...renderBrandedEmail({
      title: "Your complimentary dealer membership has ended",
      intro: "An iTrader administrator has withdrawn your complimentary dealer membership.",
      paragraphs: [
        "You can still sign in to your account. If you have no other active dealer membership, your dealer listings are now hidden from buyers and you cannot publish new dealer listings.",
        "Your saved listings remain in your account. Restoring dealer membership makes eligible listings visible again; expired listings still need renewal.",
        "Any separately paid subscription is unchanged. Contact iTrader if you think this change was made in error.",
      ],
      actionHref: `${getEmailAppOrigin()}/dealer/subscribe`,
      actionLabel: "View dealer membership",
    }),
  };
}

export async function sendDealerAccessRevokedEmail(to: string) {
  return sendStrictResendEmail({ to, ...buildDealerAccessRevokedEmail() });
}
