import { describe, expect, it } from "vitest";
import { PUBLIC_LAUNCH_AT } from "@/lib/launch/preview-rehearsal";
import {
  previewWelcomeCookieName,
  previewWelcomeEndsAt,
  shouldAnimateCountdownFlight,
} from "@/lib/launch/preview-welcome";

describe("preview welcome window", () => {
  it("opens the public launch at 10:00 BST and keeps the welcome for two hours", () => {
    expect(new Date(PUBLIC_LAUNCH_AT).toISOString()).toBe("2026-10-03T09:00:00.000Z");
    expect(previewWelcomeEndsAt()).toBe(PUBLIC_LAUNCH_AT + 2 * 60 * 60 * 1000);
  });

  it("namespaces the seen marker by environment and launch instant", () => {
    expect(previewWelcomeCookieName()).toBe("itrader_launch_seen_public_20261003T090000Z");
    expect(previewWelcomeCookieName(PUBLIC_LAUNCH_AT, "production")).toBe(
      "itrader_launch_seen_production_20261003T090000Z",
    );
    expect(previewWelcomeCookieName(Date.parse("2026-10-03T00:40:00+01:00"), "preview")).not.toBe(
      previewWelcomeCookieName(PUBLIC_LAUNCH_AT, "production"),
    );
  });

  it("flies only from the final ten seconds and snaps a late arrival", () => {
    expect(shouldAnimateCountdownFlight(9000, true, false)).toBe(true);
    expect(shouldAnimateCountdownFlight(4000, true, false)).toBe(false);
    expect(shouldAnimateCountdownFlight(9000, false, false)).toBe(false);
    expect(shouldAnimateCountdownFlight(9000, true, true)).toBe(false);
  });
});
