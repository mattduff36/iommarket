/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  AUDITED_PREVIEW_PAYMENTS,
  applyReconciliationUpdates,
  expectedManifest,
  parseArgs,
  validateReconciliationSet,
  type AuditedPayment,
} from "../../scripts/reconcile-legacy-featured-entitlements";

function candidate(row: (typeof AUDITED_PREVIEW_PAYMENTS)[number]): AuditedPayment {
  const synthetic = row.classification === "synthetic-seed";
  const paidAt = new Date(row.provider === "DEV" && !synthetic
    ? "2026-09-30T23:14:38.921Z"
    : "2026-09-30T02:20:32.625Z");
  return {
    id: row.id,
    listingId: row.listingId,
    paymentProvider: row.provider,
    providerReference: synthetic ? `seed:demo:ref:${row.id}` : row.provider === "DEV" ? "sim_checkout" : "ripple-reference",
    providerPaymentId: synthetic ? `seed:demo:pay:${row.id}` : "provider-payment",
    type: "FEATURED",
    status: "SUCCEEDED",
    amount: 500,
    currency: "gbp",
    refundedAt: null,
    featuredAppliedAt: null,
    createdAt: paidAt,
    updatedAt: paidAt,
    lastProviderEventAt: paidAt,
    lastProviderEventType: synthetic ? null : row.provider === "DEV" ? "sample.succeeded" : "payment.received",
    listing: synthetic ? {
      status: "LIVE",
      featured: true,
      statusEvents: [{ action: "APPROVE", createdAt: new Date("2026-09-29T02:00:00Z") }],
    } : {
      status: "TAKEN_DOWN",
      featured: false,
      statusEvents: row.provider === "DEV" ? [
        { action: "SUBMIT", createdAt: new Date("2026-09-30T20:54:16.918Z") },
        { action: "APPROVE", createdAt: new Date("2026-09-30T23:14:00.180Z") },
        { action: "TAKE_DOWN", createdAt: new Date("2026-10-01T00:29:36.586Z") },
      ] : [
        { action: "SUBMIT", createdAt: new Date("2026-09-29T23:32:16.865Z") },
        { action: "APPROVE", createdAt: new Date("2026-09-30T02:05:40.155Z") },
        { action: "TAKE_DOWN", createdAt: new Date("2026-09-30T11:24:18.206Z") },
      ],
    },
  };
}

describe("legacy Featured reconciliation gate", () => {
  const previewRows = AUDITED_PREVIEW_PAYMENTS.map(candidate);

  it("uses the audited exact set and classifies 24 synthetic and two applied payments", () => {
    expect(expectedManifest("preview")).toHaveLength(26);
    expect(expectedManifest("preview").filter((row) => row.classification === "synthetic-seed")).toHaveLength(24);
    expect(expectedManifest("preview").filter((row) => row.classification === "applied-before-takedown")).toHaveLength(2);
    expect(validateReconciliationSet("preview", previewRows)).toHaveLength(26);
    expect(validateReconciliationSet("production", [])).toHaveLength(0);
  });

  it("refuses missing, unexpected, duplicate, and provenance-mismatched candidates", () => {
    expect(() => validateReconciliationSet("preview", previewRows.slice(1))).toThrow("candidate set mismatch");
    expect(() => validateReconciliationSet("preview", [...previewRows, { ...previewRows[0], id: "new-payment" }])).toThrow("candidate set mismatch");
    expect(() => validateReconciliationSet("preview", [...previewRows, previewRows[0]])).toThrow("candidate set mismatch");
    const rows = [...previewRows];
    rows[0] = { ...rows[0], providerReference: "not-seed" };
    expect(() => validateReconciliationSet("preview", rows)).toThrow("Synthetic seed provenance mismatch");
  });

  it("requires approval, payment, and take-down ordering for real/sample payments", () => {
    const rows = [...previewRows];
    const last = rows[25];
    rows[25] = { ...last, lastProviderEventAt: new Date("2026-10-01T01:00:00Z") };
    expect(() => validateReconciliationSet("preview", rows)).toThrow("ordering is not proven");
  });

  it("preserves updatedAt through mocked writes so reconciliation can be rerun", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { payment: { updateMany } } as never;
    const planned = validateReconciliationSet("preview", previewRows);
    expect(await applyReconciliationUpdates(tx, planned)).toBe(26);

    const calls = updateMany.mock.calls.map(([args]) => args as {
      where: { id: string };
      data: { featuredAppliedAt: Date; updatedAt: Date };
    });
    const updatedRows = previewRows.map((row) => {
      const write = calls.find((call) => call.where.id === row.id)!;
      return { ...row, featuredAppliedAt: write.data.featuredAppliedAt, updatedAt: write.data.updatedAt };
    });
    expect(updatedRows[0].updatedAt).toEqual(previewRows[0].updatedAt);
    expect(validateReconciliationSet("preview", updatedRows)).toHaveLength(26);
  });

  it("defaults to dry-run and requires an explicit target", () => {
    expect(() => parseArgs([])).toThrow("--target preview|production");
    expect(parseArgs(["--target", "preview"])).toEqual({ target: "preview", apply: false });
    expect(parseArgs(["--target", "preview", "--apply"])).toEqual({ target: "preview", apply: true });
    expect(() => parseArgs(["--target", "production", "--force"])).toThrow("Unknown or repeated reconciliation argument");
  });
});
