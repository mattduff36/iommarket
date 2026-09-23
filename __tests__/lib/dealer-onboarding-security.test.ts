import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createOnboardingToken,
  hashOnboardingToken,
  onboardingTokenMatches,
  sanitizeOnboardingError,
} from "@/lib/dealers/onboarding/tokens";
import {
  assertRecoveryRedirectTarget,
  assertSupabaseActionLink,
  buildOnboardingClaimUrl,
  buildOnboardingRecoveryVerificationUrl,
  buildOnboardingRedirectUrl,
} from "@/lib/dealers/onboarding/recovery-link";
import {
  OnboardingOriginError,
  resolveOnboardingOrigin,
} from "@/lib/dealers/onboarding/deployment-origin";
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

  it("rejects a recovery link that falls back to a different callback", () => {
    const expected = buildOnboardingRedirectUrl("https://preview.example.vercel.app");
    const accepted =
      "https://project.supabase.co/auth/v1/verify?token=secret&type=recovery&redirect_to=" +
      encodeURIComponent(expected);
    expect(() => assertRecoveryRedirectTarget(accepted, expected)).not.toThrow();
    expect(() =>
      assertRecoveryRedirectTarget(
        "https://project.supabase.co/auth/v1/verify?token=secret&redirect_to=" +
          encodeURIComponent("https://itrader.im/auth/callback?next=%2Fdealer%2Fonboarding%2Faccept"),
        expected,
      ),
    ).toThrow("Recovery link was rejected.");
    expect(() =>
      assertRecoveryRedirectTarget("https://project.supabase.co/auth/v1/verify?token=secret", expected),
    ).toThrow("Recovery link was rejected.");
  });

  it("builds a server-readable one-time recovery callback", () => {
    const callback = buildOnboardingRecoveryVerificationUrl(
      buildOnboardingRedirectUrl("https://itrader.im"),
      "hashed-recovery-token-that-is-long-enough",
    );
    const parsed = new URL(callback);
    expect(parsed.origin).toBe("https://itrader.im");
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("token_hash")).toBe(
      "hashed-recovery-token-that-is-long-enough",
    );
    expect(parsed.searchParams.get("type")).toBe("recovery");
    expect(parsed.searchParams.get("next")).toBe(
      "/dealer/onboarding/accept",
    );
    expect(parsed.hash).toBe("");
    expect(callback).not.toContain("access_token");
    expect(callback).not.toContain("refresh_token");
  });
});

describe("onboarding deployment origin", () => {
  const previewEnv = {
    VERCEL_ENV: "preview",
    VERCEL_URL: "iommarket-git-preview.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://itrader.im",
    VERCEL_PROJECT_PRODUCTION_URL: "itrader.im",
    NODE_ENV: "production",
  };

  it("uses the preview deployment instead of the canonical production origin", () => {
    const origin = resolveOnboardingOrigin(previewEnv).origin;
    const token = "claim-token-claim-token-claim-token-xyz";
    expect(origin).toBe("https://iommarket-git-preview.vercel.app");
    expect(new URL(buildOnboardingClaimUrl(origin, token)).origin).toBe(origin);
    expect(new URL(buildOnboardingRedirectUrl(origin)).origin).toBe(origin);
  });

  it("keeps production on the canonical custom domain", () => {
    expect(
      resolveOnboardingOrigin({
        ...previewEnv,
        VERCEL_ENV: "production",
      }).origin,
    ).toBe("https://itrader.im");
  });

  it("rejects a missing or malformed preview origin", () => {
    expect(() => resolveOnboardingOrigin({ ...previewEnv, VERCEL_URL: "" })).toThrow(
      OnboardingOriginError,
    );
    expect(() =>
      resolveOnboardingOrigin({ ...previewEnv, VERCEL_URL: "https://user:pass@preview.example" }),
    ).toThrow(OnboardingOriginError);
    expect(() =>
      resolveOnboardingOrigin({ ...previewEnv, VERCEL_URL: "https://preview.example/dealer" }),
    ).toThrow(OnboardingOriginError);
    expect(() =>
      resolveOnboardingOrigin({ ...previewEnv, VERCEL_URL: "http://preview.example" }),
    ).toThrow(OnboardingOriginError);
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
