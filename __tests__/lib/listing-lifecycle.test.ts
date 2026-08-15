import { describe, expect, it } from "vitest";
import {
  canReinstateLive,
  canTransitionAction,
  getActionTargetStatus,
  isActionAuthorized,
  LIFECYCLE_ACTION_TRANSITIONS,
} from "@/lib/listings/lifecycle";

describe("listing lifecycle matrix ALR-LST-001", () => {
  it("maps every action except backfill to a valid from/to pair", () => {
    expect(getActionTargetStatus("REJECT")).toBe("REJECTED");
    expect(getActionTargetStatus("TAKE_DOWN")).toBe("TAKEN_DOWN");
    expect(getActionTargetStatus("REINSTATE_LIVE")).toBe("LIVE");
    expect(getActionTargetStatus("RETURN_TO_DRAFT")).toBe("DRAFT");
    expect(canTransitionAction("REJECT", "PENDING")).toBe(true);
    expect(canTransitionAction("REJECT", "LIVE")).toBe(false);
    expect(canTransitionAction("TAKE_DOWN", "LIVE")).toBe(true);
    expect(canTransitionAction("REINSTATE_LIVE", "TAKEN_DOWN")).toBe(true);
    expect(canTransitionAction("RETURN_TO_DRAFT", "REJECTED")).toBe(true);
    expect(canTransitionAction("SUBMIT", "TAKEN_DOWN")).toBe(true);
    expect(canTransitionAction("SUBMIT", "REJECTED")).toBe(true);
    expect(canTransitionAction("SUBMIT_REVISION", "LIVE")).toBe(true);
    expect(getActionTargetStatus("SUBMIT_REVISION")).toBe("LIVE");
    expect(Object.keys(LIFECYCLE_ACTION_TRANSITIONS)).toContain("ACCOUNT_DISABLE");
  });

  it("restricts admin-only actions", () => {
    expect(
      isActionAuthorized({
        action: "REJECT",
        actorRole: "USER",
        source: "USER",
        isOwner: true,
      }),
    ).toBe(false);
    expect(
      isActionAuthorized({
        action: "REJECT",
        actorRole: "ADMIN",
        source: "ADMIN",
        isOwner: false,
      }),
    ).toBe(true);
  });
});

describe("reinstate live ALR-LST-004", () => {
  it("requires prior live history and a future expiry", () => {
    expect(
      canReinstateLive({
        status: "TAKEN_DOWN",
        expiresAt: new Date(Date.now() + 60_000),
        hasPriorLive: true,
      }),
    ).toBe(true);
    expect(
      canReinstateLive({
        status: "TAKEN_DOWN",
        expiresAt: new Date(Date.now() - 60_000),
        hasPriorLive: true,
      }),
    ).toBe(false);
    expect(
      canReinstateLive({
        status: "TAKEN_DOWN",
        expiresAt: new Date(Date.now() + 60_000),
        hasPriorLive: false,
      }),
    ).toBe(false);
  });
});
