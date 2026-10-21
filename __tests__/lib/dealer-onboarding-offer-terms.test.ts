import { describe, expect, it } from "vitest";
import { buildDealerOnboardingEmail } from "@/lib/email/dealer-onboarding";
import { ONBOARDING_PRO_END_LABEL } from "@/lib/dealers/onboarding/grant-plan";
import { getFoundingDealer } from "@/lib/dealers/onboarding/founding-allowlist";
import {
  calendarMonthEndFromAcceptance,
  DW_CARS_PREPARED_EMAIL,
  resolveOnboardingOfferTerms,
  SKILLANNAYLOR_PREPARED_EMAIL,
} from "@/lib/dealers/onboarding/offer-terms";

describe("dealer onboarding offer terms", () => {
  it("allowlists SkillanNaylor at year-end and DW Cars for one calendar month", () => {
    expect(getFoundingDealer("skillannaylor-car-company")).toEqual({
      key: "skillannaylor-car-company",
      displayName: "SkillanNaylor Car Company",
      email: SKILLANNAYLOR_PREPARED_EMAIL,
      website: "https://sncc.im/",
      regionSlug: "iom-east",
    });
    expect(getFoundingDealer("dw-cars")).toEqual({
      key: "dw-cars",
      displayName: "DW Cars",
      email: DW_CARS_PREPARED_EMAIL,
      website: "https://www.dwcars.info/",
      regionSlug: "iom-east",
    });
    expect(resolveOnboardingOfferTerms(SKILLANNAYLOR_PREPARED_EMAIL)).toBe(
      "year-end-complimentary",
    );
    expect(resolveOnboardingOfferTerms(` ${DW_CARS_PREPARED_EMAIL.toUpperCase()} `)).toBe(
      "calendar-month",
    );
    expect(resolveOnboardingOfferTerms("owner@dwcars.info")).toBe("year-end-complimentary");
    expect(resolveOnboardingOfferTerms("atholgarage@itrader.im.preview")).toBe(
      "year-end-complimentary",
    );
  });

  it("clamps month-ends, keeps leap day, and repeats the same end", () => {
    expect(calendarMonthEndFromAcceptance(new Date("2026-01-31T12:00:00.000Z")).toISOString()).toBe(
      "2026-02-28T12:00:00.000Z",
    );
    expect(calendarMonthEndFromAcceptance(new Date("2024-01-31T12:00:00.000Z")).toISOString()).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(calendarMonthEndFromAcceptance(new Date("2024-02-29T08:15:30.250Z")).toISOString()).toBe(
      "2024-03-29T08:15:30.250Z",
    );
    expect(calendarMonthEndFromAcceptance(new Date("2026-03-31T00:30:00.000Z")).toISOString()).toBe(
      "2026-04-30T00:30:00.000Z",
    );
    const accepted = new Date("2026-10-21T09:00:00.000Z");
    const first = calendarMonthEndFromAcceptance(accepted);
    expect(calendarMonthEndFromAcceptance(accepted)).toEqual(first);
    expect(first.toISOString()).toBe("2026-11-21T10:00:00.000Z");
  });

  it("describes DW checkout after one month and leaves other dealers on the year-end email", () => {
    const dw = buildDealerOnboardingEmail({
      dealerName: "DW Cars",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=dw",
      expiresAt: new Date("2026-10-28T12:00:00.000Z"),
      preparedEmail: DW_CARS_PREPARED_EMAIL,
    });
    const skillan = buildDealerOnboardingEmail({
      dealerName: "SkillanNaylor Car Company",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=sncc",
      expiresAt: new Date("2026-10-28T12:00:00.000Z"),
      preparedEmail: SKILLANNAYLOR_PREPARED_EMAIL,
    });
    const other = buildDealerOnboardingEmail({
      dealerName: "Athol Garage",
      claimUrl: "https://itrader.im/dealer/onboarding/claim?token=athol",
      expiresAt: new Date("2026-10-28T12:00:00.000Z"),
    });

    expect(dw.text).toContain("one calendar month");
    expect(dw.text).toContain("paid checkout");
    expect(dw.text).toContain("does not take a payment or start automatic billing");
    expect(dw.html).toContain("one calendar month");
    expect(dw.text).not.toContain("31 December 2026");
    expect(skillan.text).toContain(ONBOARDING_PRO_END_LABEL);
    expect(skillan.text).not.toContain("one calendar month");
    expect(other.text).toContain(ONBOARDING_PRO_END_LABEL);
    expect(other.text).not.toContain("paid checkout");
  });
});
