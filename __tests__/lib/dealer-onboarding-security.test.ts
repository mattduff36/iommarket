import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createOnboardingToken,
  hashOnboardingToken,
  onboardingTokenMatches,
  sanitizeOnboardingError,
} from "@/lib/dealers/onboarding/tokens";
import { assertSupabaseActionLink, buildOnboardingRedirectUrl } from "@/lib/dealers/onboarding/recovery-link";
import { displayOnboardingStatus } from "@/lib/dealers/onboarding/statuses";

describe("onboarding tokens", () => {
  it("stores only a hash and rejects rotated or malformed hashes", () => {
    const token = createOnboardingToken();
    const hash = hashOnboardingToken(token);
    expect(hash).not.toContain(token);
    expect(onboardingTokenMatches(token, hash)).toBe(true);
    expect(onboardingTokenMatches(createOnboardingToken(), hash)).toBe(false);
    expect(onboardingTokenMatches(token, "short")).toBe(false);
  });

  it("removes credential-bearing words from stored errors", () => {
    expect(sanitizeOnboardingError(new Error("bad token and password"))).toBe(
      "bad [redacted] and [redacted]",
    );
  });
});

describe("recovery links", () => {
  it("allows only the configured Supabase origin and a local callback", () => {
    const link = assertSupabaseActionLink(
      "https://project.supabase.co/auth/v1/verify?token=secret",
      "https://project.supabase.co",
    );
    expect(link).toContain("/auth/v1/verify");
    expect(() =>
      assertSupabaseActionLink("https://evil.example/auth", "https://project.supabase.co"),
    ).toThrow("Recovery link was rejected.");
    expect(buildOnboardingRedirectUrl("https://itrader.im")).toBe(
      "https://itrader.im/auth/callback?next=%2Fdealer%2Fonboarding%2Faccept",
    );
  });
});

describe("invitation status", () => {
  it("shows an unused invitation as expired without expiring a finalization", () => {
    const expiresAt = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(displayOnboardingStatus("SENT", expiresAt, now)).toBe("EXPIRED");
    expect(displayOnboardingStatus("FINALIZING_AUTH", expiresAt, now)).toBe("FINALIZING_AUTH");
  });
});

describe("onboarding migration", () => {
  it("preflights duplicate emails, preserves one live invite, and enables row security", () => {
    const sql = readFileSync(
      "prisma/migrations/20260921210000_dealer_onboarding_invites/migration.sql",
      "utf8",
    );
    expect(sql).toContain("case-insensitive duplicate user emails");
    expect(sql).toContain('CREATE UNIQUE INDEX "User_email_lower_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "DealerOnboardingInvite_live_dealerId_key"');
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toContain("UPDATE \"Subscription\"");
  });
});
