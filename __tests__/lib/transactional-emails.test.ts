import { describe, expect, it } from "vitest";
import {
  buildEmailChangeEmail,
  buildInviteEmail,
  buildMagicLinkEmail,
  buildPasswordResetEmail,
  buildSignupConfirmationEmail,
} from "@/lib/email/auth-emails";
import { buildCancellationStatusEmail } from "@/lib/email/cancellation-notifications";
import { buildCostInvoiceRequestEmail } from "@/lib/costs/email";
import { buildDealerOnboardingEmail } from "@/lib/email/dealer-onboarding";
import { buildDealerVerificationEmail } from "@/lib/email/dealer-notifications";
import { buildListingStatusEmail } from "@/lib/email/listing-notifications";
import {
  buildAdminReportEmail,
  buildContactConfirmationEmail,
  buildReportConfirmationEmail,
  buildSellerContactEmail,
} from "@/lib/email/marketplace-emails";
import { buildMonitoringAlertEmail } from "@/lib/email/operational-emails";
import {
  buildWaitlistAdminNotificationEmail,
  buildWaitlistConfirmationEmail,
} from "@/lib/email/waitlist-emails";

const VERIFY_URL = "https://itrader.im/auth/callback?token_hash=fake-token&type=recovery";

describe("transactional email templates", () => {
  it("renders branded auth calls to action and expiry copy", () => {
    const signup = buildSignupConfirmationEmail({ verifyUrl: VERIFY_URL });
    const reset = buildPasswordResetEmail({ verifyUrl: VERIFY_URL });
    const magic = buildMagicLinkEmail({ verifyUrl: VERIFY_URL });
    const invite = buildInviteEmail({ verifyUrl: VERIFY_URL });
    const change = buildEmailChangeEmail({
      newEmail: "new<user>@example.com",
      confirmCurrentUrl: VERIFY_URL,
      confirmNewUrl: `${VERIFY_URL}-new`,
    });

    expect(signup.html).toContain(">Confirm email</a>");
    expect(signup.text).toContain("24 hours");
    expect(reset.html).toContain(">Reset password</a>");
    expect(reset.text).toContain("1 hour");
    expect(reset.text).toContain(VERIFY_URL);
    expect(magic.html).toContain(">Sign in to iTrader</a>");
    expect(invite.html).toContain(">Accept invitation</a>");
    expect(change.html).toContain(">Confirm current email</a>");
    expect(change.html).toContain(">Confirm new email</a>");
    expect(change.html).toContain("new&lt;user&gt;@example.com");
    expect(change.html).not.toContain("new<user>@example.com");
    for (const email of [signup, reset, magic, invite, change]) {
      expect(email.html).toContain("https://itrader.im/images/logo-itrader-hq.png");
      expect(email.text.length).toBeGreaterThan(0);
    }
  });

  it("escapes marketplace content and preserves reply behaviour", () => {
    const seller = buildSellerContactEmail({
      listingTitle: "Van <script>",
      listingUrl: "https://itrader.im/listings/listing-1",
      fromName: "Buyer",
      fromEmail: "buyer@example.com",
      message: "Hello <b>there</b>",
    });
    expect(seller.replyTo).toBe("buyer@example.com");
    expect(seller.html).toContain("Van &lt;script&gt;");
    expect(seller.html).toContain("Hello &lt;b&gt;there&lt;/b&gt;");
    expect(seller.html).not.toContain("Van <script>");
    expect(seller.html).toContain(">View listing</a>");

    const buyer = buildContactConfirmationEmail({
      listingTitle: "Van <script>",
      listingUrl: "https://itrader.im/listings/listing-1",
    });
    expect(buyer.html).toContain(">View listing</a>");
    expect(buyer.html).not.toContain("Van <script>");

    const report = buildReportConfirmationEmail({
      listingTitle: "Van <script>",
      reason: "Reason <img>",
    });
    const adminReport = buildAdminReportEmail({
      reporterEmail: "reporter@example.com",
      listingTitle: "Van <script>",
      reason: "Reason <img>",
    });
    expect(report.html).not.toContain("Van <script>");
    expect(adminReport.html).toContain("Reason &lt;img&gt;");
    expect(adminReport.text).toContain("reporter@example.com");
  });

  it("uses the shared shell for waitlist, monitoring, cancellation, and invoices", () => {
    const waitlist = buildWaitlistConfirmationEmail({ interests: ["Cars <admin>"] });
    expect(waitlist.html).toContain("Coming Soon");
    expect(waitlist.html).toContain("https://itrader.im/images/logo-itrader-hq.png");
    expect(waitlist.html).toContain("Cars &lt;admin&gt;");
    expect(waitlist.html).not.toContain("<style");

    const admin = buildWaitlistAdminNotificationEmail({
      email: "ada<script>@example.com",
      interests: ["Cars"],
      createdAt: new Date("2026-01-01T00:00:00Z"),
      source: "homepage<img>",
    });
    expect(admin.html).toContain("ada&lt;script&gt;@example.com");
    expect(admin.html).not.toContain("homepage<img>");

    const monitoring = buildMonitoringAlertEmail({
      subject: "[Monitoring][HIGH] api - timeout",
      text: "Issue: issue-1\nReview in admin: https://itrader.im/admin/monitoring/issue-1",
    });
    expect(monitoring.text).toContain("Issue: issue-1");
    expect(monitoring.html).toContain(">Review alert</a>");

    const cancellation = buildCancellationStatusEmail({
      dealerName: "TD <Centre>",
      status: "ACKNOWLEDGED",
      periodEndAt: new Date("2026-05-01T00:00:00Z"),
    });
    expect(cancellation.subject).toBe("Cancellation request acknowledged");
    expect(cancellation.text).toContain("not an immediate provider cancellation");
    expect(cancellation.html).toContain("TD &lt;Centre&gt;");

    const invoice = buildCostInvoiceRequestEmail({
      requestId: "req_1",
      amountLabel: "£12.00",
      confirmUrl: "https://itrader.im/admin/costs/confirm/req_1",
    });
    expect(invoice.subject).toContain("£12.00");
    expect(invoice.html).toContain(">Confirm invoice request</a>");
    expect(invoice.text).toContain("req_1");
  });

  it("keeps listing moderation and dealer onboarding copy actionable", () => {
    const rejected = buildListingStatusEmail({
      action: "REJECT",
      listingTitle: "Listing <name>",
      listingId: "listing-1",
      reasonCode: "FRAUD",
    });
    expect(rejected?.html).toContain("Listing &lt;name&gt;");
    expect(rejected?.html).not.toContain("Listing <name>");
    expect(rejected?.html).toContain(">View listing</a>");
    expect(rejected?.text).toContain("Fraud or scam");

    const onboarding = buildDealerOnboardingEmail({
      dealerName: "TD Car Centre",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=fake",
      expiresAt: new Date("2026-05-01T12:00:00Z"),
    });
    expect(onboarding.html).toContain(">Review and accept</a>");

    const verified = buildDealerVerificationEmail({
      dealerName: "TD Car Centre",
      verified: true,
    });
    expect(verified.html).toContain(">Open dealer dashboard</a>");
  });
});
