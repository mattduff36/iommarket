import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateLinkMock } = vi.hoisted(() => ({
  generateLinkMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        generateLink: generateLinkMock,
      },
    },
  }),
}));

import { generateDealerRecoveryLink } from "@/lib/dealers/onboarding/auth-admin";
import { buildOnboardingRedirectUrl } from "@/lib/dealers/onboarding/recovery-link";

describe("dealer onboarding recovery generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a first-party token-hash callback instead of a fragment session", async () => {
    const redirectTo = buildOnboardingRedirectUrl("https://itrader.im");
    generateLinkMock.mockResolvedValue({
      error: null,
      data: {
        user: { id: "auth-user-1" },
        properties: {
          action_link:
            "https://project.supabase.co/auth/v1/verify?token=provider-token&type=recovery&redirect_to=" +
            encodeURIComponent(redirectTo),
          hashed_token: "hashed-recovery-token-that-is-long-enough",
          verification_type: "recovery",
        },
      },
    });

    const result = await generateDealerRecoveryLink({
      email: "dealer@itrader.im.preview",
      redirectTo,
    });

    expect(generateLinkMock).toHaveBeenCalledWith({
      type: "recovery",
      email: "dealer@itrader.im.preview",
      options: { redirectTo },
    });
    expect(result.authUserId).toBe("auth-user-1");
    const callback = new URL(result.actionLink);
    expect(callback.origin).toBe("https://itrader.im");
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("token_hash")).toBe(
      "hashed-recovery-token-that-is-long-enough",
    );
    expect(callback.searchParams.get("type")).toBe("recovery");
    expect(callback.hash).toBe("");
  });

  it("fails closed when Supabase does not return a one-time token hash", async () => {
    const redirectTo = buildOnboardingRedirectUrl("https://itrader.im");
    generateLinkMock.mockResolvedValue({
      error: null,
      data: {
        user: { id: "auth-user-1" },
        properties: {
          action_link:
            "https://project.supabase.co/auth/v1/verify?token=provider-token&type=recovery&redirect_to=" +
            encodeURIComponent(redirectTo),
          verification_type: "recovery",
        },
      },
    });

    await expect(
      generateDealerRecoveryLink({
        email: "dealer@itrader.im.preview",
        redirectTo,
      }),
    ).rejects.toThrow("Unable to start secure account claim.");
  });
});
