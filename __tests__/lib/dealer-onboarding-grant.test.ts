import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PRO_ENDS_AT,
  planPromotionGrant,
  type PromotionGrantSnapshot,
} from "@/lib/dealers/onboarding/grant-plan";

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
  it("starts complimentary Pro at acceptance and ends through 31 December 2026", () => {
    const justBeforeEnd = new Date(ONBOARDING_PRO_ENDS_AT.getTime() - 1);
    expect(planPromotionGrant({ subscriptions: [], now: justBeforeEnd })).toEqual({
      kind: "create",
      startsAt: justBeforeEnd,
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
    expect(ONBOARDING_PRO_ENDS_AT.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("stops new complimentary access at the exclusive year-end boundary", () => {
    expect(planPromotionGrant({ subscriptions: [], now: ONBOARDING_PRO_ENDS_AT })).toEqual({
      blocked: "promotion-ended",
    });
  });

  it("preserves a complimentary grant that already lasts beyond the promotion", () => {
    const laterEnd = new Date("2027-03-01T00:00:00.000Z");
    expect(
      planPromotionGrant({
        subscriptions: [grant({ grantEndsAt: laterEnd, currentPeriodEnd: laterEnd })],
        now,
      }),
    ).toEqual({ kind: "preserve", endsAt: laterEnd });
  });

  it("does not preserve a complimentary grant that ends before the promotion", () => {
    expect(planPromotionGrant({ subscriptions: [grant()], now })).toEqual({
      kind: "create",
      startsAt: now,
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
  });

  it("does not preserve an expired or not-yet-started grant", () => {
    expect(
      planPromotionGrant({
        subscriptions: [grant({ grantEndsAt: new Date("2026-10-01T00:00:00.000Z") })],
        now,
      }),
    ).toMatchObject({ kind: "create", endsAt: ONBOARDING_PRO_ENDS_AT });
    expect(
      planPromotionGrant({
        subscriptions: [
          grant({
            grantStartsAt: new Date("2026-12-01T00:00:00.000Z"),
            grantEndsAt: new Date("2027-06-01T00:00:00.000Z"),
          }),
        ],
        now,
      }),
    ).toMatchObject({ kind: "create", startsAt: now });
  });

  it("blocks a paid subscription without changing its dates", () => {
    const paid = grant({
      source: "PAYMENT",
      grantStartsAt: null,
      grantEndsAt: null,
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    });
    expect(planPromotionGrant({ subscriptions: [paid], now })).toEqual({
      blocked: "paid-subscription",
    });
  });
});
