import { renderBrandedEmail } from "@/lib/email/layout";

export function buildDealerUpgradeOfferEmail(input: {
  accountName: string;
  acceptanceUrl: string;
  durationDays: number;
}) {
  return {
    subject: "Your complimentary iTrader dealer upgrade is ready",
    ...renderBrandedEmail({
      eyebrow: "Complimentary dealer upgrade",
      title: "Review your dealer upgrade",
      intro: `${input.accountName}, an iTrader administrator has offered your account complimentary dealer access.`,
      bodyLines: [
        `Your ${input.durationDays}-day access period will begin only after you review and accept the current dealer documents.`,
        "Until then, your account remains a private-user account and you can continue using it as normal.",
      ],
      actionHref: input.acceptanceUrl,
      actionLabel: "Review and accept",
      notice:
        "Sign in with the account that received this email. If you were not expecting this offer, you can ignore this message.",
    }),
  };
}
