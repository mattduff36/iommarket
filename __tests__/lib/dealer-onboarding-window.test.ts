import { describe, expect, it } from "vitest";
import {
  addCalendarMonths,
  buildLaunchCampaignWindow,
  InvalidLaunchDateError,
  parseLaunchLocalDateTime,
} from "@/lib/dealers/onboarding/campaign-window";

describe("launch campaign window", () => {
  it("adds three calendar months and clamps month ends", () => {
    expect(addCalendarMonths(parseLaunchLocalDateTime("2026-01-31T09:15"), 3)).toMatchObject({
      year: 2026,
      month: 4,
      day: 30,
      hour: 9,
      minute: 15,
    });
    expect(addCalendarMonths(parseLaunchLocalDateTime("2026-11-15T00:30"), 3)).toMatchObject({
      year: 2027,
      month: 2,
      day: 15,
    });
  });

  it("converts an Isle of Man launch instant and ends three months later", () => {
    const window = buildLaunchCampaignWindow("2026-06-01T09:00");
    expect(window.startsAt.toISOString()).toBe("2026-06-01T08:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-09-01T08:00:00.000Z");
    expect(window.timezone).toBe("Europe/Isle_of_Man");
  });

  it("uses Greenwich time before British Summer Time", () => {
    const window = buildLaunchCampaignWindow("2026-01-15T09:00");
    expect(window.startsAt.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(window.endsAt.toISOString()).toBe("2026-04-15T08:00:00.000Z");
  });

  it("rejects a local time skipped by the spring clock change", () => {
    expect(() => buildLaunchCampaignWindow("2026-03-29T01:30")).toThrow(InvalidLaunchDateError);
  });
});
