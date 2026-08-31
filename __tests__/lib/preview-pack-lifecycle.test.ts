import { describe, expect, it } from "vitest";
import { canTransitionAction } from "@/lib/listings/lifecycle";
import { isValidTransition } from "@/lib/listing-status";

describe("preview pack lifecycle", () => {
  it("never allows ADMIN_PREVIEW to become LIVE", () => {
    expect(isValidTransition("ADMIN_PREVIEW", "LIVE")).toBe(false);
    expect(canTransitionAction("APPROVE", "ADMIN_PREVIEW")).toBe(false);
    expect(canTransitionAction("REINSTATE_LIVE", "ADMIN_PREVIEW")).toBe(false);
    expect(canTransitionAction("MARK_SOLD", "ADMIN_PREVIEW")).toBe(false);
  });
});
