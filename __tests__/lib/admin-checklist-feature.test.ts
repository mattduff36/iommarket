import { describe, expect, it } from "vitest";
import { isAdminChecklistEnabled } from "@/lib/admin/checklist-feature";

describe("admin checklist feature gate", () => {
  const staging = {
    NODE_ENV: "production" as const,
    VERCEL_ENV: "preview",
    ITRADER_DEPLOYMENT_ROLE: "staging",
    NEXT_PUBLIC_APP_URL: "https://preview.itrader.im",
    NEXT_PUBLIC_SUPABASE_URL: "https://syneonzucehwlghqmfbg.supabase.co",
    DATABASE_URL: "postgres://postgres.syneonzucehwlghqmfbg:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres",
  };

  it("only enables the checklist for a verified staging deployment", () => {
    expect(isAdminChecklistEnabled(staging)).toBe(true);
    expect(isAdminChecklistEnabled({ ...staging, VERCEL_ENV: "production" })).toBe(false);
    expect(isAdminChecklistEnabled({ ...staging, DATABASE_URL: "postgres://postgres.snlqivvogfqesxpbjiei:example@aws-1-eu-west-2.pooler.supabase.com:5432/postgres" })).toBe(false);
    expect(isAdminChecklistEnabled({ ...staging, ITRADER_DEPLOYMENT_ROLE: "" })).toBe(false);
  });

  it("does not let an old flag override production and allows staging disable", () => {
    expect(isAdminChecklistEnabled({ ...staging, VERCEL_ENV: "production", ADMIN_CHECKLIST_ENABLED: "1" })).toBe(false);
    expect(isAdminChecklistEnabled({ ...staging, ADMIN_CHECKLIST_ENABLED: "0" })).toBe(false);
  });
});
