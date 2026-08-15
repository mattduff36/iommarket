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

  it("accepts an all-on matrix without changing absent defaults", () => {
    const flags = getPolicyFlags({
      POLICY_ENFORCE_ACCEPTANCE: "true",
      POLICY_ENFORCE_LISTING_NS: "true",
      POLICY_ENABLE_CANCELLATION_REQUESTS: "true",
      POLICY_ENABLE_DELETION_WORKER: "true",
      POLICY_RETENTION_MUTATE: "true",
      POLICY_RETENTION_ENTITY_ALLOWLIST: "LISTING,LISTING_VIEW,REPORT,DEALER_REVIEW",
    });
    expect(flags.enforceAcceptance).toBe(true);
    expect(flags.enforceListingNs).toBe(true);
    expect(flags.enableCancellationRequests).toBe(true);
    expect(flags.enableDeletionWorker).toBe(true);
    expect(flags.canMutateRetention).toBe(true);
    expect(getPolicyFlags({}).canMutateRetention).toBe(false);
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
