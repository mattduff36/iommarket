import { getResendClient, getFromEmail } from "@/lib/email/client";

export async function sendStrictResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}): Promise<{ id: string }> {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("Email delivery is not configured.");
  }
  const result = await resend.emails.send({
    from: getFromEmail(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: input.headers,
  });
  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? "Email delivery failed.");
  }
  return { id: result.data.id };
}
