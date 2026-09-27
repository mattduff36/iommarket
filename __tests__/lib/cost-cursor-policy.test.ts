import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateClassifiedCharges, classifyFocusRow } from "@/lib/costs/classify";
import { normalizeProviderUsd } from "@/lib/costs/cursor-decimal";
import {
  assessCursorAllowance,
  assessFetchCompleteness,
  fundingFromKind,
  interpretCursorCsvCost,
  INCLUDED_KIND,
  mergeCursorEvents,
  normalizeCursorEvents,
  ON_DEMAND_KIND,
  planCursorClientLines,
} from "@/lib/costs/cursor-events";
import { cursorClientGbpMinor, cursorClientUsd } from "@/lib/costs/cursor-policy";
import { nominalUsdFromTokens } from "@/lib/costs/cursor-rates";
import { proposeCursorReprice } from "@/lib/costs/cursor-reconcile";
import { isCanonicalLedgerWriter } from "@/lib/costs/ledger-role";
import { focusCoversMarketplaceLine } from "@/lib/costs/marketplace-import";
import { computeMarkedGbpMinor } from "@/lib/costs/money";
import { nextInfrastructureSlice } from "@/lib/costs/sync-window";
import type { FocusChargeRow } from "@/lib/costs/focus";

const grokIncluded = {
  timestamp: "2026-09-26T18:36:34.992Z",
  model: "grok-4.7-high",
  kind: INCLUDED_KIND,
  conversationId: "conv-itrader",
  isChargeable: true,
  isTokenBasedCall: true,
  chargedCents: 16.136999130249023,
  tokenUsage: {
    inputTokens: 36427,
    outputTokens: 918,
    cacheReadTokens: 166016,
    cacheWriteTokens: 0,
    totalCents: 16.136999130249023,
  },
};

