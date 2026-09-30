import { describe, expect, it } from "vitest";
import { assertRemovalTarget } from "@/scripts/remove-excluded-preview-system-account";

const safeTarget = {
  user: {
    id: "user-rex",
    authUserId: "preview-system:rex-motor-company",
    dealerProfile: { id: "dealer-rex", isAdminPreview: true },
  },
  pack: {
    id: "pack-rex",
    dealerProfileId: "dealer-rex",
    enabled: false,
  },
};

describe("excluded preview-system account removal", () => {
  it("allows only the disabled Rex preview-system identity", () => {
    expect(assertRemovalTarget(safeTarget)).toBe("remove");
    expect(assertRemovalTarget({ user: null, pack: null })).toBe("already-absent");
  });

  it("refuses visible, mismatched, and incomplete targets", () => {
    expect(() => assertRemovalTarget({
      ...safeTarget,
      pack: { ...safeTarget.pack, enabled: true },
    })).toThrow(/unsafe/);
    expect(() => assertRemovalTarget({
      ...safeTarget,
      user: { ...safeTarget.user, authUserId: "real-auth-user" },
    })).toThrow(/unsafe/);
    expect(() => assertRemovalTarget({
      user: safeTarget.user,
      pack: null,
    })).toThrow(/incomplete/);
  });
});
