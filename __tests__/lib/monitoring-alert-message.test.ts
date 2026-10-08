import { describe, expect, it } from "vitest";
import { buildMonitoringAlertEmail } from "@/lib/email/operational-emails";
import { buildAlertSubject, buildAlertText, normaliseAlertSubject } from "@/lib/monitoring/alert-message";

const emailTaken = [
  "Invalid `prisma.user.create()` invocation:",
  "Unique constraint failed on the fields: (`email`)",
].join("\n");

describe("monitoring alert subjects", () => {
  it.each(["Smaller issues from iTrader", "Monitoring check passed"])(
    "prefixes every monitoring email, including %s",
    (subject) => {
      const email = buildMonitoringAlertEmail({ subject, text: "Monitoring update" });
      expect(email.subject).toBe(`[Monitoring] ${subject}`);
      expect(normaliseAlertSubject(email.subject)).toBe(email.subject);
    },
  );

  it("turns a known database failure into one plain subject line", () => {
    const title = "Invalid `prisma.dealerUpgradeAcceptance.deleteMany()` invocation:\n\nDatabase error.";

    expect(buildAlertSubject({ severity: "HIGH", title, environment: "production" })).toBe(
      "[Monitoring] [HIGH] - The site could not delete the dealer upgrade record on the live site",
    );
    expect(normaliseAlertSubject("Line one\r\nLine two")).not.toMatch(/[\r\n]/);
  });

  it("writes the sign-in email in everyday language", () => {
    const input = {
      severity: "HIGH" as const,
      title: emailTaken,
      message: emailTaken,
      route: "/api/me",
      action: "route",
      environment: "production",
      occurrences: 3,
    };

    expect(buildAlertSubject(input)).toBe("[Monitoring] [HIGH] - Sign-in problem on the live site — email already in use");
    const text = buildAlertText({ ...input, issueId: "issue-1", appUrl: "https://itrader.im" });
    expect(text).toContain("A signed-in person could not get an account, because their email is already registered. It has happened 3 times. The site is still up.");
    expect(text).toContain("Please open this and check that email: https://itrader.im/admin/monitoring/issue-1");
    expect(text).not.toMatch(/prisma|Unique constraint|invocation/i);
  });

  it("describes an error type it has never seen without quoting the raw failure", () => {
    const title = "ECONNRESET: socket hang up at Foo.bar (D:\\secret\\file.ts:12)";
    const text = buildAlertText({
      severity: "HIGH",
      title,
      message: title,
      route: "/search",
      environment: "production",
      occurrences: 1,
      issueId: "issue-2",
      appUrl: "https://itrader.im",
    });

    expect(buildAlertSubject({
      severity: "HIGH",
      title,
      message: title,
      route: "/search",
      environment: "production",
    })).toBe("[Monitoring] [HIGH] - Something needs attention on the live site");
    expect(text).toContain("Someone ran into a problem on search. It has happened once.");
    expect(text).not.toMatch(/ECONNRESET|Foo\.bar|file\.ts|secret/i);
  });

  it("normalises a queued subject before the email is sent", () => {
    const email = buildMonitoringAlertEmail({
      subject: "[Monitoring][HIGH] SERVER - first line\nsecond line",
      text: "Review in admin: https://preview.itrader.im/admin/monitoring/issue-1",
    });

    expect(email.subject).toBe("[Monitoring][HIGH] SERVER - first line second line");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).toContain(">Open this issue</a>");
  });

  it("keeps the severity prefix in the inbox subject and the plain sentence as the heading", () => {
    const email = buildMonitoringAlertEmail({
      subject: "[Monitoring] [HIGH] - Payment notice rejected on the live site",
      text: "A payment notice was turned away because it failed a security check. It has happened once. The site is still up.\n\nPlease open this and check that payment notice: https://itrader.im/admin/monitoring/issue-1",
    });

    expect(email.subject).toBe("[Monitoring] [HIGH] - Payment notice rejected on the live site");
    expect(email.html).toContain("Payment notice rejected on the live site");
    expect(email.html).not.toContain("[Monitoring] [HIGH] - Payment notice");
  });
});
