/** Accounts owns pricing; this reader is confined to the server. Next resolves the marker internally. */
import "server-only";
import { z } from "zod";
import { presentAccountsBilling, accountsBillingSchema } from "@/lib/costs/accounts-billing";
import {
  ACCOUNTS_BILLING_MAX_BYTES,
  ACCOUNTS_PRODUCTION_ORIGIN,
  ACCOUNTS_SUMMARY_MAX_BYTES,
  accountsProjectUrl,
  fetchAccountsDocument,
} from "@/lib/costs/accounts-http";
import { ACCOUNTS_PREVIEW_START } from "@/lib/costs/accounts-preview";
import type { AccountsSnapshot } from "@/lib/costs/accounts-snapshot";
import { COST_SECTION_LABELS, groupCostSections, type CostDashboardDto, type CostLineDto } from "@/lib/costs/dto";
import { formatMarkedGbp } from "@/lib/costs/format";
import type { RuntimeEnv } from "@/lib/runtime-env";

export const ACCOUNTS_PROJECT_SUMMARY_URL =
  `${ACCOUNTS_PRODUCTION_ORIGIN}/api/costs/projects/itrader/summary`;

export const ACCOUNTS_PROJECT_BILLING_URL =
  `${ACCOUNTS_PRODUCTION_ORIGIN}/api/costs/projects/itrader/billing`;

const DAY_MS = 86_400_000;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const isoDateTime = z.string().datetime();
const safePence = z.number().int().safe();
const rowCount = z.number().int().nonnegative().max(1_000_000);

export const accountsProjectSummarySchema = z.object({
  version: z.literal("mpdee-project-cost-summary-v1"),
  project: z.literal("itrader"),
  source: z.literal("mpdee-accounts"),
  pricingRuleVersion: z.string().min(1).max(120),
  ledgerStart: isoDateTime,
  asOf: isoDateTime,
  sourceUpdatedAt: isoDateTime.nullable(),
  revision: digest,
  approvedSnapshot: z.literal(false),
  currency: z.literal("GBP"),
  estimate: z.object({
    totalPence: safePence.nullable(),
    includedPence: safePence.nullable(),
    onDemandPence: safePence.nullable(),
    infrastructurePence: safePence.nullable(),
    partial: z.boolean(),
    fxEstimated: z.boolean(),
    fxMissingRows: rowCount,
  }).strict(),
  coverage: z.object({
    firstEventAt: isoDateTime.nullable(),
    lastEventAt: isoDateTime.nullable(),
    includedRows: rowCount,
    onDemandRows: rowCount,
    infrastructureRows: rowCount,
    infrastructureStatus: z.enum(["absent", "live", "local-shadow"]),
    exclusions: z.array(z.object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(160),
      rows: rowCount,
      reason: z.string().min(1).max(400),
    }).strict()).max(40),
  }).strict(),
  outstanding: z.object({
    pence: safePence.nullable(),
    reason: z.string().min(1).max(400).nullable(),
  }).strict(),
  pricing: z.array(z.string().min(1).max(400)).max(30),
}).strict();

export type AccountsProjectSummary = z.infer<typeof accountsProjectSummarySchema>;

export type AccountsProjectSummaryResult =
  | AccountsProjectSummary
  | { available: false; reason: string };

export type AccountsBillingHistoryPoint = {
  day: string;
  costPence: number | null;
  invoicedPence: number;
  remainingToInvoicePence: number | null;
};

export type AccountsCostDashboardResult =
  | { available: false }
  | {
      available: true;
      chartAvailable: boolean;
      sections: CostDashboardDto["sections"];
      costTotalPence: number | null;
      invoicedPence: number | null;
      remainingToInvoicePence: number | null;
      sourceUpdatedAt: string | null;
      asOf: string;
      history: AccountsBillingHistoryPoint[];
    };

function unavailable(reason: string): { available: false; reason: string } {
  return { available: false, reason };
}

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("The Accounts cost reader is server-only.");
  }
}

function summaryFailure(failure: "status" | "size" | "json" | "network"): { available: false; reason: string } {
  if (failure === "status") return unavailable("The Accounts project summary is unavailable.");
  if (failure === "size") return unavailable("The Accounts project summary is too large.");
  if (failure === "json") return unavailable("The Accounts project summary was not valid JSON.");
  return unavailable("The Accounts project summary could not be read.");
}

