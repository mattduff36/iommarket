import { getEmailAppOrigin } from "@/lib/email/links";
import { renderBrandedEmail } from "@/lib/email/layout";
import { sendStrictResendEmail } from "@/lib/email/send-strict";

function formatCorrespondenceExpiry(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Isle_of_Man",
  }).format(date);
}

export function buildCorrespondenceVerificationUrl(token: string) {
  const url = new URL("/dealer/correspondence/verify", getEmailAppOrigin());
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildDealerCorrespondenceVerificationEmail(input: {
  dealerName: string;
  verifyUrl: string;
  expiresAt: Date;
}) {
  const expiresLabel = formatCorrespondenceExpiry(input.expiresAt);
  return {
    subject: "Confirm your iTrader correspondence email",
    ...renderBrandedEmail({
      title: "Confirm your correspondence email",
      intro: `${input.dealerName} asked iTrader to send selected dealer emails to this address.`,
      bodyLines: [
        "Open the link and then confirm the address. Opening the link does not activate it.",
        "This does not change the email address used to sign in.",
      ],
      actionHref: input.verifyUrl,
      actionLabel: "Review confirmation",
      notice: `This link expires on ${expiresLabel}. If you were not expecting it, you can ignore this email.`,
    }),
  };
}

export async function sendDealerCorrespondenceVerificationEmail(input: {
  to: string;
  dealerName: string;
  token: string;
  expiresAt: Date;
}) {
  const email = buildDealerCorrespondenceVerificationEmail({
    dealerName: input.dealerName,
    verifyUrl: buildCorrespondenceVerificationUrl(input.token),
    expiresAt: input.expiresAt,
  });
  await sendStrictResendEmail({
    to: input.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
