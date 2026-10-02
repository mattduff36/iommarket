import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateLinkMock, getUserByIdMock, updateUserByIdMock } = vi.hoisted(() => ({
  generateLinkMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  updateUserByIdMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        generateLink: generateLinkMock,
        getUserById: getUserByIdMock,
        updateUserById: updateUserByIdMock,
      },
    },
  }),
}));

import {
  generateDealerRecoveryLink,
  invalidateDealerAuthSessions,
} from "@/lib/dealers/onboarding/auth-admin";
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

  it("invalidates old sessions through supported auth metadata without direct auth table writes", async () => {
    getUserByIdMock.mockResolvedValue({
      data: {
        user: {
          app_metadata: { dealer: true },
        },
      },
      error: null,
    });
    updateUserByIdMock.mockResolvedValue({
      data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
      error: null,
    });

    await expect(
      invalidateDealerAuthSessions(
        "11111111-1111-1111-1111-111111111111",
      ),
    ).resolves.toBeUndefined();

    expect(updateUserByIdMock).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      {
        app_metadata: {
          dealer: true,
          onboarding_session_invalid_before: expect.any(Number),
        },
      },
    );
  });
});