describe("iTrader Cursor 60/110 policy", () => {
  it("charges $100 included as $60, $100 on-demand as $110, and $80/$20 as $70 without the 20% markup", () => {
    expect(cursorClientUsd({ includedNominalUsd: "100", onDemandUsd: "0" })).toBe("60");
    expect(cursorClientUsd({ includedNominalUsd: "0", onDemandUsd: "100" })).toBe("110");
    expect(cursorClientUsd({ includedNominalUsd: "80", onDemandUsd: "20" })).toBe("70");
    expect(cursorClientGbpMinor("60", "1")).toBe(6000n);
    expect(cursorClientGbpMinor("110", "1")).toBe(11000n);
    expect(cursorClientGbpMinor("70", "1")).toBe(7000n);
    expect(computeMarkedGbpMinor("10", "1")).toBe(1000n);
    expect(cursorClientGbpMinor("10", "1")).toBe(1000n);
  });

  it("normalizes the supplied Grok 4.7 included event and prices only the attributed nominal value", () => {
    expect(normalizeProviderUsd(16.136999130249023)).toBe("0.1613700");
    const calculated = nominalUsdFromTokens({
      model: "grok-4.7-high",
      inputTokens: 36427,
      outputTokens: 918,
      cacheReadTokens: 166016,
      cacheWriteTokens: 0,
    });
    expect(calculated.status).toBe("calculated");
    expect(calculated.usd).toBe("0.161370");
    const [event] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      events: [grokIncluded],
      sourceQuality: "complete",
      attribution: new Map([["conv-itrader", { projectId: "itrader", status: "assigned" }]]),
    });
    expect(event?.funding).toBe("included");
    expect(event?.reportedOnDemandUsd).toBe("0");
    expect(fundingFromKind(INCLUDED_KIND)).toBe("included");
    expect(event?.rawKind).toBe(INCLUDED_KIND);
    const [line] = planCursorClientLines([event!]);
    expect(line?.nativeAmount).toBe("0.09682200");
    expect(line?.bucketKey).toContain("included");
  });

  it("keeps a zero-cost non-token event and prices on-demand from charged cents", () => {
    const [freeEvent] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      sourceQuality: "complete",
      attribution: new Map([["conv-free", { projectId: "itrader", status: "assigned" }]]),
      events: [{
        timestamp: "2026-09-26T19:09:11.371Z",
        model: "grok-4.7-high",
        kind: ON_DEMAND_KIND,
        conversationId: "conv-free",
        isChargeable: false,
        isTokenBasedCall: false,
        chargedCents: 0,
      }],
    });
    expect(freeEvent?.free).toBe(true);
    expect(freeEvent?.funding).toBe("on-demand");
    expect(planCursorClientLines([freeEvent!])).toEqual([]);

    const [onDemand] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      sourceQuality: "complete",
      attribution: new Map([["conv-itrader", { projectId: "itrader", status: "assigned" }]]),
      events: [{
        timestamp: "2026-09-26T18:00:00.000Z",
        model: "gpt-5.6-sol-medium",
        kind: ON_DEMAND_KIND,
        conversationId: "conv-itrader",
        isChargeable: true,
        isTokenBasedCall: true,
        chargedCents: 10000,
        usageBasedCosts: "$100.00",
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCents: 10000,
        },
      }],
    });
    expect(onDemand?.funding).toBe("on-demand");
    expect(onDemand?.nominalUsd?.startsWith("100")).toBe(true);
    expect(Number(onDemand?.clientUsd)).toBeCloseTo(110, 4);
    expect(onDemand?.displayStatus === "matched" || onDemand?.displayStatus === "rounded").toBe(true);
  });

  it("does not treat charged cents on an included event as on-demand", () => {
    const csv = interpretCursorCsvCost({ kind: "Included", cost: "Included" });
    expect(csv.funding).toBe("included");
    expect(csv.onDemandUsd).toBeNull();
    expect(interpretCursorCsvCost({ kind: "Included", cost: "Free" }).free).toBe(true);
    expect(interpretCursorCsvCost({ kind: "On-Demand", cost: "3.32" }).onDemandUsd).not.toBeNull();
  });

  it("keeps other-project usage out of the iTrader lines and does not infer overage from $400", () => {
    const [event] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      events: [{ ...grokIncluded, conversationId: "conv-other" }],
      sourceQuality: "complete",
      attribution: new Map([["conv-other", { projectId: null, status: "unassigned" }]]),
    });
    expect(planCursorClientLines([event!])).toEqual([]);
    const allowance = assessCursorAllowance({
      accountNominalUsd: "450",
      accountOnDemandUsd: "0",
    });
    expect(allowance.expectationCrossed).toBe(true);
    expect(allowance.confirmedOnDemand).toBe(false);
    expect(allowance.alert).toBe("none");
    const confirmed = assessCursorAllowance({
      accountNominalUsd: "10",
      accountOnDemandUsd: "1.25",
      reportedAllowanceUsd: "400",
      remainingUsd: "40",
    });
    expect(confirmed.confirmedOnDemand).toBe(true);
    expect(confirmed.alert).toBe("confirmed-on-demand");
  });

  it("preserves earlier events across partial and complete upload batches", () => {
    const [first] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      events: [grokIncluded],
      sourceQuality: "complete",
      attribution: new Map([["conv-itrader", { projectId: "itrader", status: "assigned" }]]),
    });
    expect(mergeCursorEvents([first!], [], "partial")).toHaveLength(1);
    expect(mergeCursorEvents([first!], [], "complete")).toHaveLength(1);
    const second = {
      ...first!,
      identity: "second-event",
      occurredAt: "2026-09-26T18:37:34.992Z",
    };
    expect(mergeCursorEvents([first!], [second], "complete")).toHaveLength(2);
    const corrected = { ...first!, clientUsd: "0.12345678" };
    expect(mergeCursorEvents([first!], [corrected], "complete")).toEqual([
      corrected,
    ]);
  });

  it("rejects an unknown funding kind", () => {
    const [unknown] = normalizeCursorEvents({
      providerAccountRef: "acct-test",
      events: [{ ...grokIncluded, kind: "USAGE_EVENT_KIND_FUTURE", conversationId: "conv-itrader" }],
      sourceQuality: "complete",
      attribution: new Map([["conv-itrader", { projectId: "itrader", status: "assigned" }]]),
    });
    expect(unknown?.funding).toBe("unresolved");
    expect(unknown?.unresolved).toBe(true);
    expect(planCursorClientLines([unknown!])).toEqual([]);
    expect(fundingFromKind(ON_DEMAND_KIND)).toBe("on-demand");
    expect(assessFetchCompleteness({
      fetchedCount: 86,
      reportedTotal: 87,
      pageCapReached: false,
    }).quality).toBe("partial");
  });

  it("identifies the canonical writer without using VERCEL_ENV", () => {
    expect(isCanonicalLedgerWriter({
      VERCEL_ENV: "production",
      COST_LEDGER_ROLE: "canonical",
      VERCEL_PROJECT_ID: "prj_staging",
      COST_CANONICAL_VERCEL_PROJECT_ID: "prj_live",
    })).toBe(false);
    expect(isCanonicalLedgerWriter({
      VERCEL_ENV: "preview",
      COST_LEDGER_ROLE: "canonical",
      VERCEL_PROJECT_ID: "prj_live",
      COST_CANONICAL_VERCEL_PROJECT_ID: "prj_live",
    })).toBe(true);
    expect(isCanonicalLedgerWriter({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("advances infrastructure slices without replacing a failed window", () => {
    const startedAt = new Date("2026-08-13T23:00:00.000Z");
    const first = nextInfrastructureSlice({
      startedAt,
      now: new Date("2026-09-26T00:00:00.000Z"),
      lastSuccessfulTo: null,
    });
    expect(first.from.toISOString()).toBe(startedAt.toISOString());
    expect(first.caughtUp).toBe(false);
    const next = nextInfrastructureSlice({
      startedAt,
      now: new Date("2026-09-26T00:00:00.000Z"),
      lastSuccessfulTo: first.to,
    });
    expect(next.from.getTime()).toBeGreaterThan(startedAt.getTime());
    expect(next.from.getTime()).toBeLessThanOrEqual(first.to.getTime());
  });

  it("counts a second Vercel project and does not double-count an identical database row", () => {
    const row = {
      BilledCost: 10,
      BillingCurrency: "USD",
      ChargeCategory: "Usage",
      ChargePeriodStart: "2026-09-01T00:00:00.000Z",
      ChargePeriodEnd: "2026-09-02T00:00:00.000Z",
      ConsumedQuantity: 1,
      ConsumedUnit: "units",
      EffectiveCost: 10,
      RegionId: null,
      RegionName: null,
      ServiceName: "Fluid Compute",
      ServiceCategory: "Compute",
      ServiceProviderName: "Vercel",
      Tags: { ProjectId: "prj_preview" },
      PricingCategory: "Standard",
      PricingCurrency: "USD",
      PricingQuantity: 1,
      PricingUnit: "units",
    } as FocusChargeRow;
    const preview = classifyFocusRow(row, {
      projectId: "prj_live",
      projectIds: ["prj_live", "prj_preview"],
      previewProjectId: "prj_preview",
      databaseResourceIds: ["store_db"],
    });
    expect(preview).toMatchObject({ kind: "hosting", deploymentTarget: "preview" });
    const database = classifyFocusRow(
      { ...row, ServiceName: "Supabase", Tags: { ResourceId: "store_db" } },
      { projectId: "prj_live", databaseResourceIds: ["store_db"] },
    );
    expect(database).toMatchObject({ kind: "database" });
    if (!("kind" in database) || !("kind" in preview)) return;
    const aggregated = aggregateClassifiedCharges([
      database,
      { ...database },
    ]);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.nativeAmount).toBe(database.nativeAmount);
  });

  it("does not reprice an invoiced subscription-share line or a day without evidence", () => {
    const proposal = proposeCursorReprice({
      existing: [
        {
          bucketKey: "cursor:subscription:2026-08-24",
          nativeAmount: "3.32",
          invoiced: true,
          policyVersion: "gbp-markup-v1",
        },
        {
          bucketKey: "cursor:subscription:2026-09-26",
          nativeAmount: "4.00",
          invoiced: false,
          policyVersion: "gbp-markup-v1",
        },
      ],
      replacements: [
        { bucketKey: "cursor:itrader:included:2026-09-26:itrader-cursor-60-110-v1", nativeAmount: "2.40", day: "2026-09-26" },
      ],
      evidenceDays: ["2026-09-26"],
    });
    expect(proposal.reversible.map((line) => line.bucketKey)).toEqual([
      "cursor:subscription:2026-09-26",
    ]);
    expect(proposal.blocked).toHaveLength(1);
    expect(proposal.replacements).toHaveLength(1);
  });

  it("detects a marketplace invoice that FOCUS already covers", () => {
    const periodStart = new Date("2026-09-01T00:00:00.000Z");
    const periodEnd = new Date("2026-09-02T00:00:00.000Z");
    expect(focusCoversMarketplaceLine(
      {
        invoiceId: "inv_1",
        lineId: "line_1",
        nativeAmount: "12.50",
        nativeCurrency: "USD",
        periodStart,
        periodEnd,
        serviceName: "Supabase",
      },
      [{ nativeAmount: "12.5", periodStart, periodEnd, serviceName: "Supabase Postgres" }],
    )).toBe(true);
  });

  it("stops the pre-commit hook from staging the rolling usage ledger", () => {
    const hook = readFileSync(path.join(process.cwd(), "scripts/git-hooks/pre-commit"), "utf8");
    expect(hook).toContain(".env");
    expect(hook).not.toContain("git add data/cursor-usage.json");
    const collector = readFileSync(
      path.join(process.cwd(), "scripts/cursor-usage/collect.mjs"),
      "utf8",
    );
    expect(collector).toContain(".update(row.rawPayload)");
    expect(collector).toContain("status = 'review'");
    const hooks = readFileSync(path.join(process.cwd(), ".cursor/hooks.json"), "utf8");
    expect(hooks).toContain("sessionEnd");
    expect(hooks).not.toContain("followup_message");
  });

  it("stores policy and provider event boundaries as timezone-aware timestamps", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260926190000_cost_cursor_client_policy/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(/"effectiveFrom" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(migration).toMatch(/"occurredAt" TIMESTAMPTZ\(3\) NOT NULL/);
    expect(migration).not.toMatch(/"effectiveFrom" TIMESTAMP\(3\)/);
  });
});
