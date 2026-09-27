import { describe, expect, it } from "vitest";
import { buildDealerCorrespondenceVerificationEmail } from "@/lib/email/dealer-correspondence";

describe("dealer correspondence verification email", () => {
  it("asks the recipient to confirm before the address is activated", () => {
    const email = buildDealerCorrespondenceVerificationEmail({
      dealerName: "Isle Cars",
      verifyUrl: "https://itrader.im/dealer/correspondence/verify?token=example-token",
      expiresAt: new Date("2026-09-28T12:00:00Z"),
    });

    expect(email.subject).toBe("Confirm your iTrader correspondence email");
    expect(email.text).toContain("Opening the link does not activate it.");
    expect(email.text).toContain("does not change the email address used to sign in");
    expect(email.text).toContain(
      "https://itrader.im/dealer/correspondence/verify?token=example-token",
    );
    expect(email.html).toContain(
      "https://itrader.im/dealer/correspondence/verify?token=example-token",
    );
  });
});
