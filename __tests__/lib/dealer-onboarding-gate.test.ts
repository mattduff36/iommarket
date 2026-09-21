import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, getUserMock } = vi.hoisted(() => ({
  mockDb: {
    user: { findUnique: vi.fn() },
    dealerOnboardingInvite: { findFirst: vi.fn() },
  },
  getUserMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth/supabase-config", () => ({
  isSupabaseAuthConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}));
vi.mock("@/lib/policy/acceptance", () => ({
  requireAccountAcceptance: vi.fn(async () => ({ ok: true })),
  ACCEPTANCE_REQUIRED_REDIRECT: "/accept-policies",
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireAuth } from "@/lib/auth";
import { OnboardingIncompleteError } from "@/lib/dealers/onboarding/access-gate";
import { acceptedAuthHttpStatus, requireAcceptedUser } from "@/lib/policy/gate";

const user = {
  id: "user-1",
  authUserId: "auth-1",
  role: "DEALER",
  disabledAt: null,
  deletedAt: null,
};

describe("pending onboarding isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "auth-1", email: "dealer@preview.im" } } });
    mockDb.user.findUnique.mockResolvedValue(user);
  });

  it("blocks protected actions while an invitation is unfinished", async () => {
    mockDb.dealerOnboardingInvite.findFirst.mockResolvedValue({ id: "invite-1", status: "SENT" });
    await expect(requireAuth()).rejects.toBeInstanceOf(OnboardingIncompleteError);
    expect(acceptedAuthHttpStatus(new OnboardingIncompleteError())).toBe(403);
  });

  it("redirects protected pages but leaves the onboarding page available", async () => {
    mockDb.dealerOnboardingInvite.findFirst.mockResolvedValue({ id: "invite-1", status: "CLAIMING" });
    await expect(requireAcceptedUser("/account")).rejects.toThrow("REDIRECT:/dealer/onboarding/accept");
    await expect(requireAcceptedUser("/dealer/onboarding/accept")).resolves.toMatchObject({
      id: "user-1",
    });
  });

  it("does not block the site when the onboarding table is not migrated yet", async () => {
    mockDb.dealerOnboardingInvite.findFirst.mockRejectedValue(
      new Error("The table DealerOnboardingInvite does not exist"),
    );
    await expect(requireAuth()).resolves.toMatchObject({ id: "user-1" });
  });
});
