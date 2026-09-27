import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  applyClassifiedCharge,
  ensureLedgerConfig,
  getOrCreateIdentityGbpRate,
  listLatestBucketRevisions,
  runSerializable,
} = vi.hoisted(() => ({
  applyClassifiedCharge: vi.fn(),
  ensureLedgerConfig: vi.fn(),
  getOrCreateIdentityGbpRate: vi.fn(),
  listLatestBucketRevisions: vi.fn(),
  runSerializable: vi.fn(),
}));

vi.mock("@/lib/costs/db", () => ({
  costDb: {},
}));

vi.mock("@/lib/costs/ledger", () => ({
  applyClassifiedCharge,
  ensureLedgerConfig,
  listLatestBucketRevisions,
}));

vi.mock("@/lib/costs/fx", () => ({
  getOrCreateIdentityGbpRate,
}));

vi.mock("@/lib/costs/transaction", () => ({
  runSerializable,
}));

import {
  MEMBERSHIP_TRANSACTION_BATCH_SIZE,
  recordVercelMembershipShare,
} from "@/lib/costs/vercel-membership";

describe("Vercel membership ledger writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLatestBucketRevisions.mockResolvedValue(new Map());
    ensureLedgerConfig.mockResolvedValue({
      startedAt: new Date("2026-08-13T23:00:00.000Z"),
    });
    getOrCreateIdentityGbpRate.mockResolvedValue({
      id: "fx-gbp",
      rate: "1",
    });
    applyClassifiedCharge.mockResolvedValue("created");
    runSerializable.mockImplementation(
      async (callback: (tx: object) => Promise<void>) => callback({}),
    );
  });

  it("splits a historical backfill across bounded transactions", async () => {
    const result = await recordVercelMembershipShare({
      startedAt: new Date("2026-08-13T23:00:00.000Z"),
      now: new Date("2026-09-27T12:00:00.000Z"),
    });

    expect(result).toEqual({ written: 46, hasMore: false });
    expect(MEMBERSHIP_TRANSACTION_BATCH_SIZE).toBe(10);
    expect(runSerializable).toHaveBeenCalledTimes(5);
    expect(applyClassifiedCharge).toHaveBeenCalledTimes(46);
    expect(applyClassifiedCharge).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        bucketKey: "vercel:membership:2026-08-13",
        category: "VERCEL_HOSTING",
        nativeAmount: "0.38",
        markedGbpMinor: 38n,
      }),
    );
    expect(applyClassifiedCharge).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucketKey: "vercel:membership:2026-09-27",
        periodStart: new Date("2026-09-27T00:00:00.000Z"),
      }),
    );
  });
});
