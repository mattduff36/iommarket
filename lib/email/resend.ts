import { Resend } from "resend";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL ?? "iTrader <no-reply@example.com>";
}

export async function sendSellerContactEmail(params: {
  sellerEmail: string;
  listingTitle: string;
  listingUrl: string;
  fromName: string;
  fromEmail: string;
  message: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.sellerEmail,
    replyTo: params.fromEmail,
    subject: `New enquiry about: ${params.listingTitle}`,
    text: [
      `You received a new message on iTrader.im.`,
      ``,
      `Listing: ${params.listingTitle}`,
      `Link: ${params.listingUrl}`,
      ``,
      `From: ${params.fromName} <${params.fromEmail}>`,
      ``,
      params.message,
    ].join("\n"),
  });
}

export async function sendContactConfirmationEmail(params: {
  buyerEmail: string;
  listingTitle: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.buyerEmail,
    subject: `Your enquiry was sent: ${params.listingTitle}`,
    text: `Thanks for contacting the seller about "${params.listingTitle}". They should reply to you directly by email.`,
  });
}

export async function sendReportNotificationEmail(params: {
  reporterEmail: string;
  listingTitle: string;
  reason: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.reporterEmail,
    subject: `Report received for: ${params.listingTitle}`,
    text: `Thanks. We received your report for "${params.listingTitle}" and will review it.\n\nReason:\n${params.reason}`,
  });

  const adminInbox = process.env.RESEND_REPORTS_TO_EMAIL;
  if (adminInbox) {
    await resend.emails.send({
      from: getFromEmail(),
      to: adminInbox,
      subject: `New listing report: ${params.listingTitle}`,
      text: `Reporter: ${params.reporterEmail}\n\nReason:\n${params.reason}`,
    });
  }
}