export async function fetchAccountsProjectSummary(
  env: RuntimeEnv = process.env,
): Promise<AccountsProjectSummaryResult> {
  assertServerRuntime();
  const token = env.COST_ACCOUNTS_READ_TOKEN?.trim() ?? "";
  if (token.length < 32) return unavailable("Accounts project read access is not configured.");
  const url = accountsProjectUrl(env, "summary");
  if (!url) return unavailable("The Accounts project summary is unavailable.");
  const document = await fetchAccountsDocument(url, token, ACCOUNTS_SUMMARY_MAX_BYTES);
  if (!document.ok) return summaryFailure(document.failure);
  const parsed = accountsProjectSummarySchema.safeParse(document.value);
  if (!parsed.success) return unavailable("The Accounts project summary did not match the expected contract.");
  return parsed.data;
}

function sumSafePence(values: readonly number[]): number | null {
  return values.reduce<number | null>((total, value) => {
    if (total === null || !Number.isSafeInteger(value)) return null;
    const next = total + value;
    return Number.isSafeInteger(next) ? next : null;
  }, 0);
}

function isKnownLine(
  line: AccountsSnapshot["lines"][number],
): line is AccountsSnapshot["lines"][number] & { amountMinor: number } {
  return !line.held && line.amountMinor !== null;
}

function lineInsideWindow(line: { periodStart: string; periodEnd: string }, asOf: string): boolean {
  const firstDay = ACCOUNTS_PREVIEW_START.slice(0, 10);
  const lastDay = asOf.slice(0, 10);
  return line.periodStart >= firstDay && line.periodEnd <= lastDay && line.periodStart <= line.periodEnd;
}

function toDisplayLine(
  line: AccountsSnapshot["lines"][number] & { amountMinor: number },
): CostLineDto {
  const startMs = Date.parse(`${line.periodStart}T00:00:00.000Z`);
  const periodStart = new Date(Math.max(startMs, Date.parse(ACCOUNTS_PREVIEW_START))).toISOString();
  const periodEnd = new Date(Date.parse(`${line.periodEnd}T00:00:00.000Z`) + DAY_MS).toISOString();
  return {
    id: line.id,
    section: COST_SECTION_LABELS[line.category],
    category: line.category,
    label: line.label,
    amountLabel: formatMarkedGbp(line.amountMinor),
    amountMinor: line.amountMinor,
    kind: "CHARGE",
    invoiceability: "PROVISIONAL",
    periodStart,
    periodEnd,
    provisional: true,
  };
}

function chartFromSnapshot(
  snapshot: AccountsSnapshot,
  asOf: string,
  costTotalPence: number | null,
): { chartAvailable: boolean; sections: CostDashboardDto["sections"] } {
  const empty = { chartAvailable: false, sections: [] as CostDashboardDto["sections"] };
  if (costTotalPence === null || Date.parse(asOf) < Date.parse(ACCOUNTS_PREVIEW_START)) return empty;
  const known = snapshot.lines.filter(isKnownLine);
  if (known.some((line) => !lineInsideWindow(line, asOf))) return empty;
  const total = sumSafePence(known.map((line) => line.amountMinor));
  const absoluteTotal = sumSafePence(known.map((line) => Math.abs(line.amountMinor)));
  if (absoluteTotal === null || total !== costTotalPence) return empty;
  return { chartAvailable: true, sections: groupCostSections(known.map(toDisplayLine)) };
}

export async function fetchAccountsCostDashboard(
  env: RuntimeEnv = process.env,
): Promise<AccountsCostDashboardResult> {
  assertServerRuntime();
  const token = env.COST_ACCOUNTS_READ_TOKEN?.trim() ?? "";
  if (token.length < 32) return { available: false };
  const url = accountsProjectUrl(env, "billing");
  if (!url) return { available: false };
  const document = await fetchAccountsDocument(url, token, ACCOUNTS_BILLING_MAX_BYTES);
  if (!document.ok) return { available: false };
  const parsed = accountsBillingSchema.safeParse(document.value);
  if (!parsed.success) return { available: false };
  const billing = presentAccountsBilling(parsed.data);
  return {
    available: true,
    ...chartFromSnapshot(billing.snapshot, billing.asOf, billing.costTotalPence),
    costTotalPence: billing.costTotalPence,
    invoicedPence: billing.invoicedPence,
    remainingToInvoicePence: billing.remainingToInvoicePence,
    sourceUpdatedAt: billing.sourceUpdatedAt,
    asOf: billing.asOf,
    history: billing.history,
  };
}
