import { describe, expect, it } from "vitest";
import { hasStagingAccess, hasStagingAdminRole, isStagingEntryRequest, isStagingMachineRequest, requiresStagingAdmin } from "@/lib/deployment/staging-access-policy";
import { PREVIEW_PROJECT_REF } from "@/scripts/wipe-preview-marketplace/target";

const stagingEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  POSTGRES_URL: `postgresql://postgres.${PREVIEW_PROJECT_REF}:test@db.${PREVIEW_PROJECT_REF}.supabase.co:5432/postgres`,
};

describe("staging administrator access", () => {
  it("protects every hosted preview and explicitly staging deployment", () => {
    expect(requiresStagingAdmin({ VERCEL_ENV: "preview" })).toBe(true);
    expect(requiresStagingAdmin({ VERCEL_ENV: "production", ITRADER_DEPLOYMENT_ROLE: "staging" })).toBe(true);
    expect(requiresStagingAdmin({ VERCEL_ENV: "production" })).toBe(false);
  });
  it("does not grant access from an ordinary, deleted or disabled account", () => {
    expect(hasStagingAdminRole({ role: "ADMIN" })).toBe(true);
    expect(hasStagingAdminRole({ role: "DEALER" })).toBe(false);
    expect(hasStagingAdminRole({ role: "ADMIN", disabledAt: new Date() })).toBe(false);
    expect(hasStagingAdminRole({ role: "ADMIN", deletedAt: new Date() })).toBe(false);
    expect(hasStagingAdminRole(null)).toBe(false);
  });
  it("allows only verified, matching approved test identities on the exact staging deployment", () => {
    expect(hasStagingAccess({
      role: "USER", email: "mattduff36@gmail.com", verifiedAuthEmail: "mattduff36@gmail.com",
    }, stagingEnv)).toBe(true);
    expect(hasStagingAccess({
      role: "DEALER", email: "DAVOOOMARSH@HOTMAIL.COM", verifiedAuthEmail: "dAvOoOmArSh@HoTmAiL.cOm",
    }, stagingEnv)).toBe(true);
    expect(hasStagingAccess({
      role: "USER", email: "other@example.com", verifiedAuthEmail: "other@example.com",
    }, stagingEnv)).toBe(false);
  });
  it("requires verified auth email and a matching active database account", () => {
    expect(hasStagingAccess({ role: "USER", email: "mattduff36@gmail.com" }, stagingEnv)).toBe(false);
    expect(hasStagingAccess({
      role: "USER", email: "other@example.com", verifiedAuthEmail: "mattduff36@gmail.com",
    }, stagingEnv)).toBe(false);
    expect(hasStagingAccess({
      role: "USER", email: "mattduff36@gmail.com", verifiedAuthEmail: "mattduff36@gmail.com", disabledAt: new Date(),
    }, stagingEnv)).toBe(false);
    expect(hasStagingAccess({
      role: "USER", email: "mattduff36@gmail.com", verifiedAuthEmail: "mattduff36@gmail.com", deletedAt: new Date(),
    }, stagingEnv)).toBe(false);
  });
  it("fails closed for approved test identities outside the validated staging deployment", () => {
    const account = { role: "USER", email: "mattduff36@gmail.com", verifiedAuthEmail: "mattduff36@gmail.com" };
    expect(hasStagingAccess(account, { ...stagingEnv, VERCEL_ENV: "production" })).toBe(false);
    expect(hasStagingAccess(account, { ...stagingEnv, ITRADER_DEPLOYMENT_ROLE: "production" })).toBe(false);
    expect(hasStagingAccess(account, { ...stagingEnv, NEXT_PUBLIC_APP_URL: "https://example.com" })).toBe(false);
    expect(hasStagingAccess(account, { ...stagingEnv, NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" })).toBe(false);
    expect(hasStagingAccess(account, { ...stagingEnv, POSTGRES_URL: "postgresql://localhost/test" })).toBe(false);
  });
  it("keeps auth entry reachable without allowing action POST bypass", () => {
    expect(isStagingEntryRequest("/staging-access", "GET", false)).toBe(true);
    expect(isStagingEntryRequest("/sign-in", "POST", true)).toBe(false);
    expect(isStagingEntryRequest("/sign-in/anything", "GET", false)).toBe(false);
    expect(isStagingEntryRequest("/preview", "GET", false)).toBe(false);
  });
  it("only exempts exact signed machine endpoints and never cron or shared passwords", () => {
    expect(isStagingMachineRequest("/api/webhooks/ripple-staging", "POST", false)).toBe(true);
    expect(isStagingMachineRequest("/api/webhooks/ripple-staging", "POST", true)).toBe(false);
    expect(isStagingMachineRequest("/api/cron/account-deletion", "GET", false)).toBe(false);
    expect(isStagingMachineRequest("/api/dev-auth", "POST", false)).toBe(false);
  });
});
