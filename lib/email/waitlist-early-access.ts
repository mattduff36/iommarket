import { renderBrandedEmail } from "@/lib/email/layout";

export const EARLY_ACCESS_EMAIL_SUBJECT = "Your iTrader early access invitation";
export const EARLY_ACCESS_EMAIL_TITLE = "You're invited to iTrader";
export const EARLY_ACCESS_EMAIL_ACTION = "Create your account";

function bodyParagraphs(bodyText: string): string[] {
  return bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

export function buildWaitlistEarlyAccessEmail(input: {
  bodyText: string;
  claimUrl: string;
  test?: boolean;
}) {
  const paragraphs = bodyParagraphs(input.bodyText);
  return {
    subject: input.test
      ? `[Test] ${EARLY_ACCESS_EMAIL_SUBJECT}`
      : EARLY_ACCESS_EMAIL_SUBJECT,
    ...renderBrandedEmail({
      eyebrow: "Early access",
      preheader: paragraphs[0]?.slice(0, 140) || "Your iTrader early access invitation.",
      title: EARLY_ACCESS_EMAIL_TITLE,
      paragraphs,
      actionHref: input.claimUrl,
      actionLabel: EARLY_ACCESS_EMAIL_ACTION,
      notice: input.test
        ? "This is a test invitation sent only to an administrator. It is not the waitlist campaign."
        : "This invitation works only for the email address that received it, until iTrader opens to everyone.",
    }),
  };
}
