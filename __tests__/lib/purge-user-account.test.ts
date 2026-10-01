import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteUserMock, deleteImageMock } = vi.hoisted(() => ({
  deleteUserMock: vi.fn(),
  deleteImageMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { deleteUser: deleteUserMock } },
  }),
}));

vi.mock("@/lib/upload/cloudinary", () => ({
  deleteImage: deleteImageMock,
}));

import {
  deleteAuthUser,
  purgeUserAccountRecords,
  PurgeUserError,
} from "@/lib/privacy/purge-user-account";

const user = {
  email: "deleted.user@example.com",
  authUserId: "auth-1",
  avatarUrl: null,
  dealerProfile: { id: "dealer-1", logoUrl: null },
  listings: [{ id: "listing-1", images: [{ publicId: "photo-1" }] }],
  listingImageUploadIntents: [{ publicId: "intent-1" }],
};

function createTx(counts: Record<string, number> = {}) {
  const calls: string[] = [];
  const tx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined;
        if (prop === "$executeRaw") {
          return async () => {
            calls.push("$executeRaw");
            return 0;
          };
        }
        return new Proxy(
          {},
          {
            get(_model, method) {
              if (method === "then") return undefined;
              return async () => {
                calls.push(`${String(prop)}.${String(method)}`);
                if (prop === "user" && method === "findUnique") return user;
                if (method === "count") return counts[String(prop)] ?? 0;
                if (method === "findMany") return [];
                return { count: 1 };
              };
            },
          },
        );
      },
    },
  );
  return { tx, calls };
}

describe("purgeUserAccountRecords", () => {
  it("deletes the profile and its listings instead of keeping a deleted row", async () => {
    const { tx, calls } = createTx();

    const result = await purgeUserAccountRecords(tx as never, "user-1");

    expect(result.email).toBe(user.email);
    expect(result.listingIds).toEqual(["listing-1"]);
    expect(result.imagePublicIds).toEqual(["photo-1", "intent-1"]);
    expect(calls).toContain("user.delete");
    expect(calls).not.toContain("user.update");
    const listingDelete = calls.indexOf("listing.deleteMany");
    const profileDelete = calls.indexOf("user.delete");
    expect(listingDelete).toBeGreaterThan(calls.indexOf("payment.deleteMany"));
    expect(profileDelete).toBeGreaterThan(listingDelete);
  });

  it("refuses when the account owns records for other people", async () => {
    const { tx, calls } = createTx({ dealerPromotionCampaign: 1 });

    await expect(purgeUserAccountRecords(tx as never, "user-1")).rejects.toBeInstanceOf(
      PurgeUserError,
    );
    expect(calls).not.toContain("user.delete");
  });
});

describe("deleteAuthUser", () => {
  beforeEach(() => {
    deleteUserMock.mockReset();
    deleteImageMock.mockReset();
  });

  it("removes the Supabase login", async () => {
    deleteUserMock.mockResolvedValue({ error: null });

    await deleteAuthUser("auth-1");

    expect(deleteUserMock).toHaveBeenCalledWith("auth-1");
  });

  it("leaves the account unchanged when login removal fails", async () => {
    deleteUserMock.mockResolvedValue({ error: { message: "database unavailable" } });

    await expect(deleteAuthUser("auth-1")).rejects.toThrow(
      /left unchanged/,
    );
  });

  it("treats an already removed login as success", async () => {
    deleteUserMock.mockResolvedValue({ error: { message: "User not found" } });

    await expect(deleteAuthUser("auth-1")).resolves.toBeUndefined();
  });

  it("does not call Supabase for preview-system placeholder identities", async () => {
    await expect(
      deleteAuthUser("preview-system:rex-motor-company"),
    ).resolves.toBeUndefined();

    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});
