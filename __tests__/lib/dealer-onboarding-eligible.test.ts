import { describe, expect, it } from "vitest";
import {
  isOnboardingEligibleDealer,
  onboardingEligibleDealerWhere,
  type OnboardingDealerIdentity,
} from "@/lib/dealers/onboarding/eligible-dealers";
import { PLACEHOLDER_AUTH_PREFIX } from "@/lib/listings/sample-visibility";
import { PREVIEW_AUTH_USER_ID_PREFIX } from "@/lib/preview-packs/safety";

const now = new Date("2026-10-15T12:00:00.000Z");

function dealer(overrides: Partial<OnboardingDealerIdentity> = {}): OnboardingDealerIdentity {
  return {
    isAdminPreview: false,
    user: {
      email: "atholgarage@itrader.im.preview",
      authUserId: "auth-1",
      role: "DEALER",
      disabledAt: null,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("dealer onboarding eligibility", () => {
  it("includes an enabled preview pack only when its founding account can be claimed", () => {
    const where = onboardingEligibleDealerWhere(["athol-garage"], now);
    expect(where).toMatchObject({
      isAdminPreview: false,
      user: {
        role: "DEALER",
        deletedAt: null,
        disabledAt: null,
      },
    });
    expect(JSON.stringify(where)).toContain("atholgarage@itrader.im.preview");
    expect(JSON.stringify(where)).toContain(PLACEHOLDER_AUTH_PREFIX);
    expect(JSON.stringify(where)).toContain(PREVIEW_AUTH_USER_ID_PREFIX);
    expect(isOnboardingEligibleDealer(dealer(), ["athol-garage"])).toBe(true);
  });

  it("hides disabled packs, unmatched packs, sample dealers, and synthetic preview profiles", () => {
    expect(onboardingEligibleDealerWhere([], now)).toEqual({ id: { in: [] } });
    expect(onboardingEligibleDealerWhere(["unknown-dealer"], now)).toEqual({ id: { in: [] } });
    expect(isOnboardingEligibleDealer(dealer(), [])).toBe(false);
    expect(isOnboardingEligibleDealer(dealer(), ["mikes-motors"])).toBe(false);
    expect(
      isOnboardingEligibleDealer(
        dealer({
          user: {
            ...dealer().user,
            email: "info@manxmotors.im",
            authUserId: `${PLACEHOLDER_AUTH_PREFIX}000000000101`,
          },
        }),
        ["athol-garage"],
      ),
    ).toBe(false);
    expect(
      isOnboardingEligibleDealer(
        dealer({
          user: {
            ...dealer().user,
            authUserId: `${PREVIEW_AUTH_USER_ID_PREFIX}athol-garage`,
          },
        }),
        ["athol-garage"],
      ),
    ).toBe(false);
    expect(isOnboardingEligibleDealer(dealer({ isAdminPreview: true }), ["athol-garage"])).toBe(
      false,
    );
  });
});
