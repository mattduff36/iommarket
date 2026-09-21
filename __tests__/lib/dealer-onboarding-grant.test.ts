import { describe, expect, it } from "vitest";
import { planPromotionGrant, type PromotionGrantSnapshot } from "@/lib/dealers/onboarding/grant-plan";

const campaignStartsAt = new Date("2026-10-01T08:00:00.000Z");
const campaignEndsAt = new Date("2027-01-01T09:00:00.000Z");
const now = new Date("2026-10-15T12:00:00.000Z");

function grant(overrides: Partial<PromotionGrantSnapshot> = {}): PromotionGrantSnapshot {
  return {
    source: "ADMIN_GRANT",
    status: "ACTIVE",
    grantStartsAt: new Date("2026-09-01T00:00:00.000Z"),
    grantEndsAt: new Date("2026-12-01T00:00:00.000Z"),
    revokedAt: null,
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("promotion grant planning", () => {
  it("uses the campaign window before launch and for a dealer without a grant", () => {
    const beforeLaunch = planPromotionGrant({
      subscriptions: [],
      campaignStartsAt,
      campaignEndsAt,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(beforeLaunch).toMatchObject({ startsAt: campaignStartsAt, endsAt: campaignEndsAt });
  });

  it("keeps the later existing complimentary end during the campaign", () => {
    const planned = planPromotionGrant({
      subscriptions: [grant({ grantEndsAt: new Date("2027-03-01T00:00:00.000Z") })],
      campaignStartsAt,
      campaignEndsAt,
      now,
    });
    expect(planned).toMatchObject({
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-03-01T00:00:00.000Z"),
      preservedLongerGrant: true,
    });
  });

  it("extends an earlier complimentary grant to the campaign end", () => {
    const planned = planPromotionGrant({
      subscriptions: [grant()],
      campaignStartsAt,
      campaignEndsAt,
      now,
    });
    expect(planned).toMatchObject({
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: campaignEndsAt,
      preservedLongerGrant: false,
    });
  });

  it("does not keep a complimentary grant that has not started yet", () => {
    const planned = planPromotionGrant({
      subscriptions: [
        grant({
          grantStartsAt: new Date("2026-12-01T00:00:00.000Z"),
          grantEndsAt: new Date("2027-06-01T00:00:00.000Z"),
        }),
      ],
      campaignStartsAt,
      campaignEndsAt,
      now,
    });
    expect(planned).toMatchObject({
      startsAt: campaignStartsAt,
      endsAt: campaignEndsAt,
      preservedLongerGrant: false,
    });
  });

  it("does not preserve an expired grant", () => {
    const planned = planPromotionGrant({
      subscriptions: [grant({ grantEndsAt: new Date("2026-10-01T00:00:00.000Z") })],
      campaignStartsAt,
      campaignEndsAt,
      now,
    });
    expect(planned).toMatchObject({ startsAt: campaignStartsAt, endsAt: campaignEndsAt });
  });

  it("blocks a paid subscription without changing its dates", () => {
    const paid = grant({
      source: "PAYMENT",
      grantStartsAt: null,
      grantEndsAt: null,
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    });
    expect(
      planPromotionGrant({
        subscriptions: [paid],
        campaignStartsAt,
        campaignEndsAt,
        now,
      }),
    ).toEqual({ blocked: "paid-subscription" });
  });
});
