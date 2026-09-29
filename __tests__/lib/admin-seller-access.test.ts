import { describe, expect, it } from "vitest";
import {
  ADMIN_OWNED_LISTING_ERROR,
  isAdminSellerBlocked,
} from "@/lib/listings/seller-access";

describe("admin seller access", () => {
  it("blocks every admin from personal selling and leaves other roles unchanged", () => {
    expect(isAdminSellerBlocked("ADMIN")).toBe(true);
    expect(isAdminSellerBlocked("USER")).toBe(false);
    expect(isAdminSellerBlocked("DEALER")).toBe(false);
    expect(isAdminSellerBlocked(null)).toBe(false);
    expect(ADMIN_OWNED_LISTING_ERROR).toMatch(/cannot create or manage/i);
  });
});
