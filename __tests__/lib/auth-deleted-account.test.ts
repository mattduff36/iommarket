import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth/supabase-config", () => ({
  isSupabaseAuthConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/dealers/onboarding/access-gate", () => ({
  findBlockingOnboardingInvite: vi.fn(),
  OnboardingIncompleteError: class OnboardingIncompleteError extends Error {},
}));
vi.mock("@/lib/dealers/onboarding/session-cutoff", () => ({
  isOnboardingSessionStale: () => false,
  readOnboardingSessionInvalidBefore: () => null,
}));

import { DeletedAccountError, syncUser } from "@/lib/auth";

describe("syncUser deleted accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not free a deleted email and create a new profile", async () => {
    mockDb.$transaction.mockRejectedValue(new Error("Unique constraint failed on the fields: (`email`)"));
    mockDb.user.findFirst.mockResolvedValue({ deletedAt: new Date("2026-09-01T00:00:00.000Z") });

    await expect(syncUser("auth-new", "deleted.user@example.com")).rejects.toBeInstanceOf(
      DeletedAccountError,
    );
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.user.upsert).not.toHaveBeenCalled();
  });
});
