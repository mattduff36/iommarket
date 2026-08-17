import { describe, expect, it, vi } from "vitest";
import { isOnOrAfterLaunch } from "@/lib/costs/dates";
import { applyClassifiedCharge, CostLedgerError, ensureLedgerConfig } from "@/lib/costs/ledger";
import { planLedgerRevision } from "@/lib/costs/ledger-plan";

const existing = {
  revision: 1,
  checksum: "abc",
  invoiceability: "INVOICEABLE" as const,
  chargeEntryId: "entry_1",
  markedGbpMinor: 1200n,
  fxRateSnapshotId: "fx_1",
  nativeAmount: "10",
  nativeCurrency: "USD",
};

describe("COST-LEDGER-001 duplicate observations", () => {
  it("creates the first revision and skips identical later observations", () => {
    expect(planLedgerRevision(null, { checksum: "abc", invoiceability: "INVOICEABLE" })).toEqual({
      type: "create",
      revision: 1,
    });
    expect(
      planLedgerRevision(existing, { checksum: "abc", invoiceability: "INVOICEABLE" }),
    ).toEqual({ type: "skip" });
  });
});

describe("COST-LEDGER persist revisions", () => {
  it("creates a charge and later appends a reversal plus replacement", async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const entries: Array<Record<string, unknown>> = [];
    const client = {
      costSourceSnapshot: {
        findFirst: vi.fn(async () => {
          const latest = snapshots.at(-1);
          if (!latest) return null;
          return {
            ...latest,
            entries: entries.filter(
              (entry) =>
                entry.sourceSnapshotId === latest.id && entry.kind === "CHARGE",
            ),
          };
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { id: `snap_${snapshots.length + 1}`, ...data };
          snapshots.push(created);
          return created;
        }),
      },
      costEntry: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = { id: `entry_${entries.length + 1}`, ...data };
          entries.push(created);
          return created;
        }),
      },
    };

    const base = {
      sourceKind: "VERCEL_FOCUS" as const,
      bucketKey: "vercel:VERCEL_HOSTING:prj:compute:Usage:a:b",
      category: "VERCEL_HOSTING" as const,
      invoiceability: "INVOICEABLE" as const,
      nativeCurrency: "USD",
      rate: "1",
      fxRateSnapshotId: "fx_1",
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-02T00:00:00.000Z"),
      displayLabel: "Fluid Compute",
      startedAt: new Date("2026-09-01T00:00:00.000Z"),
    };

    await expect(
      applyClassifiedCharge(client as never, {
        ...base,
        checksum: "one",
        nativeAmount: "10",
      }),
    ).resolves.toBe("created");
    await expect(
      applyClassifiedCharge(client as never, {
        ...base,
        checksum: "one",
        nativeAmount: "10",
      }),
    ).resolves.toBe("skipped");
    await expect(
      applyClassifiedCharge(client as never, {
        ...base,
        checksum: "two",
        nativeAmount: "8",
      }),
    ).resolves.toBe("revised");

    expect(entries.map((entry) => [entry.kind, entry.markedGbpMinor])).toEqual([
      ["CHARGE", 1200n],
      ["REVERSAL", -1200n],
      ["CHARGE", 960n],
    ]);
  });
});

describe("COST-LEDGER-002 changed FOCUS buckets", () => {
  it("plans an exact reversal and replacement without mutation", () => {
    expect(
      planLedgerRevision(existing, { checksum: "def", invoiceability: "INVOICEABLE" }),
    ).toEqual({
      type: "reverse-replace",
      reverseEntryId: "entry_1",
      nextRevision: 2,
      originalMarkedGbpMinor: 1200n,
      originalFxRateSnapshotId: "fx_1",
      originalNativeAmount: "10",
      originalNativeCurrency: "USD",
    });
  });
});

describe("COST-LEDGER config drift", () => {
  it("fails closed when the persisted boundary does not match the environment", async () => {
    const previous = process.env.COST_LEDGER_STARTED_AT;
    process.env.COST_LEDGER_STARTED_AT = "2026-08-13T23:00:00.000Z";
    try {
      await expect(
        ensureLedgerConfig({
          costLedgerConfig: {
            findUnique: vi.fn().mockResolvedValue({
              id: "default",
              startedAt: new Date("2026-09-01T07:00:00.000Z"),
              policyVersion: "gbp-markup-v1",
            }),
            create: vi.fn(),
          },
        } as never),
      ).rejects.toBeInstanceOf(CostLedgerError);
    } finally {
      if (previous === undefined) delete process.env.COST_LEDGER_STARTED_AT;
      else process.env.COST_LEDGER_STARTED_AT = previous;
    }
  });
});

describe("COST-LAUNCH-001 launch boundary", () => {
  it("rejects costs before the immutable start timestamp", async () => {
    const startedAt = new Date("2026-09-01T00:00:00.000Z");
    expect(isOnOrAfterLaunch(new Date("2026-08-31T23:59:59.000Z"), startedAt)).toBe(false);
    expect(isOnOrAfterLaunch(new Date("2026-09-01T00:00:00.000Z"), startedAt)).toBe(true);

    await expect(
      applyClassifiedCharge(
        {
          costSourceSnapshot: { findFirst: vi.fn() },
          costEntry: { create: vi.fn() },
        } as never,
        {
          sourceKind: "MANUAL",
          bucketKey: "manual:CURSOR:ref-1",
          checksum: "abc",
          category: "CURSOR",
          invoiceability: "INVOICEABLE",
          nativeAmount: "10",
          nativeCurrency: "USD",
          rate: "1",
          fxRateSnapshotId: "fx_1",
          periodStart: new Date("2026-08-31T00:00:00.000Z"),
          periodEnd: new Date("2026-09-01T00:00:00.000Z"),
          displayLabel: "Cursor",
          startedAt,
        },
      ),
    ).rejects.toBeInstanceOf(CostLedgerError);
  });
});
