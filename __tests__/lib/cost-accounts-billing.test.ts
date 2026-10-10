import { describe, expect, it } from "vitest";
import { ACCOUNTS_PREVIEW_START } from "@/lib/costs/accounts-preview";
import { accountsBillingSchema, presentAccountsBilling } from "@/lib/costs/accounts-billing";
import { resolveAccountsOrigin } from "@/lib/costs/accounts-http";

const revision = "a".repeat(64);

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function line(id: string, day: string, amountMinor: number | null, held = false) {
  return {
    id: id.repeat(64),
    revision,
    category: "CURSOR" as const,
    label: "Development",
    periodStart: day,
    periodEnd: day,
    amountMinor: held ? null : amountMinor,
    currency: "GBP" as const,
    provisional: true as const,
    held,
    funding: "on-demand",
    events: 1,
    sourceCurrency: "USD",
    sourceUnits: held || amountMinor === null ? null : "1",
    fx: [],
  };
}

function historyBetween(
  start: string,
  end: string,
  last: { cost: number | null; invoiced: number; remaining: number | null },
  firstInvoiced = 0,
) {
  const points = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) {
    const isLast = day === end;
    points.push({
      day,
      costPence: isLast ? last.cost : null,
      invoicedPence: isLast ? last.invoiced : day === start ? firstInvoiced : 0,
      remainingToInvoicePence: isLast ? last.remaining : null,
    });
  }
  return points;
}

function billing(options: {
  asOf?: string;
  cost?: number | null;
  issued?: number;
  credit?: number;
  net?: number;
  remaining?: number | null;
  conflicts?: number;
  lines?: ReturnType<typeof line>[];
  history?: ReturnType<typeof historyBetween>;
  from?: string;
} = {}) {
  const asOf = options.asOf ?? "2026-10-10T12:00:00.000Z";
  const end = asOf.slice(0, 10);
  const cost = options.cost === undefined ? 50_737 : options.cost;
  const issued = options.issued ?? 95_000;
  const credit = options.credit ?? 0;
  const net = options.net ?? issued - credit;
  const conflicts = options.conflicts ?? 0;
  const remaining = options.remaining !== undefined
    ? options.remaining
    : conflicts > 0 || cost === null ? null : cost - net;
  const lines = options.lines ?? (typeof cost === "number" ? [line("b", "2026-10-09", cost)] : []);
  return {
    version: "mpdee-project-billing-v1",
    project: "itrader",
    currency: "GBP",
    allocationMode: "whole-invoice-ex-vat",
    balanceBasis: "costs-minus-invoices",
    asOf,
    revision,
    costSnapshot: {
      version: "mpdee-project-cost-snapshot-v2",
      project: "itrader",
      approvedSnapshot: false,
      asOf,
      revision,
      sourceUpdatedAt: "2026-10-10T11:00:00.000Z",
      coverage: {
        events: lines.reduce((total, item) => total + item.events, 0),
        held: lines.filter((item) => item.held).length,
        fxMissing: 0,
        from: options.from ?? ACCOUNTS_PREVIEW_START,
      },
      lines,
    },
    costTotalPence: cost,
    invoiceTotals: {
      issuedPence: issued,
      creditPence: credit,
      netInvoicedPence: net,
      invoiceCount: 3,
      creditCount: 0,
    },
    remainingToInvoicePence: remaining,
    coverage: {
      unlinkedInvoiceCount: 0,
      conflictingInvoiceCount: conflicts,
      costsPartial: true,
      costLedgerStart: ACCOUNTS_PREVIEW_START,
      invoicesBeforeCostLedger: 2,
    },
    history: options.history ?? historyBetween("2026-05-27", end, {
      cost,
      invoiced: net,
      remaining,
    }, 50_000),
  };
}

