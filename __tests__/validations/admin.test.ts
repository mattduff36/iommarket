import { describe, it, expect } from "vitest";
import {
  listUsersSchema,
  setUserRoleSchema,
  setUserDisabledSchema,
  setUserRegionSchema,
  createDealerProfileSchema,
  updateDealerProfileSchema,
  createRegionSchema,
  updateRegionSchema,
  searchPaymentsSchema,
  refundPaymentSchema,
  cancelSubscriptionSchema,
  upsertContentPageSchema,
  updateSiteSettingSchema,
} from "@/lib/validations/admin";

describe("listUsersSchema", () => {
  it("accepts empty input with defaults", () => {
    const result = listUsersSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it("accepts full input", () => {
    const result = listUsersSchema.safeParse({
      query: "john",
      role: "DEALER",
      disabled: true,
      page: 2,
      pageSize: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const result = listUsersSchema.safeParse({ role: "SUPERADMIN" });
    expect(result.success).toBe(false);
  });
});

describe("setUserRoleSchema", () => {
  it("accepts valid input", () => {
    const result = setUserRoleSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      role: "ADMIN",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing userId", () => {
    const result = setUserRoleSchema.safeParse({ role: "USER" });
    expect(result.success).toBe(false);
  });
});

describe("setUserDisabledSchema", () => {
  it("accepts disable with reason", () => {
    const result = setUserDisabledSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      disabled: true,
      reason: "Spam account",
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason over 500 chars", () => {
    const result = setUserDisabledSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      disabled: true,
      reason: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("setUserRegionSchema", () => {
  it("accepts null regionId", () => {
    const result = setUserRegionSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      regionId: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("createDealerProfileSchema", () => {
  it("accepts valid profile", () => {
    const result = createDealerProfileSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Test Dealer",
      slug: "test-dealer",
    });
    expect(result.success).toBe(true);
  });

  it("rejects slug with spaces", () => {
    const result = createDealerProfileSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Test",
      slug: "test dealer",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty website string", () => {
    const result = createDealerProfileSchema.safeParse({
      userId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      name: "Test",
      slug: "test",
      website: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateDealerProfileSchema", () => {
  it("accepts partial update", () => {
    const result = updateDealerProfileSchema.safeParse({
      dealerId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      verified: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("createRegionSchema", () => {
  it("accepts valid region", () => {
    const result = createRegionSchema.safeParse({
      name: "Douglas",
      slug: "douglas",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short name", () => {
    const result = createRegionSchema.safeParse({ name: "A", slug: "a" });
    expect(result.success).toBe(false);
  });
});

describe("updateRegionSchema", () => {
  it("accepts toggle active", () => {
    const result = updateRegionSchema.safeParse({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      active: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("searchPaymentsSchema", () => {
  it("accepts empty input with defaults", () => {
    const result = searchPaymentsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it("rejects invalid status", () => {
    const result = searchPaymentsSchema.safeParse({ status: "COMPLETE" });
    expect(result.success).toBe(false);
  });
});

describe("refundPaymentSchema", () => {
  it("accepts valid cuid", () => {
    const result = refundPaymentSchema.safeParse({
      paymentId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
  });
});

describe("cancelSubscriptionSchema", () => {
  it("defaults immediately to false", () => {
    const result = cancelSubscriptionSchema.safeParse({
      subscriptionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.immediately).toBe(false);
    }
  });
});

describe("upsertContentPageSchema", () => {
  it("accepts new page", () => {
    const result = upsertContentPageSchema.safeParse({
      slug: "terms",
      title: "Terms of Service",
      markdown: "# Terms\n\nHello world.",
      status: "PUBLISHED",
    });
    expect(result.success).toBe(true);
  });

  it("rejects slug with spaces", () => {
    const result = upsertContentPageSchema.safeParse({
      slug: "my terms",
      title: "Terms",
      markdown: "content",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateSiteSettingSchema", () => {
  it("accepts numeric value", () => {
    const result = updateSiteSettingSchema.safeParse({
      key: "listing_fee_pence",
      value: 999,
    });
    expect(result.success).toBe(true);
  });

  it("accepts string value", () => {
    const result = updateSiteSettingSchema.safeParse({
      key: "launch_free_until",
      value: "2026-12-31T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty key", () => {
    const result = updateSiteSettingSchema.safeParse({ key: "", value: 1 });
    expect(result.success).toBe(false);
  });
});
