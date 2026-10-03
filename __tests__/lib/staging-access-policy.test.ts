import { describe, expect, it } from "vitest";
import { hasStagingAdminRole, isStagingEntryRequest, isStagingMachineRequest, requiresStagingAdmin } from "@/lib/deployment/staging-access-policy";

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
