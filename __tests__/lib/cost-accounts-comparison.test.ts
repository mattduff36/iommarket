import { describe, expect, it } from "vitest";
import { ACCOUNTS_PREVIEW_START } from "@/lib/costs/accounts-preview";
import { accountsComparisonSchema, localComparisonOrigin, summariseComparison } from "@/lib/costs/accounts-comparison";

const hash = "a".repeat(64);
const rates = { billable: true, includedBaseBps: 5000, markupBps: 0, infrastructureMarkupBps: 0, vercelDailyPence: 0 };

function comparison() {
  return {
    version: "mpdee-project-cost-comparison-v1" as const,
    project: "itrader" as const,
    policyVersion: "mpdee-comparison-policy-v1" as const,
    allocationMethod: "mpdee-subscription-allocation-v1" as const,
    approvedSnapshot: false as const,
    authoritativeWriter: "itrader" as const,
    ledgerStart: ACCOUNTS_PREVIEW_START,
    asOf: "2026-09-20T00:00:00.000Z",
    revision: hash,
    sourceUpdatedAt: "2026-09-20T00:00:00.000Z",
    reconciliation: { status: "shadow" as const, unresolved: 1, note: "iTrader remains the writer. Source totals are not forced to agree." },
    coverage: { events: 1, held: 1, fxMissing: 0, unassigned: 1, from: ACCOUNTS_PREVIEW_START, overlap: { unassignedAndHeld: 1, heldAndFx: 0, unionUnresolved: 1, note: "Unassigned rows are included in held." } },
    totals: [{ currency: "USD", usageValue: "10.0000000", providerCost: "0.0000000", clientCharge: null, complete: false, unresolved: { usageEvents: 0, providerEvents: 0, chargeEvents: 1, fxEstimateEvents: 0 } }],
    outstanding: { pence: null, reason: "No approved client charges" },
    documents: { providerInvoicePence: null, providerCreditPence: null, customerCreditPence: null, customerPaymentPence: null, vatPence: null, prepaidPence: null },
    lines: [{
      id: hash, revision: hash, category: "CURSOR" as const, funding: "included", currency: "USD",
      periodStart: "2026-09-01", periodEnd: "2026-09-01", held: true, provisional: true as const, invoiceability: "PROVISIONAL" as const,
      reason: "Project unassigned", events: 1 as const, usageValue: null, providerCost: null, clientCharge: null, clientChargePence: null, fx: [],
    }],
    subscriptionAllocation: null,
    zeroProviderCashIncluded: 1,
    policyInventory: {
      comparison: { version: "mpdee-comparison-policy-v1" as const, ...rates },
      codeDefaults: { ...rates, billable: false },
      knownProjectSeed: { slug: "itrader" as const, effectiveAt: "2026-08-01T00:00:00.000Z", ...rates, markupBps: 1000, vercelDailyPence: 38 },
      storedPolicies: null,
      storedPoliciesRead: false,
      unreadReason: "Live policy rows were not read.",
    },
  };
}

describe("Accounts comparison reader", () => {
  it("keeps provisional lines non-invoiceable and does not turn a missing balance into zero", () => {
    const parsed = accountsComparisonSchema.parse(comparison());
    expect(parsed.lines[0].invoiceability).toBe("PROVISIONAL");
    expect(accountsComparisonSchema.safeParse({ ...parsed, lines: [{ ...parsed.lines[0], invoiceability: "INVOICEABLE" }] }).success).toBe(false);
    const summary = summariseComparison(parsed);
    expect(summary.clientChargeLabel).toBe("USD unresolved");
    expect(summary.outstandingLabel).toBe("No approved client charges");
    expect(summary.usageValueLabel).toBe("USD 10.0000000 unresolved");
    expect(summary.gap).toMatch(/unresolved/);
  });

  it("accepts only a local comparison origin outside production and preview", () => {
    expect(localComparisonOrigin({ COST_ACCOUNTS_COMPARISON_ORIGIN: "http://127.0.0.1:3310" })).toBe("http://127.0.0.1:3310");
    expect(localComparisonOrigin({ COST_ACCOUNTS_COMPARISON_ORIGIN: "https://accounts.mpdee.info", VERCEL_ENV: "production" })).toBeNull();
    expect(localComparisonOrigin({ COST_ACCOUNTS_COMPARISON_ORIGIN: "http://127.0.0.1:3310", VERCEL_ENV: "preview" })).toBeNull();
  });

  it("reports a comparison gap without replacing preview balances", () => {
    const summary = summariseComparison({ available: false, gap: "The Accounts comparison snapshot is unavailable." });
    expect(summary.available).toBe(false);
    expect(summary.outstandingLabel).toBe("Unavailable");
    expect(summary.clientChargeLabel).not.toBe("£0.00");
  });
});
