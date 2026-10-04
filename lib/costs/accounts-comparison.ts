import { z } from "zod";
import { formatMarkedGbp } from "@/lib/costs/format";
import type { CostComparisonDto } from "@/lib/costs/dto";
import { assertAccountsPreview, ACCOUNTS_PREVIEW_START } from "./accounts-preview";
import type { RuntimeEnv } from "@/lib/runtime-env";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const units = z.string().regex(/^-?\d+\.\d{7}$/);
const money = z.number().int().safe();
const policyRates = { billable: z.boolean(), includedBaseBps: z.number().int(), markupBps: z.number().int(), infrastructureMarkupBps: z.number().int(), vercelDailyPence: z.number().int() };
const fx = z.object({ currency: z.string(), date: day, rate: z.string(), source: z.string(), estimate: z.boolean() }).strict();

export const accountsComparisonSchema = z.object({
  version: z.literal("mpdee-project-cost-comparison-v1"),
  project: z.literal("itrader"),
  policyVersion: z.literal("mpdee-comparison-policy-v1"),
  allocationMethod: z.literal("mpdee-subscription-allocation-v1"),
  approvedSnapshot: z.literal(false),
  authoritativeWriter: z.literal("itrader"),
  ledgerStart: z.literal(ACCOUNTS_PREVIEW_START),
  asOf: z.string().datetime(),
  revision: digest,
  sourceUpdatedAt: z.string().datetime().nullable(),
  reconciliation: z.object({ status: z.literal("shadow"), unresolved: z.number().int().nonnegative(), note: z.string().min(1) }).strict(),
  coverage: z.object({
    events: z.number().int().nonnegative().max(50000),
    held: z.number().int().nonnegative(),
    fxMissing: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
    from: z.literal(ACCOUNTS_PREVIEW_START),
    overlap: z.object({
      unassignedAndHeld: z.number().int().nonnegative(),
      heldAndFx: z.number().int().nonnegative(),
      unionUnresolved: z.number().int().nonnegative(),
      note: z.string().min(1),
    }).strict(),
  }).strict(),
  totals: z.array(z.object({
    currency: z.string().min(1).max(10),
    usageValue: units.nullable(),
    providerCost: units.nullable(),
    clientCharge: units.nullable(),
    complete: z.boolean(),
    unresolved: z.object({
      usageEvents: z.number().int().nonnegative(),
      providerEvents: z.number().int().nonnegative(),
      chargeEvents: z.number().int().nonnegative(),
      fxEstimateEvents: z.number().int().nonnegative(),
    }).strict(),
  }).strict()).max(10),
  outstanding: z.object({ pence: money.nullable(), reason: z.string().nullable() }).strict(),
  documents: z.object({
    providerInvoicePence: money.nullable(),
    providerCreditPence: money.nullable(),
    customerCreditPence: money.nullable(),
    customerPaymentPence: money.nullable(),
    vatPence: money.nullable(),
    prepaidPence: money.nullable(),
  }).strict(),
  lines: z.array(z.object({
    id: digest, revision: digest,
    category: z.enum(["CURSOR", "VERCEL_HOSTING", "DATABASE", "OTHER"]),
    funding: z.string().max(100), currency: z.string().max(10),
    periodStart: day, periodEnd: day, held: z.boolean(), provisional: z.literal(true), invoiceability: z.literal("PROVISIONAL"),
    reason: z.string().nullable(), events: z.literal(1),
    usageValue: units.nullable(), providerCost: units.nullable(), clientCharge: units.nullable(), clientChargePence: money.nullable(),
    fx: z.array(fx),
  }).strict()).max(50000),
  subscriptionAllocation: z.null(),
  zeroProviderCashIncluded: z.number().int().nonnegative(),
  policyInventory: z.object({
    comparison: z.object({ version: z.literal("mpdee-comparison-policy-v1"), ...policyRates }).strict(),
    codeDefaults: z.object(policyRates).strict(),
    knownProjectSeed: z.object({ slug: z.literal("itrader"), effectiveAt: z.string(), ...policyRates }).strict(),
    storedPolicies: z.array(z.object({
      id: z.string(), scopeKey: z.string(), projectSlug: z.string().nullable(), effectiveAt: z.string(), effectiveUntil: z.string().nullable(), ...policyRates,
    }).strict()).nullable(),
    storedPoliciesRead: z.boolean(),
    unreadReason: z.string().nullable(),
  }).strict(),
}).strict();
export type AccountsComparison = z.infer<typeof accountsComparisonSchema>;

const sourceLabel = (rows: AccountsComparison["totals"], field: "usageValue" | "providerCost" | "clientCharge") => {
  if (!rows.length) return "No source rows";
  return rows.map(row => {
    const amount = row[field];
    if (amount === null) return `${row.currency} unresolved`;
    return row.complete ? `${row.currency} ${amount}` : `${row.currency} ${amount} unresolved`;
  }).join(" · ");
};

export function summariseComparison(input: AccountsComparison | { available: false; gap: string }): CostComparisonDto {
  if (!("version" in input)) {
    return { available: false, policyVersion: null, usageValueLabel: "Unavailable", providerCostLabel: "Unavailable", clientChargeLabel: "Unavailable", outstandingLabel: "Unavailable", reconciliation: input.gap, sourceUpdatedAt: null, held: null, fxMissing: null, unassigned: null, gap: input.gap };
  }
  return {
    available: true,
    policyVersion: input.policyVersion,
    usageValueLabel: sourceLabel(input.totals, "usageValue"),
    providerCostLabel: sourceLabel(input.totals, "providerCost"),
    clientChargeLabel: sourceLabel(input.totals, "clientCharge"),
    outstandingLabel: input.outstanding.pence === null ? "No approved client charges" : formatMarkedGbp(input.outstanding.pence),
    reconciliation: input.reconciliation.note,
    sourceUpdatedAt: input.sourceUpdatedAt,
    held: input.coverage.held,
    fxMissing: input.coverage.fxMissing,
    unassigned: input.coverage.unassigned,
    gap: input.reconciliation.unresolved > 0 ? `${input.reconciliation.unresolved} unresolved comparison rows` : null,
  };
}

/** Local shadow only. Production and preview deployments keep the fixed Accounts host. */
export function localComparisonOrigin(env: RuntimeEnv = process.env): string | null {
  const origin = env.COST_ACCOUNTS_COMPARISON_ORIGIN?.trim();
  if (!origin || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash) return null;
    return origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function fetchAccountsComparison(env: RuntimeEnv = process.env): Promise<AccountsComparison | { available: false; gap: string }> {
  try {
    const localOrigin = localComparisonOrigin(env);
    if (!localOrigin) assertAccountsPreview(env);
    const token = env.COST_ACCOUNTS_READ_TOKEN?.trim();
    if (!token || token.length < 32) return { available: false, gap: "Accounts project read access is not configured." };
    const url = new URL(`${localOrigin ?? "https://accounts.mpdee.info"}/api/costs/projects/itrader/comparison`);
    url.searchParams.set("from", ACCOUNTS_PREVIEW_START);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
    if (!response.ok) return { available: false, gap: "The Accounts comparison snapshot is unavailable." };
    const text = await response.text();
    if (Buffer.byteLength(text) > 15_000_000) return { available: false, gap: "The Accounts comparison snapshot is too large." };
    const parsed = accountsComparisonSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { available: false, gap: "The Accounts comparison snapshot did not match the expected contract." };
    return parsed.data;
  } catch {
    return { available: false, gap: "The Accounts comparison snapshot could not be read. Existing preview balances were not replaced." };
  }
}
