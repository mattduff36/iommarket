import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "prisma/migrations/20260928220000_pending_dealer_upgrade_offers/migration.sql",
  ),
  "utf8",
);

describe("pending dealer upgrade migration", () => {
  it("allows only one pending offer per user", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerUpgradeOffer_one_pending_per_user_key"',
    );
    expect(migration).toContain('WHERE "status" = \'PENDING\'');
  });

  it("enforces coherent immutable terminal states and receipts", () => {
    expect(migration).toContain(
      'CONSTRAINT "DealerUpgradeOffer_terminal_state_check"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "DealerUpgradeOffer_terminal_state_immutable"',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "DealerUpgradeAcceptance_immutable"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "DealerUpgradeAcceptance_offerId_key"',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("offerId", "userId") REFERENCES "DealerUpgradeOffer"("id", "userId")',
    );
    expect(migration).toContain(
      'CONSTRAINT "DealerUpgradeAcceptance_source_check"',
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON \"DealerUpgradeOffer\"");
  });

  it("keeps both tables private from PostgREST", () => {
    expect(migration).toContain(
      'ALTER TABLE "public"."DealerUpgradeOffer" ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE "public"."DealerUpgradeAcceptance" ENABLE ROW LEVEL SECURITY',
    );
  });
});
