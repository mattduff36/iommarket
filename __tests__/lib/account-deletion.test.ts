import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDeletionJob } from "@prisma/client";

const { mockDb, deleteUserMock, deleteImageMock } = vi.hoisted(() => ({
  mockDb: {
    retentionLegalHold: { findFirst: vi.fn() },
    accountDeletionJob: { updateMany: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    favourite: { deleteMany: vi.fn() },
    savedSearch: { deleteMany: vi.fn() },
    listingView: { updateMany: vi.fn() },
    dealerProfile: { update: vi.fn() },
    $transaction: vi.fn(),
  },
  deleteUserMock: vi.fn(),
  deleteImageMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/policy/flags", () => ({
  getPolicyFlags: () => ({ enableDeletionWorker: true }),
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
  anonymiseAccountAndComplete,
  canRestoreDeletedUser,
  processAccountDeletionJob,
} from "@/lib/privacy/account-deletion";

function leasedJob(overrides: Partial<AccountDeletionJob> = {}): AccountDeletionJob {
  return {
    id: "job-1",
    userId: "user-1",
    status: "PROCESSING",
    phase: "REQUESTED",
    attempts: 1,
    lastError: null,
    lockedAt: new Date(),
    leaseToken: "lease-owned",
    leaseExpiresAt: new Date(Date.now() + 60_000),
    nextAttemptAt: null,
    requestedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

describe("account deletion restore POL-PRIV-001", () => {
  it("allows restore when no deletion job exists", () => {
    expect(canRestoreDeletedUser(null)).toBe(true);
  });

  it("blocks restore after processing or completion", () => {
    expect(canRestoreDeletedUser({ status: "PROCESSING" })).toBe(false);
    expect(canRestoreDeletedUser({ status: "COMPLETED" })).toBe(false);
    expect(canRestoreDeletedUser({ status: "REQUESTED" })).toBe(true);
    expect(canRestoreDeletedUser({ status: "FAILED" })).toBe(true);
    expect(canRestoreDeletedUser({ status: "CANCELLED" })).toBe(true);
  });
});

describe("account deletion lease fencing POL-PRIV-001-A", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.retentionLegalHold.findFirst.mockResolvedValue(null);
    mockDb.$transaction.mockImplementation(
      async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb),
    );
    mockDb.favourite.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.listingView.updateMany.mockResolvedValue({ count: 0 });
    mockDb.user.update.mockResolvedValue({});
    deleteUserMock.mockResolvedValue({ error: null });
  });

  it("does not mutate account rows when the lease is no longer owned", async () => {
    mockDb.accountDeletionJob.updateMany.mockResolvedValue({ count: 0 });

    await expect(processAccountDeletionJob(leasedJob())).resolves.toEqual({
      status: "FAILED",
      reason: "Deletion lease is no longer owned.",
    });

    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(deleteUserMock).not.toHaveBeenCalled();
    expect(mockDb.accountDeletionJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          leaseToken: "lease-owned",
          status: "PROCESSING",
        }),
      }),
    );
  });
});

describe("account deletion atomic complete POL-PRIV-001-B", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.favourite.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.listingView.updateMany.mockResolvedValue({ count: 0 });
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-1",
      deletedAt: null,
      disabledAt: null,
      dealerProfile: null,
    });
    mockDb.user.update.mockResolvedValue({});
  });

  it("rolls back when the COMPLETED fence misses", async () => {
    mockDb.accountDeletionJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      anonymiseAccountAndComplete(mockDb as never, leasedJob()),
    ).rejects.toThrow("Deletion lease is no longer owned.");
  });

  it("completes only after a fenced COMPLETED write", async () => {
    mockDb.accountDeletionJob.updateMany.mockResolvedValue({ count: 1 });

    await anonymiseAccountAndComplete(mockDb as never, leasedJob());

    expect(mockDb.user.update).toHaveBeenCalled();
    expect(mockDb.accountDeletionJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "job-1",
          leaseToken: "lease-owned",
          status: "PROCESSING",
        }),
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("rolls back when anonymisation outlives the renewed lease POL-PRIV-001-B", async () => {
    vi.useFakeTimers();
    const renewNow = new Date("2026-08-15T00:00:00.000Z");
    vi.setSystemTime(renewNow);
    mockDb.user.update.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-08-15T00:06:00.000Z"));
      return {};
    });
    mockDb.accountDeletionJob.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { leaseExpiresAt?: { gt: Date } };
        data: { status?: string; leaseExpiresAt?: Date };
      }) => {
        if (data.status === "COMPLETED") {
          const fenceNow = where.leaseExpiresAt?.gt;
          const renewedExpiry = new Date(renewNow.getTime() + 5 * 60_000);
          return {
            count:
              fenceNow && renewedExpiry.getTime() > fenceNow.getTime() ? 1 : 0,
          };
        }
        return { count: 1 };
      },
    );

    try {
      await expect(
        anonymiseAccountAndComplete(mockDb as never, leasedJob(), renewNow),
      ).rejects.toThrow("Deletion lease is no longer owned.");
      expect(mockDb.user.update).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
