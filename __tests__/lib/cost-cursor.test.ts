import { describe, expect, it } from "vitest";
import { CostConfigError } from "@/lib/costs/config";
import {
  CursorUsageError,
  allocateProjectShareUsdMinor,
  daysInUtcMonth,
  getCursorSubscriptionUsdMinor,
  parseCursorUsageLog,
  planCursorCharges,
  subscriptionSliceUsdMinor,
  type CursorUsageLog,
} from "@/lib/costs/cursor";

const MONTHLY = BigInt(20_000);
const STARTED_AT = new Date("2026-08-13T23:00:00.000Z");

function day(overrides: {
  date: string;
  identified: string;
  project: string;
  tokens?: number;
}) {
  const tokens = overrides.tokens ?? 1_000_000;
  return {
    date: overrides.date,
    identifiedMicroCents: overrides.identified,
    project: {
      onDemandMicroCents: overrides.project,
      chargedMicroCents: "0",
      inputTokens: tokens,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      models: [],
    },
  };
}

function log(days: ReturnType<typeof day>[]): CursorUsageLog {
  return parseCursorUsageLog({
    version: 1,
    generatedAt: "2026-08-17T12:00:00.000Z",
    projectKey: "d-Websites-iommarket",
    attributionCoverage: {
      attributedEvents: 10,
      unattributedEvents: 2,
      unattributedMicroCents: "5000",
    },
    days,
  });
}

describe("Cursor subscription allocation", () => {
  it("splits a month into daily slices that sum to exactly the subscription", () => {
    const daysInMonth = daysInUtcMonth(2026, 8);
    expect(daysInMonth).toBe(31);
    let total = BigInt(0);
    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
      total += subscriptionSliceUsdMinor({
        monthlyUsdMinor: MONTHLY,
        dayOfMonth,
        daysInMonth,
      });
    }
    expect(total).toBe(MONTHLY);
  });

  it("handles February in a leap year without losing or inventing money", () => {
    const daysInMonth = daysInUtcMonth(2028, 2);
    expect(daysInMonth).toBe(29);
    let total = BigInt(0);
    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth += 1) {
      total += subscriptionSliceUsdMinor({ monthlyUsdMinor: MONTHLY, dayOfMonth, daysInMonth });
    }
    expect(total).toBe(MONTHLY);
  });

  it("rejects a day outside the month", () => {
    expect(() =>
      subscriptionSliceUsdMinor({ monthlyUsdMinor: MONTHLY, dayOfMonth: 32, daysInMonth: 31 }),
    ).toThrow(CursorUsageError);
  });

  it("allocates proportionally and never above the day's own slice", () => {
    expect(
      allocateProjectShareUsdMinor({
        sliceUsdMinor: BigInt(645),
        projectMicroCents: BigInt(75),
        identifiedMicroCents: BigInt(100),
      }),
    ).toBe(BigInt(483));
    expect(
      allocateProjectShareUsdMinor({
        sliceUsdMinor: BigInt(645),
        projectMicroCents: BigInt(500),
        identifiedMicroCents: BigInt(100),
      }),
    ).toBe(BigInt(645));
    expect(
      allocateProjectShareUsdMinor({
        sliceUsdMinor: BigInt(645),
        projectMicroCents: BigInt(1),
        identifiedMicroCents: BigInt(0),
      }),
    ).toBe(BigInt(0));
  });
});

describe("Cursor usage log validation", () => {
  it("rejects a project share larger than identified usage", () => {
    expect(() =>
      log([day({ date: "2026-08-14", identified: "100", project: "200" })]),
    ).toThrow(CursorUsageError);
  });

  it("rejects duplicate days", () => {
    expect(() =>
      log([
        day({ date: "2026-08-14", identified: "100", project: "50" }),
        day({ date: "2026-08-14", identified: "100", project: "50" }),
      ]),
    ).toThrow(CursorUsageError);
  });

  it("rejects an impossible calendar date", () => {
    expect(() => log([day({ date: "2026-02-30", identified: "100", project: "50" })])).toThrow(
      CursorUsageError,
    );
  });

  it("rejects non-integer micro cents", () => {
    expect(() =>
      log([day({ date: "2026-08-14", identified: "10.5", project: "5" })]),
    ).toThrow(CursorUsageError);
  });

  it("rejects an unknown log version", () => {
    expect(() =>
      parseCursorUsageLog({ version: 2, generatedAt: "x", projectKey: "y", days: [] }),
    ).toThrow(CursorUsageError);
  });
});

