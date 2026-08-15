import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { captureException } from "@/lib/monitoring";

export function buildDealerVerificationEmail(input: {
  dealerName: string;
  verified: boolean;
}) {
  const title = input.verified
    ? "Your dealer profile is verified"
    : "Your dealer verification was removed";
  const intro = input.verified
    ? "Buyers will now see a verified dealer badge on your listings."
    : "The verified dealer badge has been removed from your profile.";
  return {
    subject: title,
    ...renderBrandedEmail({
      title,
      intro,
      bodyLines: [`Dealer: ${input.dealerName}`],
    }),
  };
}

export async function sendDealerVerificationEmail(input: {
  to: string;
  dealerName: string;
  verified: boolean;
}) {
  try {
    const email = buildDealerVerificationEmail(input);
    await sendResendEmail({
      to: input.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch (error) {
    try {
      await captureException({
        source: "BUSINESS",
        error,
        severity: "MEDIUM",
        title: "Dealer verification email failed",
        action: "sendDealerVerificationEmail",
      });
    } catch {
      // Email is best-effort and must not fail a committed verification change.
    }
  }
}
