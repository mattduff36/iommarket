import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readMigration(name: string) {
  return readFileSync(
    resolve(process.cwd(), "prisma", "migrations", name, "migration.sql"),
    "utf8",
  );
}

describe("production migration contract MIG-001", () => {
  it("creates the claimed Ripple inbox state and enables RLS on every new table", () => {
    const ripple = readMigration("20260815123000_ripple_webhook_inbox");
    const revisions = readMigration(
      "20260815140000_listing_revisions_and_notifications",
    );
    const rls = readMigration(
      "20260815150000_enable_rls_payment_and_revision_tables",
    );

    expect(ripple).toContain("'PROCESSING'");
    expect(ripple).toContain(
      'CREATE UNIQUE INDEX "SubscriptionCharge_paymentReference_key"',
    );
    expect(ripple).toContain(
      'CREATE UNIQUE INDEX "PaymentWebhookInbox_bodyHash_key"',
    );
    expect(revisions).toContain(
      'CREATE UNIQUE INDEX "ListingRevision_open_listingId_key"',
    );
    expect(revisions).toContain("WHERE \"status\" IN ('DRAFT', 'PENDING')");

    for (const table of [
      "SubscriptionCharge",
      "PaymentWebhookInbox",
      "ListingRevision",
      "ListingRevisionImage",
      "ListingRevisionAttributeValue",
    ]) {
      expect(rls).toContain(
        `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  });

  it("creates the cost ledger with unique settlements and private RLS", () => {
    const costs = readMigration("20260817010000_project_cost_ledger");
    expect(costs).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "CostSettlement_costEntryId_key"');
    expect(costs).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceRequest_openSlot_key"');
    expect(costs).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_sourceSnapshotId_kind_key"');
    expect(costs).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "CostEntry_reversesEntryId_key"');
    expect(costs).toContain("cost_entry_immutable");
    expect(costs).toContain("cost ledger rows are append-only");

    for (const table of [
      "CostLedgerConfig",
      "FxRateSnapshot",
      "CostSourceSnapshot",
      "CostEntry",
      "CostSyncRun",
      "CostSyncLock",
      "InvoiceRequest",
      "InvoiceRequestLine",
      "CostSettlement",
      "CostWorkflowEvent",
      "CostEmailOutbox",
    ]) {
      expect(costs).toContain(
        `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  });

  it("retains the lifecycle data-migration rollback mapping", () => {
    const backfill = readMigration("20260815002000_lifecycle_backfill");
    expect(backfill).toContain(
      "Rollback mapping if old application code is redeployed: REJECTED -> TAKEN_DOWN",
    );
    expect(backfill).toContain("RETURNING id");
    expect(backfill).toContain("'SYSTEM_BACKFILL'");
  });

  it("adds withdrawal as an enum-only production migration MD-LIFE-001", () => {
    const withdrawal = readMigration(
      "20260817034000_listing_submission_withdrawal",
    );
    expect(withdrawal).toContain(
      'ALTER TYPE "ListingLifecycleAction" ADD VALUE IF NOT EXISTS \'WITHDRAW\'',
    );
    expect(withdrawal).not.toMatch(/\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/);
  });

  it("adds the vehicle catalogue without constraining listing EAV values", () => {
    const catalogue = readMigration("20260817014500_vehicle_catalogue");
    for (const table of ["VehicleMake", "VehicleModel", "VehicleModelAlias"]) {
      expect(catalogue).toContain(`CREATE TABLE "${table}"`);
      expect(catalogue).toContain(
        `ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
    expect(catalogue).toContain('"VehicleMake_normalizedName_key"');
    expect(catalogue).toContain('"VehicleModel_makeId_normalizedName_key"');
    expect(catalogue).toContain('"VehicleModelAlias_makeId_normalizedName_key"');
    expect(catalogue).toContain('"enforce_vehicle_model_name_uniqueness"');
    expect(catalogue).toContain('"VehicleModelAlias_makeId_fkey"');
    expect(catalogue).not.toContain('ALTER TABLE "ListingAttributeValue"');
    expect(catalogue).not.toContain("DELETE FROM");
    expect(catalogue).not.toContain("UPDATE \"ListingAttributeValue\"");
  });
});
