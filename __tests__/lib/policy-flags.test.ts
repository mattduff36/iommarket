import { describe, expect, it } from "vitest";
import { getPolicyFlags } from "@/lib/policy/flags";

describe("POL-ACC-001 policy flags", () => {
  it("defaults enforcement off when flags are absent", () => {
    const flags = getPolicyFlags({});
    expect(flags.enforceAcceptance).toBe(false);
    expect(flags.canMutateRetention).toBe(false);
  });

  it("fails closed on malformed boolean flags", () => {
    expect(() =>
      getPolicyFlags({ POLICY_ENFORCE_ACCEPTANCE: "yes" }),
    ).toThrow(/exactly true, false, or absent/);
  });

  it("requires both mutate keys before retention can delete", () => {
    expect(
      getPolicyFlags({
        POLICY_RETENTION_MUTATE: "true",
      }).canMutateRetention,
    ).toBe(false);
    expect(
      getPolicyFlags({
        POLICY_RETENTION_MUTATE: "true",
        POLICY_RETENTION_ENTITY_ALLOWLIST: "LISTING_VIEW",
      }).canMutateRetention,
    ).toBe(true);
  });
});
