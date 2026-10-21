import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PRO_ENDS_AT,
  planPromotionGrant,
  type PromotionGrantSnapshot,
} from "@/lib/dealers/onboarding/grant-plan";
import {
  calendarMonthEndFromAcceptance,
  DW_CARS_PREPARED_EMAIL,
  SKILLANNAYLOR_PREPARED_EMAIL,
} from "@/lib/dealers/onboarding/offer-terms";

const now = new Date("2026-10-15T12:00:00.000Z");

function grant(overrides: Partial<PromotionGrantSnapshot> = {}): PromotionGrantSnapshot {
  return {
    id: "grant-1",
    source: "ADMIN_GRANT",
    status: "ACTIVE",
    grantStartsAt: new Date("2026-09-01T00:00:00.000Z"),
    grantEndsAt: new Date("2026-12-01T00:00:00.000Z"),
    revokedAt: null,
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
    promotionCampaignId: null,
    ...overrides,
  };
}

describe("promotion grant planning", () => {
  it("starts complimentary Pro at acceptance and ends through 31 December 2026", () => {
    const justBeforeEnd = new Date(ONBOARDING_PRO_ENDS_AT.getTime() - 1);
    expect(
      planPromotionGrant({
        subscriptions: [],
        now: justBeforeEnd,
        campaignId: "campaign-1",
      }),
    ).toEqual({
      kind: "create",
      startsAt: justBeforeEnd,
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
    expect(ONBOARDING_PRO_ENDS_AT.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("stops new complimentary access at the exclusive year-end boundary", () => {
    expect(
      planPromotionGrant({
        subscriptions: [],
        now: ONBOARDING_PRO_ENDS_AT,
        campaignId: "campaign-1",
      }),
    ).toEqual({ blocked: "promotion-ended" });
  });

  it("preserves a complimentary grant that already lasts beyond the promotion", () => {
    const laterEnd = new Date("2027-03-01T00:00:00.000Z");
    expect(
      planPromotionGrant({
        subscriptions: [grant({ grantEndsAt: laterEnd, currentPeriodEnd: laterEnd })],
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({
      kind: "preserve",
      subscriptionId: "grant-1",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: laterEnd,
    });
  });

  it("reconciles a shorter active grant onto the campaign without creating another", () => {
    expect(
      planPromotionGrant({
        subscriptions: [grant()],
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({
      kind: "reconcile",
      subscriptionId: "grant-1",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
  });

  it("reconciles an expired renewable grant but rejects a future grant", () => {
    expect(
      planPromotionGrant({
        subscriptions: [grant({ grantEndsAt: new Date("2026-10-01T00:00:00.000Z") })],
        now,
        campaignId: "campaign-1",
      }),
    ).toMatchObject({
      kind: "reconcile",
      subscriptionId: "grant-1",
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
    expect(
      planPromotionGrant({
        subscriptions: [
          grant({
            grantStartsAt: new Date("2026-12-01T00:00:00.000Z"),
            grantEndsAt: new Date("2027-06-01T00:00:00.000Z"),
          }),
        ],
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({ blocked: "conflicting-admin-grant" });
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
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({
      blocked: "paid-subscription",
    });
  });

  it("rejects malformed or differently-owned shorter active grants", () => {
    expect(
      planPromotionGrant({
        subscriptions: [grant({ revokedAt: new Date("2026-10-01T00:00:00.000Z") })],
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({ blocked: "conflicting-admin-grant" });
    expect(
      planPromotionGrant({
        subscriptions: [grant({ promotionCampaignId: "campaign-2" })],
        now,
        campaignId: "campaign-1",
      }),
    ).toEqual({ blocked: "conflicting-admin-grant" });
  });

  it("gives DW Cars one calendar month and does not repeat or extend it to year-end", () => {
    const accepted = new Date("2026-12-15T12:00:00.000Z");
    const first = planPromotionGrant({
      subscriptions: [],
      now: accepted,
      campaignId: "campaign-1",
      preparedEmail: `  ${DW_CARS_PREPARED_EMAIL.toUpperCase()} `,
    });
    const repeated = planPromotionGrant({
      subscriptions: [],
      now: accepted,
      campaignId: "campaign-1",
      preparedEmail: DW_CARS_PREPARED_EMAIL,
    });
    expect(first).toEqual(repeated);
    expect(first).toEqual({
      kind: "create",
      startsAt: accepted,
      endsAt: new Date("2027-01-15T12:00:00.000Z"),
    });
    expect(calendarMonthEndFromAcceptance(accepted).toISOString()).toBe(
      "2027-01-15T12:00:00.000Z",
    );
    if (!("kind" in first)) throw new Error("expected a DW grant plan");
    expect(first.endsAt.getTime()).toBeGreaterThan(ONBOARDING_PRO_ENDS_AT.getTime());

    expect(
      planPromotionGrant({
        subscriptions: [
          grant({
            grantStartsAt: accepted,
            grantEndsAt: first.endsAt,
            currentPeriodEnd: first.endsAt,
            promotionCampaignId: "campaign-1",
          }),
        ],
        now: accepted,
        campaignId: "campaign-1",
        preparedEmail: DW_CARS_PREPARED_EMAIL,
      }),
    ).toEqual({ blocked: "conflicting-admin-grant" });
    expect(
      planPromotionGrant({
        subscriptions: [grant()],
        now,
        campaignId: "campaign-1",
        preparedEmail: DW_CARS_PREPARED_EMAIL,
      }),
    ).toEqual({ blocked: "conflicting-admin-grant" });
  });

  it("keeps paid DW access unchanged and leaves SkillanNaylor on the year-end grant", () => {
    const paid = grant({
      source: "PAYMENT",
      grantStartsAt: null,
      grantEndsAt: null,
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
    });
    expect(
      planPromotionGrant({
        subscriptions: [paid],
        now,
        campaignId: "campaign-1",
        preparedEmail: DW_CARS_PREPARED_EMAIL,
      }),
    ).toEqual({ blocked: "paid-subscription" });
    expect(
      planPromotionGrant({
        subscriptions: [grant()],
        now,
        campaignId: "campaign-1",
        preparedEmail: SKILLANNAYLOR_PREPARED_EMAIL,
      }),
    ).toEqual({
      kind: "reconcile",
      subscriptionId: "grant-1",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: ONBOARDING_PRO_ENDS_AT,
    });
    expect(
      planPromotionGrant({
        subscriptions: [],
        now,
        campaignId: "campaign-1",
        preparedEmail: "owner@dwcars.info",
      }),
    ).toMatchObject({ kind: "create", endsAt: ONBOARDING_PRO_ENDS_AT });
  });
});
