import { sendResendEmail } from "@/lib/email/client";
import { renderBrandedEmail } from "@/lib/email/layout";

export function buildSellerContactEmail(input: {
  listingTitle: string;
  listingUrl: string;
  fromName: string;
  fromEmail: string;
  message: string;
}) {
  return {
    subject: `New enquiry about: ${input.listingTitle}`,
    replyTo: input.fromEmail,
    ...renderBrandedEmail({
      preheader: `New enquiry about ${input.listingTitle}`,
      title: "New listing enquiry",
      intro: "You received a new message on iTrader.im.",
      details: [
        { label: "Listing", value: input.listingTitle },
        { label: "From", value: `${input.fromName} <${input.fromEmail}>` },
      ],
      paragraphs: [input.message],
      actionHref: input.listingUrl,
      actionLabel: "View listing",
      notice: "Replying to this email replies directly to the buyer.",
    }),
  };
}

export function buildContactConfirmationEmail(input: {
  listingTitle: string;
  listingUrl?: string;
}) {
  return {
    subject: `Your enquiry was sent: ${input.listingTitle}`,
    ...renderBrandedEmail({
      preheader: "Your enquiry has been sent to the seller.",
      title: "Your enquiry was sent",
      intro: `Thanks for contacting the seller about "${input.listingTitle}". They should reply to you directly by email.`,
      details: [{ label: "Listing", value: input.listingTitle }],
      ...(input.listingUrl
        ? { actionHref: input.listingUrl, actionLabel: "View listing" }
        : {}),
    }),
  };
}

export function buildReportConfirmationEmail(input: {
  listingTitle: string;
  reason: string;
}) {
  return {
    subject: `Report received for: ${input.listingTitle}`,
    ...renderBrandedEmail({
      title: "Report received",
      intro: `Thanks. We received your report for "${input.listingTitle}" and will review it.`,
      details: [
        { label: "Listing", value: input.listingTitle },
        { label: "Reason", value: input.reason },
      ],
    }),
  };
}

export function buildAdminReportEmail(input: {
  reporterEmail: string;
  listingTitle: string;
  reason: string;
}) {
  return {
    subject: `New listing report: ${input.listingTitle}`,
    ...renderBrandedEmail({
      title: "New listing report",
      intro: "A visitor reported a listing for review.",
      details: [
        { label: "Reporter", value: input.reporterEmail },
        { label: "Listing", value: input.listingTitle },
        { label: "Reason", value: input.reason },
      ],
    }),
  };
}

export async function sendSellerContactEmail(params: {
  sellerEmail: string;
  listingTitle: string;
  listingUrl: string;
  fromName: string;
  fromEmail: string;
  message: string;
}) {
  const email = buildSellerContactEmail(params);
  await sendResendEmail({
    to: params.sellerEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: params.fromEmail,
  });
}

export async function sendContactConfirmationEmail(params: {
  buyerEmail: string;
  listingTitle: string;
  listingUrl?: string;
}) {
  const email = buildContactConfirmationEmail(params);
  await sendResendEmail({
    to: params.buyerEmail,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

export async function sendReportNotificationEmail(params: {
  reporterEmail: string;
  listingTitle: string;
  reason: string;
}) {
  const confirmation = buildReportConfirmationEmail(params);
  await sendResendEmail({
    to: params.reporterEmail,
    subject: confirmation.subject,
    text: confirmation.text,
    html: confirmation.html,
  });

  const adminInbox = process.env.RESEND_REPORTS_TO_EMAIL;
  if (!adminInbox) return;

  const adminEmail = buildAdminReportEmail(params);
  await sendResendEmail({
    to: adminInbox,
    subject: adminEmail.subject,
    text: adminEmail.text,
    html: adminEmail.html,
  });
}