describe("Cursor charge planning", () => {
  const now = new Date("2026-08-17T10:00:00.000Z");

  it("creates one invoiceable charge per completed day with usage", () => {
    const charges = planCursorCharges({
      log: log([
        day({ date: "2026-08-14", identified: "1000", project: "800", tokens: 4_600_000 }),
        day({ date: "2026-08-15", identified: "1000", project: "1000" }),
      ]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });

    expect(charges).toHaveLength(2);
    expect(charges[0].bucketKey).toBe("cursor:subscription:2026-08-14");
    expect(charges[0].nativeCurrency).toBe("USD");
    expect(charges[0].nativeAmount).toBe("5.16");
    expect(charges[0].displayLabel).toBe("Cursor 14 Aug 2026 - 4.6M tokens, 80.0% of tracked usage");
    expect(charges[1].nativeAmount).toBe("6.45");
    expect(charges[0].periodStart.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(charges[0].periodEnd.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });

  it("excludes days before the ledger boundary", () => {
    const charges = planCursorCharges({
      log: log([day({ date: "2026-08-12", identified: "1000", project: "1000" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    expect(charges).toHaveLength(0);
  });

  it("excludes the current incomplete day so entries are never revised", () => {
    const charges = planCursorCharges({
      log: log([day({ date: "2026-08-17", identified: "1000", project: "1000" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    expect(charges).toHaveLength(0);
  });

  it("skips days with no identified or no project usage", () => {
    const charges = planCursorCharges({
      log: log([
        day({ date: "2026-08-14", identified: "0", project: "0" }),
        day({ date: "2026-08-15", identified: "1000", project: "0" }),
      ]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    expect(charges).toHaveLength(0);
  });

  it("produces a stable checksum for unchanged input and a new one when usage changes", () => {
    const first = planCursorCharges({
      log: log([day({ date: "2026-08-14", identified: "1000", project: "800" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    const repeat = planCursorCharges({
      log: log([day({ date: "2026-08-14", identified: "1000", project: "800" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    const changed = planCursorCharges({
      log: log([day({ date: "2026-08-14", identified: "1000", project: "900" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });

    expect(first[0].checksum).toBe(repeat[0].checksum);
    expect(changed[0].checksum).not.toBe(first[0].checksum);
  });

  it("never exposes native rates, tokens per model, or credentials in the label", () => {
    const charges = planCursorCharges({
      log: log([day({ date: "2026-08-14", identified: "1000", project: "800" })]),
      startedAt: STARTED_AT,
      now,
      monthlyUsdMinor: MONTHLY,
    });
    expect(charges[0].displayLabel).not.toMatch(/token=|cookie|Bearer|\$/i);
  });
});

describe("Cursor subscription configuration", () => {
  it("treats an absent value as the feature being off", () => {
    expect(getCursorSubscriptionUsdMinor({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("accepts whole minor units", () => {
    expect(
      getCursorSubscriptionUsdMinor({
        COST_CURSOR_SUBSCRIPTION_USD_MINOR: "20000",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(BigInt(20_000));
  });

  it("rejects decimals, negatives, and zero", () => {
    for (const value of ["200.00", "-1", "0", "20 000"]) {
      expect(() =>
        getCursorSubscriptionUsdMinor({
          COST_CURSOR_SUBSCRIPTION_USD_MINOR: value,
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(CostConfigError);
    }
  });
});
