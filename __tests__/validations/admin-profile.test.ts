import { describe, expect, it } from "vitest";
import { adminProfileEditSchema } from "@/lib/validations/admin-profile";

const USER_ID = "clxxxxxxxxxxxxxxxxxxxxxxxxx";
const DEALER_ID = "cldealerxxxxxxxxxxxxxxxxx";
const REGION_ID = "clregionxxxxxxxxxxxxxxxxxx";
const TIMESTAMP = "2026-10-04T12:00:00.000Z";

function baseInput() {
  return {
    userId: USER_ID,
    expectedUserUpdatedAt: TIMESTAMP,
    account: {
      name: "Account Holder",
      phone: "01624 111111",
      bio: "Account bio",
      regionId: REGION_ID,
    },
    dealer: {
      dealerId: DEALER_ID,
      expectedDealerUpdatedAt: TIMESTAMP,
      name: "Ocean Motor Village",
      phone: "01624 222222",
      website: "https://example.com",
      bio: "Dealer bio",
    },
  };
}

describe("adminProfileEditSchema", () => {
  it("accepts an account edit without a dealer profile", () => {
    const result = adminProfileEditSchema.safeParse({
      userId: USER_ID,
      expectedUserUpdatedAt: TIMESTAMP,
      account: { name: "Account Holder", phone: "", bio: null, regionId: null },
    });

    expect(result.success).toBe(true);
  });

  it("allows omitted optional fields and explicit clears", () => {
    const omitted = adminProfileEditSchema.safeParse({
      userId: USER_ID,
      expectedUserUpdatedAt: TIMESTAMP,
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: TIMESTAMP,
        name: "Ocean Motor Village",
      },
    });
    const cleared = adminProfileEditSchema.safeParse({
      ...baseInput(),
      account: { phone: "", bio: null, regionId: null },
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: TIMESTAMP,
        phone: null,
        website: "",
        bio: "   ",
      },
    });

    expect(omitted.success).toBe(true);
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.account?.phone).toBe("");
      expect(cleared.data.dealer?.website).toBe("");
      expect(cleared.data.dealer?.name).toBeUndefined();
    }
  });

  it("rejects short names, bad websites, and protected fields", () => {
    expect(adminProfileEditSchema.safeParse({
      ...baseInput(),
      account: { name: "A" },
    }).success).toBe(false);
    expect(adminProfileEditSchema.safeParse({
      ...baseInput(),
      dealer: {
        dealerId: DEALER_ID,
        expectedDealerUpdatedAt: TIMESTAMP,
        website: "not a url",
      },
    }).success).toBe(false);

    for (const extra of [
      { email: "person@example.com" },
      { slug: "new-slug" },
      { logoUrl: "https://example.com/logo.png" },
      { avatarUrl: "https://example.com/avatar.png" },
      { verified: true },
      { role: "ADMIN" },
      { isAdminPreview: false },
    ]) {
      expect(adminProfileEditSchema.safeParse({ ...baseInput(), ...extra }).success).toBe(false);
      expect(adminProfileEditSchema.safeParse({
        ...baseInput(),
        dealer: { ...baseInput().dealer, ...extra },
      }).success).toBe(false);
    }
  });
});
