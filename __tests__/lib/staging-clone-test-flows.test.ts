import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDeletionJob } from "@prisma/client";

const {
  createClient,
  deleteUser,
  deleteImage,
  deleteKit,
  externalEffectBlocked,
  assertExternalEffectAllowed,
  fetchMock,
  mockDb,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteUser: vi.fn(),
  deleteImage: vi.fn(),
  deleteKit: vi.fn(),
  externalEffectBlocked: vi.fn(),
  assertExternalEffectAllowed: vi.fn(),
  fetchMock: vi.fn(),
  mockDb: {
    retentionLegalHold: { findFirst: vi.fn() },
    accountDeletionJob: { updateMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    favourite: { deleteMany: vi.fn() },
    savedSearch: { deleteMany: vi.fn() },
    listingView: { updateMany: vi.fn() },
    dealerProfile: { update: vi.fn() },
    dealerReviewResponse: { deleteMany: vi.fn() },
    dealerReviewDispute: { deleteMany: vi.fn() },
    listingImageCleanupJob: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/lib/upload/cloudinary", () => ({ deleteImage }));
vi.mock("@/lib/media/disposable-media", () => ({ deleteDisposableImageKitFile: deleteKit }));
vi.mock("@/lib/database-sync/effects", () => ({
  externalEffectBlocked,
  assertExternalEffectAllowed,
}));

import { StagingIdentityError } from "@/lib/deployment/staging-test-effects";
import { processAccountDeletionJob } from "@/lib/privacy/account-deletion";
import { deleteAccountMedia } from "@/lib/privacy/purge-user-account";
import { assertSampleTarget } from "@/lib/payments/sample-checkout";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const previewDb =
  "postgres://postgres.syneonzucehwlghqmfbg:test@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const otherDb =
  "postgres://postgres.notpreview:test@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const previewAuth = "https://syneonzucehwlghqmfbg.supabase.co";
const productionAuth = "https://snlqivvogfqesxpbjiei.supabase.co";
const REAL_SUBSCRIPTION = "This account has a real subscription. Use another preview account to test sample subscriptions.";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "ITRADER_DEPLOYMENT_ROLE",
  "ITRADER_LOCAL_STAGING_FEATURES",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const verified: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  ITRADER_DEPLOYMENT_ROLE: "staging",
  NEXT_PUBLIC_APP_URL: "https://itrader.dev",
  NEXT_PUBLIC_SUPABASE_URL: previewAuth,
  POSTGRES_URL: previewDb,
  POSTGRES_URL_NON_POOLING: previewDb,
  DATABASE_URL: previewDb,
  SUPABASE_SERVICE_ROLE_KEY: "preview-role",
};

const production: Record<string, string> = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  ITRADER_DEPLOYMENT_ROLE: "production",
  NEXT_PUBLIC_APP_URL: "https://itrader.im",
  NEXT_PUBLIC_SUPABASE_URL: productionAuth,
  POSTGRES_URL: otherDb,
  POSTGRES_URL_NON_POOLING: otherDb,
  DATABASE_URL: otherDb,
  SUPABASE_SERVICE_ROLE_KEY: "production-role",
};

function applyEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (!value) delete process.env[key];
    else vi.stubEnv(key, value);
  }
}

function leasedJob(): AccountDeletionJob {
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
  };
}

function clonedUser(avatarUrl: string | null) {
  return {
    id: "user-1",
    authUserId: "auth-user-1",
    avatarUrl,
    dealerProfile: null,
    deletedAt: null,
    disabledAt: null,
  };
}

function subscriptionTx() {
  return {
    $queryRaw: vi.fn(async () => []),
    dealerProfile: { findFirst: vi.fn(async () => ({ id: "dealer-1", userId: "user-1" })) },
    subscription: { findFirst: vi.fn() },
    listing: { findFirst: vi.fn() },
  };
}

function isActiveSample(where: { paymentProvider?: unknown }) {
  return where.paymentProvider === "DEV";
}

