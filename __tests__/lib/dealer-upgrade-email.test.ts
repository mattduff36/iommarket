import { describe, expect, it } from "vitest";
import { buildDealerUpgradeOfferEmail } from "@/lib/email/dealer-upgrade";

describe("dealer upgrade offer email", () => {
  it("explains that the account remains private until acceptance", () => {
    const email = buildDealerUpgradeOfferEmail({
      accountName: "Manx Motors",
      acceptanceUrl: "https://itrader.im/account/dealer-upgrade",
      durationDays: 90,
    });

    expect(email.subject).toMatch(/dealer upgrade/i);
    expect(email.text).toContain("90-day access period will begin only after");
    expect(email.text).toContain("remains a private-user account");
    expect(email.text).toContain(
      "https://itrader.im/account/dealer-upgrade",
    );
    expect(email.html).toContain("Review and accept");
  });
});
