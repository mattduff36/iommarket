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

// ---------------------------------------------------------------------------
// Auth emails (sent via Supabase Send Email hook)
// ---------------------------------------------------------------------------

export async function sendSignupConfirmationEmail(params: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "Confirm your iTrader account",
    text: [
      "Welcome to iTrader.im!",
      "",
      "Please confirm your email address to activate your account:",
      params.verifyUrl,
      "",
      "This link expires in 24 hours.",
      "",
      "If you did not create an account, you can safely ignore this email.",
    ].join("\n"),
  });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "Reset your iTrader password",
    text: [
      "You requested a password reset for your iTrader.im account.",
      "",
      "Reset your password using this link:",
      params.verifyUrl,
      "",
      "This link expires in 1 hour.",
      "",
      "If you did not request a password reset, please ignore this email.",
    ].join("\n"),
  });
}

export async function sendMagicLinkEmail(params: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "Your iTrader sign-in link",
    text: [
      "Here is your sign-in link for iTrader.im:",
      "",
      params.verifyUrl,
      "",
      "This link expires in 1 hour and can only be used once.",
      "",
      "If you did not request this, please ignore this email.",
    ].join("\n"),
  });
}

export async function sendEmailChangeEmail(params: {
  to: string;
  newEmail: string;
  confirmCurrentUrl: string;
  confirmNewUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "Confirm your email change",
    text: [
      `You requested to change your iTrader.im email address to: ${params.newEmail}`,
      "",
      "Step 1 — confirm from your current email:",
      params.confirmCurrentUrl,
      "",
      "Step 2 — confirm from your new email address once received.",
      params.confirmNewUrl,
      "",
      "Both links expire in 24 hours.",
      "",
      "If you did not request this change, please contact support immediately.",
    ].join("\n"),
  });
}

export async function sendInviteEmail(params: {
  to: string;
  verifyUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "You've been invited to iTrader",
    text: [
      "You have been invited to join iTrader.im.",
      "",
      "Accept your invitation and set your password:",
      params.verifyUrl,
      "",
      "This link expires in 24 hours.",
    ].join("\n"),
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