describe("Accounts billing contract", () => {
  it("accepts the current envelope, a pre-ledger invoice and a negative balance", () => {
    const parsed = accountsBillingSchema.parse(billing());
    const view = presentAccountsBilling(parsed);
    expect(view.costTotalPence).toBe(50_737);
    expect(view.invoicedPence).toBe(95_000);
    expect(view.remainingToInvoicePence).toBe(-44_263);
    expect(view.history[0]).toEqual({
      day: "2026-05-27",
      costPence: null,
      invoicedPence: 50_000,
      remainingToInvoicePence: null,
    });
    expect(view.history.at(-1)?.day).toBe("2026-10-10");
    expect(view.snapshot.coverage.events).toBe(1);
    expect(JSON.stringify(view.history)).not.toMatch(/fx|sourceUnits|pricing/);
  });

  it("keeps a true zero and an unknown cost distinct", () => {
    const zero = presentAccountsBilling(accountsBillingSchema.parse(billing({
      cost: 0,
      issued: 0,
      net: 0,
      lines: [],
      history: historyBetween("2026-10-10", "2026-10-10", { cost: 0, invoiced: 0, remaining: 0 }),
    })));
    expect(zero).toMatchObject({ costTotalPence: 0, invoicedPence: 0, remainingToInvoicePence: 0 });

    const unknown = presentAccountsBilling(accountsBillingSchema.parse(billing({
      cost: null,
      lines: [],
    })));
    expect(unknown).toMatchObject({
      costTotalPence: null,
      invoicedPence: 95_000,
      remainingToInvoicePence: null,
    });
    expect(unknown.history[0].invoicedPence).toBe(50_000);
  });

  it("hides the invoice total when links conflict and still rejects a non-null remaining", () => {
    const parsed = accountsBillingSchema.parse(billing({
      cost: 100,
      issued: 40,
      credit: 10,
      net: 30,
      conflicts: 1,
      lines: [line("c", "2026-10-09", 100)],
      history: historyBetween("2026-10-10", "2026-10-10", { cost: 100, invoiced: 30, remaining: null }),
    }));
    expect(presentAccountsBilling(parsed).invoicedPence).toBeNull();
    expect(presentAccountsBilling(parsed).remainingToInvoicePence).toBeNull();
    expect(presentAccountsBilling(parsed).costTotalPence).toBe(100);
    expect(accountsBillingSchema.safeParse(billing({
      cost: 100,
      issued: 40,
      net: 30,
      conflicts: 1,
      remaining: 70,
      lines: [line("c", "2026-10-09", 100)],
      history: historyBetween("2026-10-10", "2026-10-10", { cost: 100, invoiced: 30, remaining: 70 }),
    })).success).toBe(false);
  });

  it("rejects malformed, overflow and contradictory billing", () => {
    expect(accountsBillingSchema.safeParse(billing({ net: 1 })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({ remaining: 1 })).success).toBe(false);
    expect(accountsBillingSchema.safeParse({ ...billing(), project: "other" }).success).toBe(false);
    expect(accountsBillingSchema.safeParse({ ...billing(), currency: "USD" }).success).toBe(false);
    expect(accountsBillingSchema.safeParse({ ...billing(), version: "mpdee-project-billing-v0" }).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({ from: "2026-01-01T00:00:00.000Z" })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({
      cost: 10,
      issued: 0,
      net: 0,
      lines: [line("d", "2026-10-09", 11)],
      history: historyBetween("2026-10-10", "2026-10-10", { cost: 10, invoiced: 0, remaining: 10 }),
    })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({
      cost: null,
      lines: [],
      history: [
        { day: "2026-10-08", costPence: null, invoicedPence: 0, remainingToInvoicePence: null },
        { day: "2026-10-10", costPence: null, invoicedPence: 95_000, remainingToInvoicePence: null },
      ],
    })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({
      cost: null,
      lines: [],
      history: [{ day: "2026-02-31", costPence: null, invoicedPence: 0, remainingToInvoicePence: null }],
    })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({
      cost: Number.MAX_SAFE_INTEGER,
      issued: 0,
      net: 0,
      lines: [
        line("e", "2026-10-09", Number.MAX_SAFE_INTEGER),
        line("f", "2026-10-09", Number.MAX_SAFE_INTEGER),
      ],
    })).success).toBe(false);
    expect(accountsBillingSchema.safeParse(billing({
      issued: Number.MAX_SAFE_INTEGER,
      credit: -Number.MAX_SAFE_INTEGER,
      net: 0,
    })).success).toBe(false);
    const end = "2026-10-10";
    const start = shiftDay(end, -3661);
    expect(accountsBillingSchema.safeParse(billing({
      cost: null,
      issued: 0,
      net: 0,
      lines: [],
      history: historyBetween(start, end, { cost: null, invoiced: 0, remaining: null }),
    })).success).toBe(false);
  });
});

describe("Accounts origin guard", () => {
  it("allows only the development loopback and ignores overrides on deployed environments", () => {
    expect(resolveAccountsOrigin({ NODE_ENV: "development" })).toBe("https://accounts.mpdee.info");
    expect(resolveAccountsOrigin({
      NODE_ENV: "development",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000",
    })).toBe("http://127.0.0.1:4000");
    expect(resolveAccountsOrigin({
      NODE_ENV: "development",
      COST_ACCOUNTS_DEV_ORIGIN: "http://localhost:4000",
    })).toBeNull();
    expect(resolveAccountsOrigin({
      NODE_ENV: "development",
      VERCEL_ENV: "production",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000",
    })).toBe("https://accounts.mpdee.info");
    expect(resolveAccountsOrigin({
      NODE_ENV: "production",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000/extra",
    })).toBe("https://accounts.mpdee.info");
  });
});