beforeEach(() => {
  createClient.mockReset().mockImplementation(() => ({ auth: { admin: { deleteUser } } }));
  deleteUser.mockReset().mockResolvedValue({ error: null });
  deleteImage.mockReset().mockResolvedValue(undefined);
  deleteKit.mockReset().mockResolvedValue(undefined);
  externalEffectBlocked.mockReset().mockResolvedValue(false);
  assertExternalEffectAllowed.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset();
  mockDb.retentionLegalHold.findFirst.mockReset().mockResolvedValue(null);
  mockDb.accountDeletionJob.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockDb.user.findUnique.mockReset();
  mockDb.user.update.mockReset().mockResolvedValue({});
  mockDb.favourite.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.savedSearch.deleteMany.mockResolvedValue({ count: 0 });
  mockDb.listingView.updateMany.mockResolvedValue({ count: 0 });
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) => callback(mockDb));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("staging clone test flows", () => {
  it("does not reuse a cached production admin client for an unverified preview", async () => {
    applyEnv(production);
    const prod = createSupabaseAdminClient();
    const created = createClient.mock.calls.length;

    applyEnv({ ...production, VERCEL_ENV: "preview", ITRADER_DEPLOYMENT_ROLE: "staging" });
    expect(() => createSupabaseAdminClient()).toThrow(StagingIdentityError);
    expect(createClient).toHaveBeenCalledTimes(created);
    await expect(processAccountDeletionJob(leasedJob())).rejects.toBeInstanceOf(StagingIdentityError);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(assertExternalEffectAllowed).not.toHaveBeenCalled();

    applyEnv({ ...verified, SUPABASE_SERVICE_ROLE_KEY: "preview-role-cache" });
    const preview = createSupabaseAdminClient();
    expect(preview).not.toBe(prod);
    expect(createClient).toHaveBeenLastCalledWith(
      previewAuth,
      "preview-role-cache",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes local anonymisation for a cloned staging account and deletes auth on the preview project", async () => {
    applyEnv({ ...verified, SUPABASE_SERVICE_ROLE_KEY: "preview-role-complete" });
    externalEffectBlocked.mockResolvedValue(true);
    mockDb.user.findUnique.mockResolvedValue(
      clonedUser("https://res.cloudinary.com/demo/image/upload/folder/photo.jpg"),
    );

    await expect(processAccountDeletionJob(leasedJob())).resolves.toEqual({ status: "COMPLETED" });

    expect(assertExternalEffectAllowed).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("auth-user-1");
    expect(createClient).toHaveBeenCalledWith(
      previewAuth,
      "preview-role-complete",
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    expect(deleteImage).not.toHaveBeenCalled();
    expect(mockDb.user.update).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still honours a legal hold and the deletion lease on verified staging", async () => {
    applyEnv({ ...verified, SUPABASE_SERVICE_ROLE_KEY: "preview-role-hold" });
    mockDb.retentionLegalHold.findFirst.mockResolvedValue({ id: "hold-1" });
    await expect(processAccountDeletionJob(leasedJob())).resolves.toEqual({
      status: "FAILED",
      reason: "LEGAL_HOLD",
    });
    expect(deleteUser).not.toHaveBeenCalled();

    mockDb.retentionLegalHold.findFirst.mockResolvedValue(null);
    mockDb.accountDeletionJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(processAccountDeletionJob(leasedJob())).resolves.toEqual({
      status: "FAILED",
      reason: "Deletion lease is no longer owned.",
    });
    expect(mockDb.user.findUnique).not.toHaveBeenCalled();
  });

  it("still deletes a staging-owned profile image and blocks cloned deletion in production", async () => {
    applyEnv({ ...verified, SUPABASE_SERVICE_ROLE_KEY: "preview-role-owned" });
    externalEffectBlocked.mockResolvedValue(false);
    mockDb.user.findUnique.mockResolvedValue(
      clonedUser("https://res.cloudinary.com/demo/image/upload/folder/photo.jpg"),
    );
    await expect(processAccountDeletionJob(leasedJob())).resolves.toEqual({ status: "COMPLETED" });
    expect(deleteImage).toHaveBeenCalledWith("folder/photo");

    applyEnv(production);
    deleteImage.mockClear();
    deleteUser.mockClear();
    assertExternalEffectAllowed.mockRejectedValue(new Error("Cloned production records cannot trigger external effects from staging."));
    await expect(processAccountDeletionJob(leasedJob())).rejects.toThrow(/Cloned production records/);
    expect(assertExternalEffectAllowed).toHaveBeenCalledWith({
      tables: [{ table: "User", rowKey: "user-1" }],
    });
    expect(deleteImage).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("skips proven cloned media, stops on lookup failure, and keeps staging ownership guards", async () => {
    externalEffectBlocked.mockImplementation(async (input: { mediaIds?: string[] }) => {
      const ids = input.mediaIds ?? [];
      if (ids.includes("unknown-public") || ids.includes("unknown-file")) throw new Error("lookup failed");
      return ids.includes("cloned-public") || ids.includes("cloned-file");
    });

    const result = await deleteAccountMedia(
      ["cloned-public", "unknown-public", "owned-public"],
      [
        { fileId: "cloned-file", filePath: "/iommarket-migration/copied.jpg" },
        { fileId: "owned-protected", filePath: "/iommarket-migration/local.jpg" },
        { fileId: "owned-disposable", filePath: "/iommarket-dev-disposable/local.jpg" },
      ],
    );

    expect(deleteImage).toHaveBeenCalledTimes(1);
    expect(deleteImage).toHaveBeenCalledWith("owned-public");
    expect(deleteKit).toHaveBeenCalledTimes(1);
    expect(deleteKit).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "owned-disposable",
      filePath: "/iommarket-dev-disposable/local.jpg",
    }));
    expect(result.failedPublicIds).toEqual(["unknown-public", "owned-protected"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a copied production subscription and still blocks a genuine preview subscription", async () => {
    applyEnv(verified);
    const tx = subscriptionTx();
    const realRows = [{ id: "cloned-sub" }, { id: "live-weekly" }];
    tx.subscription.findFirst.mockImplementation(async (args: { where: { paymentProvider?: unknown } }) => {
      if (isActiveSample(args.where)) return null;
      return realRows.shift() ?? null;
    });
    externalEffectBlocked.mockImplementation(async (
      input: { tables?: Array<{ table: string; rowKey: string }> },
      runQuery?: (sql: unknown) => Promise<unknown>,
    ) => {
      if (runQuery) await runQuery("same-transaction");
      return input.tables?.[0]?.rowKey === "cloned-sub";
    });

    await expect(assertSampleTarget(tx as never, {
      kind: "dealer_subscription",
      targetId: "dealer-1",
      userId: "user-1",
    })).rejects.toThrow(REAL_SUBSCRIPTION);
    expect(tx.$queryRaw).toHaveBeenCalledWith("same-transaction");
    expect(externalEffectBlocked).toHaveBeenCalledWith(
      { tables: [{ table: "Subscription", rowKey: "live-weekly" }] },
      expect.any(Function),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only copied production subscriptions on verified staging", async () => {
    applyEnv(verified);
    const tx = subscriptionTx();
    let realReads = 0;
    tx.subscription.findFirst.mockImplementation(async (args: { where: { paymentProvider?: unknown } }) => {
      if (isActiveSample(args.where)) return null;
      realReads += 1;
      return realReads === 1 ? { id: "cloned-sub" } : null;
    });
    externalEffectBlocked.mockImplementation(async (
      _input: unknown,
      runQuery?: (sql: unknown) => Promise<unknown>,
    ) => {
      if (runQuery) await runQuery("same-transaction");
      return true;
    });

    await expect(assertSampleTarget(tx as never, {
      kind: "dealer_subscription",
      targetId: "dealer-1",
      userId: "user-1",
    })).resolves.toBeUndefined();
    expect(tx.$queryRaw).toHaveBeenCalledWith("same-transaction");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the production subscription gate and does not ignore rows on an unverified preview", async () => {
    applyEnv(production);
    const productionTx = subscriptionTx();
    productionTx.subscription.findFirst.mockResolvedValueOnce({ id: "real-sub" });
    await expect(assertSampleTarget(productionTx as never, {
      kind: "dealer_subscription",
      targetId: "dealer-1",
      userId: "user-1",
    })).rejects.toThrow(REAL_SUBSCRIPTION);
    expect(productionTx.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(externalEffectBlocked).not.toHaveBeenCalled();

    applyEnv({ ...verified, NEXT_PUBLIC_SUPABASE_URL: productionAuth });
    const previewTx = subscriptionTx();
    previewTx.subscription.findFirst.mockResolvedValueOnce({ id: "cloned-sub" });
    await expect(assertSampleTarget(previewTx as never, {
      kind: "dealer_subscription",
      targetId: "dealer-1",
      userId: "user-1",
    })).rejects.toThrow(REAL_SUBSCRIPTION);
    expect(previewTx.subscription.findFirst).toHaveBeenCalledTimes(1);
    expect(externalEffectBlocked).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
