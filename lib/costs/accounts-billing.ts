import { z } from "zod";
import { ACCOUNTS_PREVIEW_START } from "@/lib/costs/accounts-preview";
import { accountsSnapshotSchema, type AccountsSnapshot } from "@/lib/costs/accounts-snapshot";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safePence = z.number().int().safe();
const count = z.number().int().nonnegative().max(1_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

const historyPointSchema = z.object({
  day,
  costPence: safePence.nullable(),
  invoicedPence: safePence,
  remainingToInvoicePence: safePence.nullable(),
}).strict();

const billingObject = z.object({
  version: z.literal("mpdee-project-billing-v1"),
  project: z.literal("itrader"),
  currency: z.literal("GBP"),
  allocationMode: z.literal("whole-invoice-ex-vat"),
  balanceBasis: z.literal("costs-minus-invoices"),
  asOf: z.string().datetime(),
  revision: digest,
  costSnapshot: accountsSnapshotSchema,
  costTotalPence: safePence.nullable(),
  invoiceTotals: z.object({
    issuedPence: safePence,
    creditPence: safePence,
    netInvoicedPence: safePence,
    invoiceCount: count,
    creditCount: count,
  }).strict(),
  remainingToInvoicePence: safePence.nullable(),
  coverage: z.object({
    unlinkedInvoiceCount: count,
    conflictingInvoiceCount: count,
    costsPartial: z.boolean(),
    costLedgerStart: z.literal(ACCOUNTS_PREVIEW_START),
    invoicesBeforeCostLedger: count,
  }).strict(),
  history: z.array(historyPointSchema).min(1).max(3661),
}).strict();

export type AccountsBilling = z.infer<typeof billingObject>;

export type AccountsBillingHistoryPoint = {
  day: string;
  costPence: number | null;
  invoicedPence: number;
  remainingToInvoicePence: number | null;
};

export type AccountsBillingPresentation = {
  costTotalPence: number | null;
  invoicedPence: number | null;
  remainingToInvoicePence: number | null;
  sourceUpdatedAt: string | null;
  asOf: string;
  history: AccountsBillingHistoryPoint[];
  snapshot: AccountsSnapshot;
};

function shiftUtcDay(value: string, delta: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function safeDifference(left: number, right: number): number | null {
  const value = left - right;
  return Number.isSafeInteger(value) ? value : null;
}

function balances(
  cost: number | null,
  invoiced: number,
  remaining: number | null,
  conflicts: boolean,
): boolean {
  if (conflicts || cost === null) return remaining === null;
  const expected = safeDifference(cost, invoiced);
  return expected !== null && remaining === expected;
}

function knownCostTotal(snapshot: AccountsSnapshot): number | null {
  return snapshot.lines.reduce<number | null>((total, line) => {
    if (total === null || line.held || line.amountMinor === null) return total;
    const next = total + line.amountMinor;
    return Number.isSafeInteger(next) ? next : null;
  }, 0);
}

function historyIsDense(history: readonly { day: string }[]): boolean {
  for (let index = 1; index < history.length; index += 1) {
    if (shiftUtcDay(history[index - 1].day, 1) !== history[index].day) return false;
  }
  return true;
}

function refineAccountsBilling(value: AccountsBilling, ctx: z.RefinementCtx): void {
  const net = safeDifference(value.invoiceTotals.issuedPence, value.invoiceTotals.creditPence);
  if (net === null || net !== value.invoiceTotals.netInvoicedPence) {
    ctx.addIssue({ code: "custom", message: "Invoice totals do not balance." });
  }
  const conflicts = value.coverage.conflictingInvoiceCount > 0;
  if (!balances(value.costTotalPence, value.invoiceTotals.netInvoicedPence, value.remainingToInvoicePence, conflicts)) {
    ctx.addIssue({ code: "custom", message: "Remaining balance does not match supplied totals." });
  }
  if (value.costSnapshot.asOf !== value.asOf) {
    ctx.addIssue({ code: "custom", message: "Billing and snapshot timestamps differ." });
  }
  if (value.costTotalPence !== null && knownCostTotal(value.costSnapshot) !== value.costTotalPence) {
    ctx.addIssue({ code: "custom", message: "Snapshot total does not match supplied cost." });
  }
  const last = value.history[value.history.length - 1];
  const totalsMatch = last
    && last.day === value.asOf.slice(0, 10)
    && last.costPence === value.costTotalPence
    && last.invoicedPence === value.invoiceTotals.netInvoicedPence
    && last.remainingToInvoicePence === value.remainingToInvoicePence;
  if (!totalsMatch) ctx.addIssue({ code: "custom", message: "Final history day does not match billing totals." });
  if (!historyIsDense(value.history)) {
    ctx.addIssue({ code: "custom", message: "Billing history is not a dense day sequence." });
  }
  const historyBalances = value.history.every((point) => balances(
    point.costPence,
    point.invoicedPence,
    point.remainingToInvoicePence,
    conflicts,
  ));
  if (!historyBalances) ctx.addIssue({ code: "custom", message: "History balance does not match supplied day totals." });
}

export const accountsBillingSchema = billingObject.superRefine(refineAccountsBilling);

export function presentAccountsBilling(billing: AccountsBilling): AccountsBillingPresentation {
  const conflicts = billing.coverage.conflictingInvoiceCount > 0;
  return {
    costTotalPence: billing.costTotalPence,
    invoicedPence: conflicts ? null : billing.invoiceTotals.netInvoicedPence,
    remainingToInvoicePence: billing.remainingToInvoicePence,
    sourceUpdatedAt: billing.costSnapshot.sourceUpdatedAt,
    asOf: billing.asOf,
    history: billing.history.map((point) => ({
      day: point.day,
      costPence: point.costPence,
      invoicedPence: point.invoicedPence,
      remainingToInvoicePence: point.remainingToInvoicePence,
    })),
    snapshot: billing.costSnapshot,
  };
}
