import { Resend } from "resend";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
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

export async function sendMonitoringAlertEmail(params: {
  to: string[];
  subject: string;
  text: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;
  if (params.to.length === 0) return;

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
}

function parseEmailRecipients(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendWaitlistConfirmationEmail(params: {
  to: string;
  interests: string[];
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const canonicalAppUrl = appUrl.replace(/\/$/, "");
  const logoUrl = `${canonicalAppUrl}/images/logo-itrader.png`;

  const interestsList = params.interests.map((item) => `- ${item}`).join("\n");
  const interestsHtml = params.interests
    .map(
      (item) =>
        `<li style="margin:0 0 6px 0;font-family:Arial,sans-serif;font-size:15px;line-height:22px;color:#d7dff2;">${escapeHtml(item)}</li>`
    )
    .join("");

  await resend.emails.send({
    from: getFromEmail(),
    to: params.to,
    subject: "You're on the iTrader.im waiting list",
    text: [
      "You're on the list!",
      "",
      "Thanks for your interest in iTrader.im — the upcoming vehicle marketplace for the Isle of Man.",
      "",
      "We'll notify you as soon as the platform launches.",
      "",
      "Your selected interests:",
      interestsList,
      "",
      "iTrader.im",
      "Buy • Sell • Upgrade",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>You're on the iTrader.im waiting list</title>
        </head>
        <body style="margin:0;padding:0;background-color:#000000;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;">
            <tr>
              <td align="center" style="padding:28px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;border:1px solid #1e2a46;border-radius:14px;background:radial-gradient(ellipse 90% 80% at 15% 0%, rgba(35,86,225,0.30) 0%, rgba(15,22,40,0) 60%),radial-gradient(ellipse 80% 70% at 85% 0%, rgba(232,72,35,0.20) 0%, rgba(15,22,40,0) 62%),#0f1628;">
                  <tr>
                    <td align="center" style="padding:26px 24px 14px 24px;">
                      <img src="${logoUrl}" alt="iTrader.im" width="230" style="display:block;width:230px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;" />
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:0 24px 24px 24px;">
                      <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#2f86ff;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">
                        Coming Soon
                      </p>
                      <h1 style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:34px;line-height:40px;font-weight:800;color:#ffffff;text-align:center;">
                        You're on the list!
                      </h1>
                      <p style="margin:0 auto 16px auto;font-family:Arial,sans-serif;font-size:17px;line-height:27px;color:#d7dff2;text-align:center;max-width:520px;">
                        Thanks for your interest in iTrader.im —<br />
                        the upcoming vehicle marketplace for the Isle of Man.
                      </p>
                      <p style="margin:0 auto 16px auto;font-family:Arial,sans-serif;font-size:17px;line-height:27px;color:#d7dff2;text-align:center;max-width:520px;">
                        We'll notify you as soon as the platform launches.
                      </p>
                      ${
                        params.interests.length > 0
                          ? `
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;background:rgba(255,255,255,0.05);border:1px solid #1e2a46;border-radius:10px;padding:0;">
                        <tr>
                          <td style="padding:14px 24px;">
                            <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#2f86ff;font-weight:700;letter-spacing:0.10em;text-transform:uppercase;">
                              Your interests
                            </p>
                            <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">
                              ${interestsHtml}
                            </ul>
                          </td>
                        </tr>
                      </table>`
                          : ""
                      }
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:18px 24px;border-top:1px solid #1e2a46;">
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#95a1be;text-align:center;">
                        iTrader.im<br />
                        Buy &bull; Sell &bull; Upgrade
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });
}

export async function sendWaitlistAdminNotificationEmail(params: {
  email: string;
  interests: string[];
  createdAt: Date;
  source: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  const recipients = parseEmailRecipients(
    process.env.RESEND_WAITLIST_TO_EMAIL ?? process.env.RESEND_REPORTS_TO_EMAIL
  );
  if (recipients.length === 0) return;

  const interestLine = params.interests.join(", ");
  const timestamp = params.createdAt.toLocaleString("en-GB", { timeZone: "UTC" });

  await resend.emails.send({
    from: getFromEmail(),
    to: recipients,
    subject: "New iTrader Waitlist Signup",
    text: [
      "A new waitlist signup has been captured.",
      "",
      `Email: ${params.email}`,
      `Selected interests: ${interestLine}`,
      `Timestamp (UTC): ${timestamp}`,
      `Source: ${params.source}`,
    ].join("\n"),
    html: `
      <div style="margin:0;padding:20px;background:#0b0d16;color:#f5f7ff;font-family:Inter,Arial,sans-serif;">
        <div style="max-width:620px;margin:0 auto;border:1px solid #2a2f44;border-radius:10px;background:#121a2f;padding:20px;">
          <h2 style="margin:0 0 14px 0;font-size:22px;color:#ffffff;">New iTrader Waitlist Signup</h2>
          <p style="margin:0 0 10px 0;color:#d1d7ea;"><strong>Email:</strong> ${params.email}</p>
          <p style="margin:0 0 10px 0;color:#d1d7ea;"><strong>Selected interests:</strong> ${interestLine}</p>
          <p style="margin:0 0 10px 0;color:#d1d7ea;"><strong>Timestamp (UTC):</strong> ${timestamp}</p>
          <p style="margin:0;color:#d1d7ea;"><strong>Source:</strong> ${params.source}</p>
        </div>
      </div>
    `,
  });
}
