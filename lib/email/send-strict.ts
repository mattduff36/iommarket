import { getResendClient, getFromEmail, isSyntheticEmailRecipient } from "@/lib/email/client";

export async function sendStrictResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  from?: string;
  replyTo?: string;
}): Promise<{ id: string }> {
  const { captureStagingTestEffect } = await import("@/lib/deployment/staging-test-effects");
  const captured = await captureStagingTestEffect({
    kind: "EMAIL",
    payload: {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: input.headers,
      from: input.from,
      replyTo: input.replyTo,
    },
  });
  if (captured) return { id: captured.id };

  if (isSyntheticEmailRecipient(input.to)) throw new Error("Email delivery is disabled for synthetic development identities.");
  const { assertExternalEffectAllowed } = await import("@/lib/database-sync/effects");
  await assertExternalEffectAllowed({ emails: [input.to] });
  const resend = getResendClient();
  if (!resend) {
    throw new Error("Email delivery is not configured.");
  }
  const result = await resend.emails.send({
    from: input.from?.trim() || getFromEmail(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: input.headers,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  });
  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? "Email delivery failed.");
  }
  return { id: result.data.id };
}
