import { describe, expect, it } from "vitest";
import { isAdminChecklistEnabled } from "@/lib/admin/checklist-feature";

describe("admin checklist feature gate", () => {
  it("defaults on only in Vercel preview", () => {
    expect(isAdminChecklistEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(isAdminChecklistEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
    expect(isAdminChecklistEnabled({ NODE_ENV: "development", VERCEL_ENV: "development" })).toBe(false);
  });

  it("allows an explicit server flag to enable or disable it in any environment", () => {
    expect(isAdminChecklistEnabled({ NODE_ENV: "development", ADMIN_CHECKLIST_ENABLED: "1" })).toBe(true);
    expect(isAdminChecklistEnabled({ NODE_ENV: "production", ADMIN_CHECKLIST_ENABLED: "1" })).toBe(true);
    expect(isAdminChecklistEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview", ADMIN_CHECKLIST_ENABLED: "0" })).toBe(false);
    expect(isAdminChecklistEnabled({ NODE_ENV: "production", VERCEL_ENV: "production", ADMIN_CHECKLIST_ENABLED: "0" })).toBe(false);
  });
});
