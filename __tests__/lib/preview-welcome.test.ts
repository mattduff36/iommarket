import { describe, expect, it } from "vitest";
import { PREVIEW_GATE_OPENS_AT } from "@/lib/launch/preview-rehearsal";
import {
  previewWelcomeCookieName,
  previewWelcomeEndsAt,
  shouldAnimateCountdownFlight,
} from "@/lib/launch/preview-welcome";

describe("preview welcome window", () => {
  it("opens the rehearsal at 00:40 BST and keeps the welcome for two hours", () => {
    expect(new Date(PREVIEW_GATE_OPENS_AT).toISOString()).toBe("2026-10-02T23:40:00.000Z");
    expect(previewWelcomeEndsAt()).toBe(PREVIEW_GATE_OPENS_AT + 2 * 60 * 60 * 1000);
  });

  it("namespaces the seen marker by this preview launch", () => {
    expect(previewWelcomeCookieName()).toBe("itrader_launch_seen_preview_20261002T234000Z");
    expect(previewWelcomeCookieName(Date.parse("2026-10-03T10:00:00+01:00"))).not.toBe(previewWelcomeCookieName());
  });

  it("flies only from the final ten seconds and snaps a late arrival", () => {
    expect(shouldAnimateCountdownFlight(9000, true, false)).toBe(true);
    expect(shouldAnimateCountdownFlight(4000, true, false)).toBe(false);
    expect(shouldAnimateCountdownFlight(9000, false, false)).toBe(false);
    expect(shouldAnimateCountdownFlight(9000, true, true)).toBe(false);
  });
});
