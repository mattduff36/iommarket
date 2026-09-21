import { renderBrandedEmail } from "@/lib/email/layout";
import { formatIsleOfManDateTime } from "@/lib/dealers/onboarding/campaign-window";

export function buildDealerOnboardingEmail(input: {
  dealerName: string;
  claimUrl: string;
  expiresAt: Date;
  campaignStartsAt: Date;
  campaignEndsAt: Date;
}) {
  const subject = "Activate your iTrader dealer account";
  const intro = `${input.dealerName} has a complimentary Dealer Pro place on iTrader.im. Use the button below to claim the existing account, choose a password, and accept the dealer documents.`;
  const bodyLines = [
    `Complimentary Pro access runs from ${formatIsleOfManDateTime(input.campaignStartsAt)} until ${formatIsleOfManDateTime(input.campaignEndsAt)}.`,
    "The link opens a secure page. It does not sign anyone in until you choose to continue.",
    `This invitation expires on ${formatIsleOfManDateTime(input.expiresAt)}.`,
    "If you were not expecting this email, you can ignore it.",
  ];
  return {
    subject,
    ...renderBrandedEmail({
      title: "Claim your dealer account",
      intro,
      bodyLines,
      actionHref: input.claimUrl,
      actionLabel: "Review and accept",
    }),
  };
}
