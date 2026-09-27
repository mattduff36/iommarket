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

    expect(result).toEqual({ written: 45, hasMore: false });
    expect(MEMBERSHIP_TRANSACTION_BATCH_SIZE).toBe(1);
    expect(runSerializable).toHaveBeenCalledTimes(45);
    expect(applyClassifiedCharge).toHaveBeenCalledTimes(45);
    expect(applyClassifiedCharge).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        bucketKey: "vercel:membership:2026-08-14",
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

  it("retires the legacy partial UTC-day charge when it exists", async () => {
    listLatestBucketRevisions.mockResolvedValue(new Map([
      ["vercel:membership:2026-08-13", {
        revision: 1,
        checksum: "legacy-checksum",
        invoiceability: "INVOICEABLE",
        chargeEntryId: "legacy-charge",
        markedGbpMinor: 38n,
        fxRateSnapshotId: "fx-gbp",
        nativeAmount: "0.38",
        nativeCurrency: "GBP",
      }],
    ]));

    await recordVercelMembershipShare({
      startedAt: new Date("2026-08-13T23:00:00.000Z"),
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    expect(applyClassifiedCharge).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        bucketKey: "vercel:membership:2026-08-13",
        nativeAmount: "0",
        markedGbpMinor: 0n,
      }),
    );
    expect(applyClassifiedCharge).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        bucketKey: "vercel:membership:2026-08-14",
        nativeAmount: "0.38",
        markedGbpMinor: 38n,
      }),
    );
  });
});
