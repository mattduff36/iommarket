import { describe, expect, it } from "vitest";
import {
  getFinaliseModeKey,
  getPushModeDescription,
  getTrustedOperationalAction,
  listTrustedOperationalActions,
} from "../../../scripts/finalise/trusted-actions";
import { FINALISE_CONTRACT } from "../../../scripts/finalise/types";

describe("finalise trusted actions", () => {
  it("maps flags to the registered command contract", () => {
    expect(getFinaliseModeKey({ full: false, push: false })).toBe("finalise");
    expect(getFinaliseModeKey({ full: false, push: true })).toBe("fap");
    expect(getFinaliseModeKey({ full: true, push: false })).toBe("finalise-full");
    expect(getFinaliseModeKey({ full: true, push: true })).toBe("ffap");
  });

  it("registers no database mutations and the iommarket contract", () => {
    const actions = listTrustedOperationalActions();
    expect(actions).toHaveLength(4);
    expect(actions.every((action) => action.contract === FINALISE_CONTRACT)).toBe(true);
    expect(actions.every((action) => action.dbMutations.length === 0)).toBe(true);
    expect(FINALISE_CONTRACT).toBe("iommarket-finalise-v1");
  });

  it("keeps push off for local finalise and on for fap/ffap", () => {
    expect(getTrustedOperationalAction("finalise")).toMatchObject({
      command: "npm run finalise",
      push: false,
      allowedEffects: ["verify", "git-commit"],
    });
    expect(getTrustedOperationalAction("fap")).toMatchObject({
      command: "npm run finalise:push",
      push: true,
    });
    expect(getTrustedOperationalAction("finalise-full")).toMatchObject({
      command: "npm run finalise:full",
      push: false,
    });
    expect(getTrustedOperationalAction("ffap")).toMatchObject({
      command: "npm run finalise:full:push",
      push: true,
    });
  });

  it("describes dry-run before other modes", () => {
    expect(getPushModeDescription({ full: true, push: true, dryRun: true })).toBe("dry-run");
    expect(getPushModeDescription({ full: true, push: true, dryRun: false })).toBe("full + push");
    expect(getPushModeDescription({ full: false, push: false, dryRun: false })).toBe("standard");
  });
});
