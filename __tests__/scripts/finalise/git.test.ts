import { describe, expect, it } from "vitest";
import { assertPushTargetIsNotMain } from "../../../scripts/finalise/git";

describe("finalise push destination guard", () => {
  it("rejects a local main branch even without upstream configuration", () => {
    expect(() => assertPushTargetIsNotMain("main", null)).toThrow(
      /Direct pushes to main are blocked/u,
    );
  });

  it("rejects a staging checkout whose upstream points to main", () => {
    expect(() => assertPushTargetIsNotMain("staging", "origin/main")).toThrow(
      /Direct pushes to main are blocked/u,
    );
  });

  it("allows pushing staging to its staging upstream", () => {
    expect(() => assertPushTargetIsNotMain("staging", "origin/staging")).not.toThrow();
  });

  it("allows a short-lived branch to push to its same-named upstream", () => {
    expect(() =>
      assertPushTargetIsNotMain("fix/example", "origin/fix/example"),
    ).not.toThrow();
  });
});
