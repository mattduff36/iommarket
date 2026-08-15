import { describe, expect, it } from "vitest";
import {
  buildSignupAcceptanceReceipt,
  parseAcceptanceReceipt,
} from "@/lib/policy/acceptance";
import { buildBundleVersion } from "@/lib/policies/registry";

describe("POL-ACC-001 acceptance receipts", () => {
  it("builds a trusted signup receipt for the current account bundle", () => {
    const receipt = buildSignupAcceptanceReceipt();
    expect(receipt.age18).toBe(true);
    expect(receipt.accountBundle).toBe(true);
    expect(receipt.bundleVersion).toBe(buildBundleVersion("ACCOUNT_BUNDLE"));
    expect(parseAcceptanceReceipt(receipt).success).toBe(true);
  });

  it("rejects mutable or incomplete receipts", () => {
    expect(parseAcceptanceReceipt({ age18: true }).success).toBe(false);
    expect(
      parseAcceptanceReceipt({
        age18: false,
        accountBundle: true,
        bundleVersion: buildBundleVersion("ACCOUNT_BUNDLE"),
        policyVersions: {},
        acceptedAt: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
});
