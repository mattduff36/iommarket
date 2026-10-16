import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_PREVIEW_START } from "@/lib/costs/accounts-preview";
import * as accountsPreview from "@/lib/costs/accounts-preview";
import * as accountsSnapshot from "@/lib/costs/accounts-snapshot";
import {
  ACCOUNTS_PROJECT_BILLING_URL,
  ACCOUNTS_PROJECT_SUMMARY_URL,
  accountsProjectSummarySchema,
  fetchAccountsCostDashboard,
  fetchAccountsProjectSummary,
} from "@/lib/costs/accounts-reader";
import { resolveLedgerAccess } from "@/lib/costs/ledger-access";

const TOKEN = "a".repeat(32);
const revision = "b".repeat(64);

function summary(overrides: Record<string, unknown> = {}) {
  return {
    version: "mpdee-project-cost-summary-v1",
    project: "itrader",
    source: "mpdee-accounts",
    pricingRuleVersion: "accounts-pricing-2026-10",
    ledgerStart: "2026-08-13T23:00:00.000Z",
    asOf: "2026-10-10T12:00:00.000Z",
    sourceUpdatedAt: "2026-10-10T11:00:00.000Z",
    revision,
    approvedSnapshot: false,
    currency: "GBP",
    estimate: {
      totalPence: 47056,
      includedPence: 20915,
      onDemandPence: 26141,
      infrastructurePence: null,
      partial: true,
      fxEstimated: true,
      fxMissingRows: 2,
    },
    coverage: {
      firstEventAt: "2026-08-14T00:00:00.000Z",
      lastEventAt: "2026-10-09T00:00:00.000Z",
      includedRows: 12,
      onDemandRows: 4,
      infrastructureRows: 0,
      infrastructureStatus: "absent",
      exclusions: [{ key: "shared-hosting", label: "Shared hosting", rows: 3, reason: "Not imported" }],
    },
    outstanding: { pence: null, reason: "No approved outstanding amount" },
    pricing: ["Included usage uses the Accounts included rate."],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json", ...extraHeaders } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Accounts project summary reader", () => {
  it("passes exact safe pence through and keeps null, zero and negative distinct", async () => {
    const payload = summary({
      estimate: {
        totalPence: 47056,
        includedPence: 0,
        onDemandPence: -250,
        infrastructurePence: null,
        partial: false,
        fxEstimated: false,
        fxMissingRows: 0,
      },
      outstanding: { pence: 0, reason: null },
    });
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const parsed = await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN });

    expect(parsed).toEqual(payload);
    expect(accountsProjectSummarySchema.parse(payload).estimate.onDemandPence).toBe(-250);
    expect(accountsProjectSummarySchema.safeParse(summary({
      estimate: { ...payload.estimate, totalPence: 1.5 },
    })).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(ACCOUNTS_PROJECT_SUMMARY_URL, expect.objectContaining({
      cache: "no-store",
      redirect: "error",
      headers: { authorization: `Bearer ${TOKEN}` },
    }));
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(ACCOUNTS_PROJECT_SUMMARY_URL).toBe("https://accounts.mpdee.info/api/costs/projects/itrader/summary");
  });

  it("rejects a missing token without calling Accounts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: "short-token" });
    expect(result).toEqual({ available: false, reason: "Accounts project read access is not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe error for non-200, invalid JSON, the wrong project and an oversized body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("nope", 503)));
    expect(await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({
      available: false,
      reason: "The Accounts project summary is unavailable.",
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("{")));
    expect(await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({
      available: false,
      reason: "The Accounts project summary was not valid JSON.",
    });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(summary({ project: "other" }))));
    const mismatch = await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(mismatch).toEqual({
      available: false,
      reason: "The Accounts project summary did not match the expected contract.",
    });
    expect(mismatch).not.toHaveProperty("estimate");

    const getReader = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === "content-length" ? String(1_048_577) : null) },
      body: { cancel: vi.fn(), getReader },
    })));
    expect(await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({
      available: false,
      reason: "The Accounts project summary is too large.",
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it("rejects a stream that exceeds 1 MB and does not fall back when the request throws", async () => {
    const chunk = new Uint8Array(600_000);
    let reads = 0;
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            if (reads > 2) return { done: true, value: undefined };
            return { done: false, value: chunk };
          },
          cancel,
          releaseLock: vi.fn(),
        }),
      },
    })));
    const oversized = await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(oversized).toEqual({ available: false, reason: "The Accounts project summary is too large." });
    expect(cancel).toHaveBeenCalled();
    expect(oversized).not.toHaveProperty("estimate");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("redirect denied for bearer secret");
    }));
    const failed = await fetchAccountsProjectSummary({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(failed).toEqual({ available: false, reason: "The Accounts project summary could not be read." });
    expect(JSON.stringify(failed)).not.toMatch(/secret|bearer|pence/i);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not call Accounts when a development origin override is not the local loopback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchAccountsProjectSummary({
      NODE_ENV: "development",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000/summary",
      COST_ACCOUNTS_READ_TOKEN: TOKEN,
    });
    expect(result).toEqual({ available: false, reason: "The Accounts project summary is unavailable." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks legacy ledger access for the accounts reader and leaves canonical and remote roles unchanged", () => {
    expect(resolveLedgerAccess({
      COST_LEDGER_ROLE: "accounts-reader",
      COST_LEDGER_ORIGIN: "https://itrader.im",
      COST_LEDGER_DATABASE_URL: "postgres://example",
    })).toEqual({
      mode: "unavailable",
      reason: "Accounts manages costs. This deployment is read-only.",
    });
    const spacedRole = resolveLedgerAccess({ COST_LEDGER_ROLE: "accounts-reader " });
    expect(spacedRole.mode).toBe("unavailable");
    expect(spacedRole.mode === "unavailable" ? spacedRole.reason : "").not.toBe(
      "Accounts manages costs. This deployment is read-only.",
    );
    expect(resolveLedgerAccess({ COST_LEDGER_ROLE: "canonical" })).toEqual({ mode: "local" });
    expect(resolveLedgerAccess({
      COST_LEDGER_ROLE: "reader",
      COST_LEDGER_ORIGIN: "https://itrader.im/",
    })).toEqual({ mode: "remote", origin: "https://itrader.im" });
    expect(resolveLedgerAccess({ COST_LEDGER_ROLE: "accounts-preview" })).toEqual({
      mode: "unavailable",
      reason: "Accounts preview isolation could not be verified.",
    });
  });
});

