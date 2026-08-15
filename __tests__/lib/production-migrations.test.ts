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

  it("retains the lifecycle data-migration rollback mapping", () => {
    const backfill = readMigration("20260815002000_lifecycle_backfill");
    expect(backfill).toContain(
      "Rollback mapping if old application code is redeployed: REJECTED -> TAKEN_DOWN",
    );
    expect(backfill).toContain("RETURNING id");
    expect(backfill).toContain("'SYSTEM_BACKFILL'");
  });
});
