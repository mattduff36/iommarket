// Isolated PostgreSQL integration check. No application database is contacted.
// Set PGLITE_MODULE_PATH to an installed @electric-sql/pglite dist/index.js.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

if (!process.env.PGLITE_MODULE_PATH) {
  throw new Error("Set PGLITE_MODULE_PATH to a temporary PGlite installation.");
}
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE_PATH).href);
const db = new PGlite();
let checks = 0;
const sql = (name) => readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");

async function rejected(statement, pattern, setup = "") {
  await db.exec("BEGIN");
  try {
    if (setup) await db.exec(setup);
    await assert.rejects(db.exec(statement), pattern);
    checks++;
  } finally {
    await db.exec("ROLLBACK");
  }
}

try {
  await db.exec(`
    CREATE TABLE public."User" (id text PRIMARY KEY);
    CREATE TYPE public."PolicyAcceptanceSource" AS ENUM ('ADMIN_UPGRADE');
    INSERT INTO public."User" VALUES ('admin'), ('target'), ('other');
    CREATE ROLE purge_unprivileged;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO purge_unprivileged;
  `);
  await db.exec(await sql("20260928220000_pending_dealer_upgrade_offers"));
  await db.exec(`
    INSERT INTO "DealerUpgradeOffer"
      (id, "userId", "durationDays", status, "createdByAdminId", "acceptedAt", "updatedAt")
    VALUES ('offer-target', 'target', 30, 'ACCEPTED', 'admin', now(), now()),
           ('offer-other', 'other', 30, 'ACCEPTED', 'admin', now(), now());
    INSERT INTO "DealerUpgradeAcceptance"
      (id, "offerId", "userId", "bundleVersion", "policyVersions", "contentHashes", "acceptedAt")
    VALUES ('receipt-target', 'offer-target', 'target', 'v1', '{}', '{}', now()),
           ('receipt-other', 'offer-other', 'other', 'v1', '{}', '{}', now());
  `);
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'target\'', /immutable/);
  await rejected('DELETE FROM "DealerUpgradeOffer" WHERE "userId" = \'target\'', /immutable/);
  await db.exec(await sql("20261002120000_account_purge_upgrade_records"));

  await rejected("SELECT public.prepare_account_purge('')", /account ID is required/);
  await rejected("SELECT public.prepare_account_purge(NULL)", /account ID is required/);
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'target\'', /immutable/);
  await rejected('DELETE FROM "DealerUpgradeOffer" WHERE "userId" = \'target\'', /immutable/);
  const scoped = "SELECT public.prepare_account_purge('target')";
  await rejected('UPDATE "DealerUpgradeAcceptance" SET "bundleVersion" = \'changed\' WHERE "userId" = \'target\'', /immutable/, scoped);
  await rejected('UPDATE "DealerUpgradeOffer" SET "durationDays" = 60 WHERE "userId" = \'target\'', /immutable/, scoped);
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'other\'', /immutable/, scoped);
  await rejected('DELETE FROM "DealerUpgradeOffer" WHERE "userId" = \'other\'', /immutable/, scoped);

  await db.exec(`
    GRANT USAGE ON SCHEMA public TO purge_unprivileged;
    GRANT SELECT, DELETE ON "DealerUpgradeOffer", "DealerUpgradeAcceptance" TO purge_unprivileged;
    CREATE POLICY purge_test_offer ON "DealerUpgradeOffer" FOR ALL TO purge_unprivileged USING (true);
    CREATE POLICY purge_test_receipt ON "DealerUpgradeAcceptance" FOR ALL TO purge_unprivileged USING (true);
  `);
  await rejected(scoped, /permission denied for function/, "SET LOCAL ROLE purge_unprivileged");
  const bypassAttempt = "SET LOCAL ROLE purge_unprivileged; SELECT set_config('app.account_purge_user_id', 'target', true)";
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'target\'', /immutable/, bypassAttempt);
  await rejected('DELETE FROM "DealerUpgradeOffer" WHERE "userId" = \'target\'', /immutable/, bypassAttempt);

  await db.exec(`BEGIN; ${scoped}; COMMIT;`);
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'target\'', /immutable/);
  await db.exec(`BEGIN; ${scoped}; ROLLBACK;`);
  await rejected('DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = \'target\'', /immutable/);
  await db.exec(`
    BEGIN;
    ${scoped};
    DELETE FROM "DealerUpgradeAcceptance" WHERE "userId" = 'target';
    DELETE FROM "DealerUpgradeOffer" WHERE "userId" = 'target';
    DELETE FROM "User" WHERE id = 'target';
    COMMIT;
  `);
  const remaining = await db.query('SELECT "userId" FROM "DealerUpgradeAcceptance" ORDER BY "userId"');
  assert.deepEqual(remaining.rows, [{ userId: "other" }]);
  const users = await db.query('SELECT id FROM "User" ORDER BY id');
  assert.deepEqual(users.rows, [{ id: "admin" }, { id: "other" }]);
  checks += 2;
  console.log(`PASS: ${checks} isolated PostgreSQL migration checks; no application database contacted.`);
} finally {
  await db.close();
}
