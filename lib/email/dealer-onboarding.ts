import { renderBrandedEmail } from "@/lib/email/layout";
import { formatIsleOfManDateTime } from "@/lib/dealers/onboarding/campaign-window";
import { ONBOARDING_PRO_END_LABEL } from "@/lib/dealers/onboarding/grant-plan";
import { resolveOnboardingOfferTerms } from "@/lib/dealers/onboarding/offer-terms";

export function buildDealerOnboardingEmail(input: {
  dealerName: string;
  claimUrl: string;
  expiresAt: Date;
  /** Prepared internal identity. Recipient addresses do not change the offer. */
  preparedEmail?: string;
}) {
  const calendarMonth = resolveOnboardingOfferTerms(input.preparedEmail ?? "") === "calendar-month";
  const subject = `Activate your iTrader dealer account — expires ${formatIsleOfManDateTime(input.expiresAt)}`;
  const intro = calendarMonth
    ? `${input.dealerName} can claim the existing dealer account on iTrader.im, choose a password, and accept the dealer documents. Complimentary Dealer Pro lasts for one calendar month from acceptance. After that month, Dealer Pro requires paid checkout.`
    : `${input.dealerName} has a complimentary Dealer Pro place on iTrader.im. Use the button below to claim the existing account, choose a password, and accept the dealer documents.`;
  const bodyLines = [
    calendarMonth
      ? "Complimentary Pro access starts when you accept this invitation and lasts for one calendar month. After that month, Dealer Pro requires paid checkout. Accepting does not take a payment or start automatic billing."
      : `Complimentary Pro access starts when you accept this invitation and ends at ${ONBOARDING_PRO_END_LABEL}.`,
    "The link opens a secure page. It does not sign anyone in until you choose to continue.",
  ];
  return {
    subject,
    ...renderBrandedEmail({
      title: "Claim your dealer account",
      intro,
      bodyLines,
      actionHref: input.claimUrl,
      actionLabel: "Review and accept",
      notice: `This invitation expires on ${formatIsleOfManDateTime(input.expiresAt)}. If you were not expecting this email, you can ignore it.`,
    }),
  };
}
