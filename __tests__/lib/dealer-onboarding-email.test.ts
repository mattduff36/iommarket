import { describe, expect, it } from "vitest";
import { buildDealerOnboardingEmail } from "@/lib/email/dealer-onboarding";

describe("dealer onboarding email", () => {
  it("uses an invitation-specific subject so Gmail does not collapse repeated emails", () => {
    const first = buildDealerOnboardingEmail({
      dealerName: "Production Dealer",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=first",
      expiresAt: new Date("2026-09-30T20:46:00.000Z"),
    });
    const second = buildDealerOnboardingEmail({
      dealerName: "Production Dealer",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=second",
      expiresAt: new Date("2026-09-30T20:47:00.000Z"),
    });

    expect(first.subject).toContain("expires");
    expect(first.subject).not.toBe(second.subject);
    expect(first.html).toContain(">Review and accept</a>");
    expect(first.text).toContain("Review and accept");
  });
});
