import { describe, expect, it } from "vitest";
import { emptyOpeningHours, parseOpeningHours } from "@/lib/dealers/opening-hours";
import { updateDealerSelfProfileSchema } from "@/lib/validations/account";

const profile = { name: "Test Dealer", slug: "test-dealer" };
describe("dealer opening hours", () => {
  it("keeps old profile callers compatible and defaults unknown schedules off", () => {
    expect(updateDealerSelfProfileSchema.parse(profile).openingHoursEnabled).toBeUndefined();
    expect(updateDealerSelfProfileSchema.safeParse({ ...profile, openingHoursEnabled: false, openingHours: emptyOpeningHours() }).success).toBe(true);
    expect(updateDealerSelfProfileSchema.safeParse({ ...profile, openingHoursEnabled: true, openingHours: emptyOpeningHours() }).success).toBe(false);
  });
  it("accepts split sales hours and appointment-only days", () => {
    const hours = emptyOpeningHours();
    hours.days[0] = { status: "open", periods: [{ opens: "09:00", closes: "12:00" }, { opens: "13:00", closes: "17:30" }] };
    hours.days[5] = { status: "appointment", periods: [] };
    hours.days[6] = { status: "24hours", periods: [] };
    expect(updateDealerSelfProfileSchema.safeParse({ ...profile, openingHoursEnabled: true, openingHours: hours }).success).toBe(true);
  });
  it("rejects incomplete, invalid, overlapping or contradictory schedules", () => {
    for (const periods of [[{ opens: "25:00", closes: "26:00" }], [{ opens: "17:00", closes: "09:00" }], [{ opens: "09:00", closes: "13:00" }, { opens: "12:00", closes: "17:00" }]]) {
      const hours = emptyOpeningHours(); hours.days[0] = { status: "open", periods };
      expect(parseOpeningHours(hours)).toBeNull();
    }
    expect(parseOpeningHours({ days: [], note: "" })).toBeNull();
    const hours = emptyOpeningHours(); hours.days[0].periods = [{ opens: "09:00", closes: "17:00" }];
    expect(parseOpeningHours(hours)).toBeNull();
  });
  it("does not accept source provenance or another dealer identity from self-service input", () => {
    expect(updateDealerSelfProfileSchema.safeParse({ ...profile, dealerId: "someone-else", openingHoursSourceUrl: "https://google.com" }).success).toBe(false);
  });
});
