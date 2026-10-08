import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { getAuthUser, signOut, mockDb } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  signOut: vi.fn(),
  mockDb: {
    $transaction: vi.fn(),
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth/supabase-config", () => ({
  isSupabaseAuthConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: getAuthUser,
      signOut,
    },
  })),
}));
vi.mock("@/lib/dealers/onboarding/access-gate", () => ({
  findBlockingOnboardingInvite: vi.fn(),
  OnboardingIncompleteError: class OnboardingIncompleteError extends Error {},
}));
vi.mock("@/lib/dealers/onboarding/session-cutoff", () => ({
  isOnboardingSessionStale: () => false,
  readOnboardingSessionInvalidBefore: () => null,
}));

import {
  DeletedAccountError,
  getCurrentUser,
  ProfileNameRequiredError,
  syncUser,
} from "@/lib/auth";

describe("syncUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
    );
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

  it("retries a unique collision only after confirming the same auth identity now exists", async () => {
    const sameIdentity = { id: "user-1", deletedAt: null };
    mockDb.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sameIdentity)
      .mockResolvedValueOnce(sameIdentity);
    mockDb.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "test", meta: { modelName: "User", target: ["email"] } },
    ));
    mockDb.user.update.mockResolvedValue({ id: "user-1" });

    await expect(syncUser("auth-same", "member@example.com", "Member")).resolves.toMatchObject({ id: "user-1" });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { authUserId: "auth-same" },
      data: { email: "member@example.com", name: "Member" },
    });
  });

  it("does not link an email collision to a different auth identity", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "test", meta: { modelName: "User", target: ["email"] } },
    ));
    mockDb.user.findFirst.mockResolvedValue(null);

    await expect(syncUser("auth-other", "member@example.com", "Member")).rejects.toMatchObject({ code: "P2002" });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("does not update or return a disabled account found after a create race", async () => {
    const disabledAt = new Date("2026-10-01T00:00:00.000Z");
    getAuthUser.mockResolvedValue({
      data: { user: { id: "auth-disabled", email: "member@example.com", user_metadata: { name: "Member" }, app_metadata: {} } },
    });
    mockDb.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-disabled", deletedAt: null, disabledAt })
      .mockResolvedValueOnce({ id: "user-disabled", deletedAt: null, disabledAt });
    mockDb.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`email`)",
      { code: "P2002", clientVersion: "test", meta: { modelName: "User", target: ["email"] } },
    ));

    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("requires a valid name before creating a newly authenticated profile", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    await expect(
      syncUser("auth-new", "new.user@example.com", "   "),
    ).rejects.toBeInstanceOf(ProfileNameRequiredError);

    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it("creates a new profile with a trimmed provider name", async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockResolvedValue({ id: "user-1" });

    await syncUser("auth-new", "new.user@example.com", "  New User  ");

    expect(mockDb.user.create).toHaveBeenCalledWith({
      data: {
        authUserId: "auth-new",
        email: "new.user@example.com",
        name: "New User",
        role: "USER",
      },
    });
  });

  it("preserves an existing user's name when provider metadata omits it", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "Existing User",
    });
    mockDb.user.update.mockResolvedValue({
      id: "user-1",
      name: "Existing User",
    });

    await syncUser("auth-existing", "existing.user@example.com");

    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { authUserId: "auth-existing" },
      data: { email: "existing.user@example.com" },
    });
  });

  it("accepts a standard OAuth name claim when creating the local profile", async () => {
    getAuthUser.mockResolvedValue({
      data: {
        user: {
          id: "oauth-auth-id",
          email: "oauth.user@example.com",
          user_metadata: { name: "OAuth Member" },
          app_metadata: {},
        },
      },
    });
    mockDb.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "user-oauth",
        name: "OAuth Member",
      });
    mockDb.user.create.mockResolvedValue({
      id: "user-oauth",
      name: "OAuth Member",
    });

    await getCurrentUser();

    expect(mockDb.user.create).toHaveBeenCalledWith({
      data: {
        authUserId: "oauth-auth-id",
        email: "oauth.user@example.com",
        name: "OAuth Member",
        role: "USER",
      },
    });
  });
});
