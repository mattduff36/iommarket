import { describe, expect, it } from "vitest";
import {
  isOnboardingEligibleDealer,
  onboardingEligibleDealerWhere,
  type OnboardingDealerIdentity,
} from "@/lib/dealers/onboarding/eligible-dealers";
import { PLACEHOLDER_AUTH_PREFIX } from "@/lib/listings/sample-visibility";
import { PREVIEW_AUTH_USER_ID_PREFIX } from "@/lib/preview-packs/safety";

const now = new Date("2026-10-15T12:00:00.000Z");

function dealer(
  overrides: Partial<OnboardingDealerIdentity> = {},
): OnboardingDealerIdentity {
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
    const where = onboardingEligibleDealerWhere(
      ["athol-garage"],
      now,
      "preview",
    );
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
    expect(
      isOnboardingEligibleDealer(dealer(), ["athol-garage"], "preview"),
    ).toBe(true);
  });

  it("ties generic Preview Dealers to their selected Preview Packs", () => {
    const previewDealer = dealer({
      user: {
        ...dealer().user,
        email: "previewdealer2@itrader.im.preview",
      },
    });
    expect(
      isOnboardingEligibleDealer(previewDealer, ["athol-garage"], "preview"),
    ).toBe(true);
    expect(
      isOnboardingEligibleDealer(previewDealer, ["mikes-motors"], "preview"),
    ).toBe(false);
    expect(
      JSON.stringify(
        onboardingEligibleDealerWhere(["athol-garage"], now, "preview"),
      ),
    ).toContain("previewdealer2@itrader.im.preview");
  });

  it("allows only the dedicated production test dealer in production", () => {
    const productionDealer = dealer({
      user: {
        ...dealer().user,
        email: "productiondealer@itrader.im.preview",
      },
    });
    expect(isOnboardingEligibleDealer(productionDealer, [], "production")).toBe(
      true,
    );
    expect(isOnboardingEligibleDealer(dealer(), [], "production")).toBe(false);
    expect(
      JSON.stringify(onboardingEligibleDealerWhere([], now, "production")),
    ).toContain("productiondealer@itrader.im.preview");
  });

  it("fails closed outside explicit Preview and Production environments", () => {
    expect(onboardingEligibleDealerWhere([], now, undefined)).toEqual({
      id: { in: [] },
    });
    expect(
      isOnboardingEligibleDealer(dealer(), ["athol-garage"], undefined),
    ).toBe(false);
  });

  it("hides disabled packs, unmatched packs, sample dealers, and synthetic preview profiles", () => {
    expect(onboardingEligibleDealerWhere([], now, "preview")).toEqual({
      id: { in: [] },
    });
    expect(
      onboardingEligibleDealerWhere(["unknown-dealer"], now, "preview"),
    ).toEqual({ id: { in: [] } });
    expect(isOnboardingEligibleDealer(dealer(), [], "preview")).toBe(false);
    expect(
      isOnboardingEligibleDealer(dealer(), ["mikes-motors"], "preview"),
    ).toBe(false);
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
        "preview",
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
        "preview",
      ),
    ).toBe(false);
    expect(
      isOnboardingEligibleDealer(
        dealer({ isAdminPreview: true }),
        ["athol-garage"],
        "preview",
      ),
    ).toBe(false);
  });
});