function hex(char: string) {
  return char.repeat(64);
}

function envelope(options: {
  asOf?: string;
  cost?: number | null;
  issued?: number;
  credit?: number;
  net?: number;
  remaining?: number | null;
  conflicts?: number;
  lines?: Array<Record<string, unknown>>;
  history?: Array<Record<string, unknown>>;
  historyStart?: string;
  firstInvoiced?: number;
  sourceUpdatedAt?: string | null;
} = {}) {
  const asOf = options.asOf ?? new Date().toISOString();
  const cost = options.cost === undefined ? 50_737 : options.cost;
  const issued = options.issued ?? 95_000;
  const credit = options.credit ?? 0;
  const net = options.net ?? issued - credit;
  const conflicts = options.conflicts ?? 0;
  const remaining = options.remaining !== undefined
    ? options.remaining
    : conflicts > 0 || cost === null ? null : cost - net;
  const day = asOf.slice(0, 10);
  const lines = options.lines ?? (cost === null ? [] : [snapshotLine("a", day, { amountMinor: cost })]);
  return {
    version: "mpdee-project-billing-v1",
    project: "itrader",
    currency: "GBP",
    allocationMode: "whole-invoice-ex-vat",
    balanceBasis: "costs-minus-invoices",
    asOf,
    revision: hex("b"),
    costSnapshot: projectSnapshot(lines, asOf, options.sourceUpdatedAt ?? null),
    costTotalPence: cost,
    invoiceTotals: {
      issuedPence: issued,
      creditPence: credit,
      netInvoicedPence: net,
      invoiceCount: 3,
      creditCount: credit === 0 ? 0 : 1,
    },
    remainingToInvoicePence: remaining,
    coverage: {
      unlinkedInvoiceCount: 0,
      conflictingInvoiceCount: conflicts,
      costsPartial: true,
      costLedgerStart: ACCOUNTS_PREVIEW_START,
      invoicesBeforeCostLedger: 2,
    },
    history: options.history ?? denseHistory(options.historyStart ?? "2026-05-27", asOf, {
      cost,
      invoiced: net,
      remaining,
    }, options.firstInvoiced ?? 50_000),
  };
}

