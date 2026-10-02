import { describe, expect, it } from "vitest";
import { buildMonitoringAlertEmail } from "@/lib/email/operational-emails";
import { buildAlertSubject, normaliseAlertSubject } from "@/lib/monitoring/alert-message";

describe("monitoring alert subjects", () => {
  it("collapses multiline issue titles into a single Resend subject", () => {
    const title = "Invalid `prisma.dealerUpgradeAcceptance.deleteMany()` invocation:\n\nDatabase error.";

    expect(buildAlertSubject({ severity: "HIGH", source: "SERVER", title })).toBe(
      "[Monitoring][HIGH] SERVER - Invalid `prisma.dealerUpgradeAcceptance.deleteMany()` invocation: Database error.",
    );
    expect(normaliseAlertSubject("Line one\r\nLine two")).not.toMatch(/[\r\n]/);
  });

  it("normalises a queued subject before the email is sent", () => {
    const email = buildMonitoringAlertEmail({
      subject: "[Monitoring][HIGH] SERVER - first line\nsecond line",
      text: "Review in admin: https://preview.itrader.im/admin/monitoring/issue-1",
    });

    expect(email.subject).toBe("[Monitoring][HIGH] SERVER - first line second line");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
