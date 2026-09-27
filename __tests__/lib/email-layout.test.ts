import { describe, expect, it, vi } from "vitest";
import { EMAIL_LOGO_URL, renderBrandedEmail } from "@/lib/email/layout";

describe("branded email layout", () => {
  it("always loads the logo from the public production asset host", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://preview.itrader.im");
    const rendered = renderBrandedEmail({
      title: "Dealer onboarding",
      intro: "Claim your account.",
      bodyLines: ["Continue to iTrader."],
      actionHref:
        "https://preview.itrader.im/dealer/onboarding/claim?token=test",
    });

    expect(EMAIL_LOGO_URL).toBe(
      "https://itrader.im/images/logo-itrader-hq.png",
    );
    expect(rendered.html).toContain(`src="${EMAIL_LOGO_URL}"`);
    expect(rendered.html).not.toContain(
      'src="https://preview.itrader.im/images/',
    );
    expect(rendered.html).toContain(
      'href="https://preview.itrader.im/dealer/onboarding/claim?token=test"',
    );
  });

  it("escapes content and omits optional sections that were not provided", () => {
    const rendered = renderBrandedEmail({
      title: "Hello <script>",
      intro: "Body & more",
      actionHref: "https://itrader.im/reset?token=fake",
      actionLabel: "Reset password",
    });

    expect(rendered.html).toContain("Hello &lt;script&gt;");
    expect(rendered.html).toContain("Body &amp; more");
    expect(rendered.html).not.toContain("Hello <script>");
    expect(rendered.html).toContain(">Reset password</a>");
    expect(rendered.text).toContain("https://itrader.im/reset?token=fake");
    expect(rendered.html).not.toContain("Your interests");
    expect(rendered.text).toContain("iTrader.im");
    expect(rendered.text).toContain("Buy • Sell • Upgrade");
    expect(
      renderBrandedEmail({
        title: "Unsafe",
        intro: "Ignore this link.",
        actionHref: "javascript:alert(1)",
        actionLabel: "Continue",
      }).html,
    ).not.toContain("javascript:");
  });
});
