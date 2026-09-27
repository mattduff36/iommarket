import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";

export function buildMonitoringAlertEmail(input: { subject: string; text: string }) {
  const reviewPrefix = "Review in admin: ";
  const lines = input.text.split("\n");
  const reviewLine = lines.find((line) => line.startsWith(reviewPrefix));
  const reviewUrl = reviewLine?.slice(reviewPrefix.length).trim();
  const safeReviewUrl = reviewUrl && /^https?:\/\//i.test(reviewUrl) ? reviewUrl : undefined;
  const rendered = renderBrandedEmail({
    title: "Monitoring alert",
    intro: input.subject,
    paragraphs: lines.filter((line) => line !== reviewLine && line.trim().length > 0),
    ...(safeReviewUrl
      ? { actionHref: safeReviewUrl, actionLabel: "Review alert" }
      : {}),
  });

  return {
    subject: input.subject,
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
