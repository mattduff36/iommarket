import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";
import { normaliseAlertSubject } from "@/lib/monitoring/alert-message";

function extractAlertUrl(text: string): string | undefined {
  for (const line of text.split("\n")) {
    if (line.startsWith("Review in admin: ")) {
      const marked = line.slice("Review in admin: ".length).trim();
      if (/^https?:\/\//i.test(marked)) return marked;
    }
    const match = line.match(/https?:\/\/\S+/);
    if (match?.[0] && /\/admin\/monitoring(?:\/|\s|$)/.test(match[0])) {
      return match[0].replace(/[)\].,]+$/, "");
    }
  }
  return undefined;
}

function emailHeading(subject: string): string {
  const prefixed = subject.match(/^\[Monitoring\] \[[A-Z]+\] - (.*)$/);
  return prefixed?.[1] || subject;
}

export function buildMonitoringAlertEmail(input: { subject: string; text: string }) {
  const subject = normaliseAlertSubject(input.subject);
  const safeReviewUrl = extractAlertUrl(input.text);
  const paragraphs = input.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("Review in admin:"));
  const rendered = renderBrandedEmail({
    title: emailHeading(subject),
    preheader: paragraphs[0],
    paragraphs,
    ...(safeReviewUrl
      ? { actionHref: safeReviewUrl, actionLabel: "Open this issue" }
      : {}),
  });

  return {
    subject: normaliseAlertSubject(input.subject),
    text: input.text,
    html: rendered.html,
  };
}

export async function sendMonitoringAlertEmail(params: {
  to: string[];
  subject: string;
  text: string;
}) {
  if (params.to.length === 0) return;
  const email = buildMonitoringAlertEmail(params);
  await sendResendEmail({
    to: params.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}