function denseHistory(
  start: string,
  asOf: string,
  last: { cost: number | null; invoiced: number; remaining: number | null },
  firstInvoiced: number,
) {
  const end = asOf.slice(0, 10);
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

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function snapshotLine(char: string, day: string, overrides: Record<string, unknown> = {}) {
  return {
    id: hex(char),
    revision: hex("e"),
    category: "CURSOR",
    label: "Development",
    periodStart: day,
    periodEnd: day,
    amountMinor: 100,
    currency: "GBP",
    provisional: true,
    held: false,
    funding: "on-demand",
    events: 1,
    sourceCurrency: "USD",
    sourceUnits: "3",
    fx: [{ currency: "USD", date: day, rate: "0.75", source: "ecb" }],
    ...overrides,
  };
}

function projectSnapshot(lines: Array<Record<string, unknown>>, asOf: string, sourceUpdatedAt: string | null = null) {
  const events = lines.reduce((total, line) => total + Number(line.events), 0);
  return {
    version: "mpdee-project-cost-snapshot-v2",
    project: "itrader",
    approvedSnapshot: false,
    asOf,
    revision: hex("c"),
    sourceUpdatedAt,
    coverage: { events, held: lines.filter((line) => line.held).length, fxMissing: 0, from: ACCOUNTS_PREVIEW_START },
    lines,
  };
}

describe("Accounts cost dashboard reader", () => {
  it("reads one billing envelope and keeps supplied pence, nulls and chart lines", async () => {
    const asOf = new Date().toISOString();
    const recentDay = asOf.slice(0, 10);
    expect(recentDay > "2026-08-13").toBe(true);
    const lines = [
      snapshotLine("a", recentDay, { amountMinor: 10_000, label: "Recent development" }),
      snapshotLine("b", recentDay, { category: "VERCEL_HOSTING", amountMinor: -250, label: "Hosting credit" }),
      snapshotLine("c", recentDay, { category: "OTHER", amountMinor: 0, label: "Zero adjustment", sourceUnits: "0" }),
      snapshotLine("d", "2026-08-13", { amountMinor: 500, label: "Opening day" }),
      snapshotLine("f", recentDay, { category: "DATABASE", amountMinor: null, sourceUnits: null, held: true, label: "Held row" }),
    ];
    const payload = envelope({ asOf, cost: 10_250, lines, sourceUpdatedAt: asOf, firstInvoiced: 50_000 });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === ACCOUNTS_PROJECT_BILLING_URL) return jsonResponse(payload);
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const snapshotFetch = vi.spyOn(accountsSnapshot, "fetchAccountsSnapshot");
    const baselineFetch = vi.spyOn(accountsSnapshot, "fetchAccountsBaseline");
    const previewGuard = vi.spyOn(accountsPreview, "assertAccountsPreview");

    const result = await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN });

    expect(ACCOUNTS_PROJECT_BILLING_URL).toBe("https://accounts.mpdee.info/api/costs/projects/itrader/billing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.costTotalPence).toBe(10_250);
    expect(result.invoicedPence).toBe(95_000);
    expect(result.remainingToInvoicePence).toBe(10_250 - 95_000);
    expect(result.history[0]).toEqual({
      day: "2026-05-27",
      costPence: null,
      invoicedPence: 50_000,
      remainingToInvoicePence: null,
    });
    expect(result.history.at(-1)).toEqual({
      day: recentDay,
      costPence: 10_250,
      invoicedPence: 95_000,
      remainingToInvoicePence: 10_250 - 95_000,
    });
    expect(result.sourceUpdatedAt).toBe(asOf);
    expect(result.chartAvailable).toBe(true);
    const mapped = result.sections.flatMap((section) => section.lines);
    expect(mapped.map((line) => line.amountMinor).sort((left, right) => left - right)).toEqual([-250, 0, 500, 10_000]);
    expect(mapped.every((line) => line.kind === "CHARGE" && line.invoiceability === "PROVISIONAL" && line.provisional)).toBe(true);
    const opening = mapped.find((line) => line.id === hex("d"));
    const recent = mapped.find((line) => line.id === hex("a"));
    expect(opening).toMatchObject({
      periodStart: ACCOUNTS_PREVIEW_START,
      periodEnd: "2026-08-14T00:00:00.000Z",
      section: "Development (Cursor)",
    });
    expect(recent).toMatchObject({
      periodStart: `${recentDay}T00:00:00.000Z`,
      periodEnd: `${shiftDay(recentDay, 1)}T00:00:00.000Z`,
    });
    expect(JSON.stringify(result)).not.toMatch(/0\.75|sourceUnits|ecb|Held row|whole-invoice|costsPartial|mpdee/);
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("summary");
    expect(fetchMock).toHaveBeenCalledWith(ACCOUNTS_PROJECT_BILLING_URL, expect.objectContaining({
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { authorization: `Bearer ${TOKEN}` },
    }));
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(snapshotFetch).not.toHaveBeenCalled();
    expect(baselineFetch).not.toHaveBeenCalled();
    expect(previewGuard).not.toHaveBeenCalled();
  });

  it("hides the chart for a future line or absolute overflow and still returns supplied totals", async () => {
    const asOf = new Date().toISOString();
    const future = envelope({
      asOf,
      cost: 100,
      lines: [snapshotLine("a", shiftDay(asOf.slice(0, 10), 2), { amountMinor: 100 })],
      firstInvoiced: 0,
      issued: 0,
      net: 0,
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(future)));
    const hidden = await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(hidden).toMatchObject({ available: true, chartAvailable: false, sections: [], costTotalPence: 100, invoicedPence: 0 });

    const day = asOf.slice(0, 10);
    const overflow = envelope({
      asOf,
      cost: 1,
      issued: 0,
      net: 0,
      firstInvoiced: 0,
      lines: [
        snapshotLine("a", day, { amountMinor: Number.MAX_SAFE_INTEGER }),
        snapshotLine("b", day, { amountMinor: -Number.MAX_SAFE_INTEGER, category: "DATABASE" }),
        snapshotLine("c", day, { amountMinor: 1 }),
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(overflow)));
    expect(await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN }))
      .toMatchObject({ available: true, chartAvailable: false, sections: [], costTotalPence: 1, remainingToInvoicePence: 1 });
  });

  it("fails closed for no token, transport errors, oversized bodies and contradictory totals", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: "short" })).toEqual({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("nope", 503)));
    const unavailable = await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(unavailable).toEqual({ available: false });
    expect(JSON.stringify(unavailable)).not.toMatch(/Accounts|Bearer|pence/i);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse("{")));
    expect(await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({ available: false });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(envelope({ remaining: 1 }))));
    expect(await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({ available: false });

    const cancel = vi.fn();
    const getReader = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => (name === "content-length" ? String(15_000_001) : null) },
      body: { cancel, getReader },
    })));
    expect(await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN })).toEqual({ available: false });
    expect(cancel).toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error(`redirect denied Bearer ${TOKEN}`);
    }));
    const failed = await fetchAccountsCostDashboard({ COST_ACCOUNTS_READ_TOKEN: TOKEN });
    expect(failed).toEqual({ available: false });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });

  it("uses the loopback origin only for a development process and never follows an invalid host", async () => {
    const payload = envelope({ cost: null, lines: [], firstInvoiced: 50_000 });
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    const dev = await fetchAccountsCostDashboard({
      NODE_ENV: "development",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000/",
      COST_ACCOUNTS_READ_TOKEN: TOKEN,
    });
    expect(dev).toMatchObject({ available: true, costTotalPence: null, invoicedPence: 95_000, remainingToInvoicePence: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/api/costs/projects/itrader/billing",
      expect.objectContaining({ redirect: "error", headers: { authorization: `Bearer ${TOKEN}` } }),
    );

    fetchMock.mockClear();
    for (const origin of [
      "http://127.0.0.1:4000/billing",
      "http://127.0.0.1:4001",
      "http://localhost:4000",
      "http://user:pass@127.0.0.1:4000",
      "https://accounts.example/api",
    ]) {
      const blocked = await fetchAccountsCostDashboard({
        NODE_ENV: "development",
        COST_ACCOUNTS_DEV_ORIGIN: origin,
        COST_ACCOUNTS_READ_TOKEN: TOKEN,
      });
      expect(blocked).toEqual({ available: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockClear();
    await fetchAccountsCostDashboard({
      NODE_ENV: "development",
      VERCEL: "1",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000",
      COST_ACCOUNTS_READ_TOKEN: TOKEN,
    });
    await fetchAccountsCostDashboard({
      NODE_ENV: "development",
      VERCEL_ENV: "preview",
      COST_ACCOUNTS_DEV_ORIGIN: "http://evil.example",
      COST_ACCOUNTS_READ_TOKEN: TOKEN,
    });
    await fetchAccountsCostDashboard({
      NODE_ENV: "production",
      COST_ACCOUNTS_DEV_ORIGIN: "http://127.0.0.1:4000",
      COST_ACCOUNTS_READ_TOKEN: TOKEN,
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      ACCOUNTS_PROJECT_BILLING_URL,
      ACCOUNTS_PROJECT_BILLING_URL,
      ACCOUNTS_PROJECT_BILLING_URL,
    ]);
  });
});
