import { describe, it, expect } from "vitest";
import {
  deactivateMyAccountSchema,
  updateDealerSelfProfileSchema,
  updateMyProfileSchema,
} from "@/lib/validations/account";

describe("updateMyProfileSchema", () => {
  it("accepts valid profile input", () => {
    const result = updateMyProfileSchema.safeParse({
      name: "Test User",
      regionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      phone: "07624 123456",
      bio: "Hello world",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid avatar URL", () => {
    const result = updateMyProfileSchema.safeParse({
      name: "Test User",
      regionId: null,
      avatarUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateDealerSelfProfileSchema", () => {
  it("accepts valid dealer profile input", () => {
    const result = updateDealerSelfProfileSchema.safeParse({
      name: "Dealer One",
      slug: "dealer-one",
      bio: "Trusted dealer",
      website: "https://dealer.example",
      phone: "01624 123456",
      logoUrl: "https://example.com/logo.png",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug", () => {
    const result = updateDealerSelfProfileSchema.safeParse({
      name: "Dealer One",
      slug: "Dealer One",
    });
    expect(result.success).toBe(false);
  });
});

describe("deactivateMyAccountSchema", () => {
  it("accepts the exact confirmation text", () => {
    const result = deactivateMyAccountSchema.safeParse({
      confirmationText: "DELETE MY ACCOUNT",
      reason: "No longer needed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects incorrect confirmation text", () => {
    const result = deactivateMyAccountSchema.safeParse({
      confirmationText: "delete my account",
    });
    expect(result.success).toBe(false);
  });
});
