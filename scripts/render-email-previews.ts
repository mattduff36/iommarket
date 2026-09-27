import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEmailChangeEmail, buildInviteEmail, buildMagicLinkEmail, buildPasswordResetEmail, buildSignupConfirmationEmail } from "@/lib/email/auth-emails";
import { buildCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { buildCostInvoiceRequestEmail } from "@/lib/costs/email";
import { buildDealerOnboardingEmail } from "@/lib/email/dealer-onboarding";
import { buildDealerVerificationEmail } from "@/lib/email/dealer-notifications";
import { buildListingStatusEmail } from "@/lib/email/listing-notifications";
import { buildAdminReportEmail, buildContactConfirmationEmail, buildSellerContactEmail } from "@/lib/email/marketplace-emails";
import { buildMonitoringAlertEmail } from "@/lib/email/operational-emails";
import { buildWaitlistConfirmationEmail } from "@/lib/email/waitlist-emails";

const outputDir = path.join(tmpdir(), "itrader-email-previews");
const verifyUrl = "https://itrader.im/auth/callback?token_hash=fake-token&type=recovery";

const samples = {
  "dealer-onboarding": buildDealerOnboardingEmail({
    dealerName: "TD Car Centre",
    claimUrl: "https://itrader.im/dealer/onboarding/claim?token=fake-token",
    expiresAt: new Date("2026-05-01T12:00:00Z"),
  }),
  signup: buildSignupConfirmationEmail({ verifyUrl }),
  "password-reset": buildPasswordResetEmail({ verifyUrl }),
  "magic-link": buildMagicLinkEmail({ verifyUrl }),
  "email-change": buildEmailChangeEmail({
    newEmail: "new@example.com",
    confirmCurrentUrl: verifyUrl,
    confirmNewUrl: `${verifyUrl}-new`,
  }),
  invite: buildInviteEmail({ verifyUrl }),
  "seller-enquiry": buildSellerContactEmail({
    listingTitle: "2018 Ford Transit",
    listingUrl: "https://itrader.im/listings/listing-1",
    fromName: "Alex Buyer",
    fromEmail: "alex@example.com",
    message: "Is this van still available this weekend?",
  }),
  "buyer-confirmation": buildContactConfirmationEmail({
    listingTitle: "2018 Ford Transit",
    listingUrl: "https://itrader.im/listings/listing-1",
  }),
  "listing-approved": buildListingStatusEmail({
    action: "APPROVE",
    listingTitle: "2018 Ford Transit",
    listingId: "listing-1",
  }),
  "listing-rejected": buildListingStatusEmail({
    action: "REJECT",
    listingTitle: "2018 Ford Transit",
    listingId: "listing-1",
    reasonCode: "FRAUD",
  }),
  "dealer-verification": buildDealerVerificationEmail({
    dealerName: "TD Car Centre",
    verified: true,
  }),
  cancellation: buildCancellationStatusEmail({
    dealerName: "TD Car Centre",
    status: "ACKNOWLEDGED",
    periodEndAt: new Date("2026-05-31T00:00:00Z"),
  }),
  waitlist: buildWaitlistConfirmationEmail({ interests: ["Buying cars", "Dealer"] }),
  "admin-report": buildAdminReportEmail({
    reporterEmail: "reporter@example.com",
    listingTitle: "2018 Ford Transit",
    reason: "The price looks misleading.",
  }),
  invoice: buildCostInvoiceRequestEmail({
    requestId: "req_1",
    amountLabel: "£12.00",
    confirmUrl: "https://itrader.im/admin/costs/confirm/req_1",
  }),
  monitoring: buildMonitoringAlertEmail({
    subject: "[Monitoring][HIGH] api - timeout",
    text: "Issue: issue-1\nMessage: Example alert\nReview in admin: https://itrader.im/admin/monitoring/issue-1",
  }),
};

async function main() {
  await mkdir(outputDir, { recursive: true });
  for (const [name, email] of Object.entries(samples)) {
    if (!email) continue;
    await writeFile(path.join(outputDir, `${name}.html`), email.html, "utf8");
    await writeFile(path.join(outputDir, `${name}.txt`), email.text, "utf8");
  }
  console.log(`Wrote ${Object.keys(samples).length} email previews to ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
