import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATABASE_SYNC_SCOPE,
  EXCLUDED_SYNC_TABLES,
  excludedSyncTable,
} from "@/lib/database-sync/scope-policy";

const migration = fs.readFileSync(
  path.join(
    process.cwd(),
    "prisma/migrations/20261005133000_payment_reconciliation_recovery/migration.sql",
  ),
  "utf8",
);
const revenuePage = fs.readFileSync(
  path.join(process.cwd(), "app/(admin)/admin/revenue/page.tsx"),
  "utf8",
);

describe("payment reconciliation migration", () => {
  it("PAY-MIG-001 is additive, backfills review attempts, and enables RLS", () => {
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toMatch(/UPDATE\s+"Payment"\s+SET/i);
    expect(migration).toContain(
      "'REVIEW'::\"PaymentCheckoutAttemptStatus\"",
    );
    expect(migration).toContain(
      "'LEGACY_RECORDED'::\"ProviderPaymentClaimSource\"",
    );
    for (const table of [
      "PaymentCheckoutAttempt",
      "PaymentCheckoutObservation",
      "ProviderPaymentClaim",
      "PaymentReconciliation",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  });

  it("PAY-SYNC-001 explicitly excludes environment-local reconciliation evidence", () => {
    expect(DATABASE_SYNC_SCOPE).toBe("marketplace-exclusions-v2");
    for (const table of [
      "PaymentCheckoutAttempt",
      "PaymentCheckoutObservation",
      "ProviderPaymentClaim",
      "PaymentReconciliation",
    ]) {
      expect(EXCLUDED_SYNC_TABLES).toContain(table);
      expect(excludedSyncTable(table)).toBe(true);
    }
  });

  it("PAY-PURGE-001 keeps account, listing, payment, and charge deletion unblocked", () => {
    for (const constraint of [
      /PaymentCheckoutAttempt_userId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /PaymentCheckoutAttempt_listingId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /PaymentCheckoutAttempt_dealerId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /PaymentCheckoutAttempt_paymentId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /ProviderPaymentClaim_paymentId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /ProviderPaymentClaim_subscriptionChargeId_fkey"[\s\S]*?ON DELETE CASCADE/,
      /PaymentReconciliation_attemptId_fkey"[\s\S]*?ON DELETE CASCADE/,
    ]) {
      expect(migration).toMatch(constraint);
    }
    expect(migration).toMatch(
      /ProviderPaymentClaim_attemptId_fkey"[\s\S]*?ON DELETE SET NULL/,
    );
  });

  it("PAY-CRON-004 persists recoverable alert leases and idempotency keys", () => {
    expect(migration).toContain('"alertLeaseUntil" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "dedupeKey" TEXT');
    expect(migration).toContain('"MonitoringEvent_dedupeKey_key"');
  });

  it("PAY-REV-001 persists refunds and excludes them from recognized revenue", () => {
    expect(migration).toContain('ADD COLUMN "refundedAt" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "refundEventId" TEXT');
    expect(revenuePage).toMatch(
      /subscriptionCharge\.aggregate\(\{[\s\S]*?refundedAt: null/,
    );
    expect(revenuePage).toContain("getPaidSubscriptionEntitlementWhere()");
  });
});
