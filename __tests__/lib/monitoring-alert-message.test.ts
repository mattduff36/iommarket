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

  it("describes signature, currency, and payload rejects differently", () => {
    const signature = buildAlertText({
      severity: "LOW",
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed the signature check before persist.",
      route: "/api/webhooks/payments",
      environment: "preview",
      occurrences: 4,
      issueId: "issue-sig",
      appUrl: "https://preview.itrader.im",
    });
    const currency = buildAlertText({
      severity: "LOW",
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed currency validation before persist.",
      route: "/api/webhooks/payments",
      environment: "preview",
      occurrences: 22,
      issueId: "issue-ccy",
      appUrl: "https://preview.itrader.im",
    });
    const payload = buildAlertText({
      severity: "LOW",
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed payload validation before persist.",
      route: "/api/webhooks/payments",
      environment: "preview",
      occurrences: 1,
      issueId: "issue-payload",
      appUrl: "https://preview.itrader.im",
    });
    const historical = buildAlertText({
      severity: "LOW",
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed HMAC or envelope checks before persist.",
      route: "/api/webhooks/payments",
      environment: "production",
      occurrences: 26,
      issueId: "issue-old",
      appUrl: "https://itrader.im",
    });

    expect(signature).toContain("failed a security check");
    expect(signature).not.toContain("invalid notice");
    expect(currency).toContain(
      "currency field was missing or unsupported (including malformed)",
    );
    expect(currency).not.toMatch(/not pounds|non-gbp|was not gbp|security check/i);
    expect(payload).toContain("details were not valid");
    expect(payload).not.toContain("security check");
    expect(historical).toContain("invalid notice");
    expect(historical).not.toMatch(/security check|not pounds|non-gbp/i);
    expect(new Set([signature, currency, payload, historical]).size).toBe(4);
    expect(buildAlertSubject({
      severity: "LOW",
      title: "Ripple webhook rejected",
      message: "Ripple webhook failed currency validation before persist.",
      route: "/api/webhooks/payments",
      environment: "preview",
    })).toBe(
      "[Monitoring] [LOW] - Payment notice rejected on the preview site — currency field was missing or unsupported (including malformed)",
    );
  });

  it.each(["missing", "blank", "wrongtype"] as const)(
    "does not describe currency state %s as a known non-GBP value",
    (state) => {
      const text = buildAlertText({
        severity: "LOW",
        title: "Ripple webhook rejected",
        message: `Ripple webhook failed currency validation before persist. ccyState ${state}`,
        route: "/api/webhooks/payments",
        environment: "preview",
        occurrences: 1,
        issueId: `issue-${state}`,
        appUrl: "https://preview.itrader.im",
      });

      expect(text).toContain(
        "currency field was missing or unsupported (including malformed)",
      );
      expect(text).not.toMatch(/not pounds|non-gbp|was not gbp|security check/i);
    },
  );

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
