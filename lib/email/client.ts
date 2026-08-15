import { Resend } from "resend";

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Resend(apiKey);
}

export function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? "iTrader <no-reply@example.com>";
}

export function parseEmailRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

export function getModerationInbox(): string[] {
  return parseEmailRecipients(
    process.env.RESEND_MODERATION_TO_EMAIL ?? process.env.RESEND_REPORTS_TO_EMAIL,
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendResendEmail(input: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  if (recipients.length === 0) return;

  const result = await resend.emails.send({
    from: getFromEmail(),
    to: recipients,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}
