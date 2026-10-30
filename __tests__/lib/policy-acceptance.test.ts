import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  buildSignupAcceptanceReceipt,
  parseAcceptanceReceipt,
  importSignupAcceptances,
} from "@/lib/policy/acceptance";
import { buildBundleVersion } from "@/lib/policies/registry";

describe("POL-ACC-001 acceptance receipts", () => {
  it("imports all signup acceptances in one idempotent database write", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const client = { policyAcceptance: { createMany } } as unknown as Prisma.TransactionClient;
    await expect(importSignupAcceptances(client, "user-1", buildSignupAcceptanceReceipt()))
      .resolves.toEqual({ imported: true });
    expect(createMany).toHaveBeenCalledExactlyOnceWith({
      skipDuplicates: true,
      data: ["AGE_18", "ACCOUNT_BUNDLE", "PRIVACY_NOTICE"].map(acceptanceType =>
        expect.objectContaining({ userId: "user-1", acceptanceType, source: "SIGNUP" })),
    });
  });

  it("does not persist malformed or obsolete receipts", async () => {
    const createMany = vi.fn();
    const client = { policyAcceptance: { createMany } } as unknown as Prisma.TransactionClient;
    for (const receipt of [null, {}, { ...buildSignupAcceptanceReceipt(), bundleVersion: "obsolete" }]) {
      await expect(importSignupAcceptances(client, "user-1", receipt)).resolves.toEqual({ imported: false });
    }
    expect(createMany).not.toHaveBeenCalled();
  });

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
