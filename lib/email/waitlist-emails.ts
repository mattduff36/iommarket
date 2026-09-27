import { parseEmailRecipients, sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";

export function buildWaitlistConfirmationEmail(input: { interests: string[] }) {
  return {
    subject: "You're on the iTrader.im waiting list",
    ...renderBrandedEmail({
      align: "center",
      eyebrow: "Coming Soon",
      preheader: "You're on the iTrader.im waiting list.",
      title: "You're on the list!",
      intro:
        "Thanks for your interest in iTrader.im — the upcoming vehicle marketplace for the Isle of Man.",
      paragraphs: ["We'll notify you as soon as the platform launches."],
      ...(input.interests.length > 0
        ? { highlight: { title: "Your interests", lines: input.interests } }
        : {}),
    }),
  };
}

export function buildWaitlistAdminNotificationEmail(input: {
  email: string;
  interests: string[];
  createdAt: Date;
  source: string;
}) {
  const timestamp = input.createdAt.toLocaleString("en-GB", { timeZone: "UTC" });
  return {
    subject: "New iTrader Waitlist Signup",
    ...renderBrandedEmail({
      title: "New waitlist signup",
      intro: "A new waitlist signup has been captured.",
      details: [
        { label: "Email", value: input.email },
        { label: "Interests", value: input.interests.join(", ") || "None" },
        { label: "Timestamp (UTC)", value: timestamp },
        { label: "Source", value: input.source },
      ],
    }),
  };
}

export async function sendWaitlistConfirmationEmail(params: {
  to: string;
  interests: string[];
}) {
  const email = buildWaitlistConfirmationEmail(params);
  await sendResendEmail({
    to: params.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

export async function sendWaitlistAdminNotificationEmail(params: {
  email: string;
  interests: string[];
  createdAt: Date;
  source: string;
}) {
  const recipients = parseEmailRecipients(
    process.env.RESEND_WAITLIST_TO_EMAIL ?? process.env.RESEND_REPORTS_TO_EMAIL,
  );
  if (recipients.length === 0) return;

  const email = buildWaitlistAdminNotificationEmail(params);
  await sendResendEmail({
    to: recipients,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
