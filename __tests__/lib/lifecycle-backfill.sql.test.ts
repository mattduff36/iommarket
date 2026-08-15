import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONTAINER = "iommarket-alr-dat-001";
const PORT = 55432;
const CONNECTION = {
  host: "127.0.0.1",
  port: PORT,
  user: "postgres",
  password: "alr",
  database: "alr_dat_001",
};

const backfillSql = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260815002000_lifecycle_backfill/migration.sql"),
  "utf8",
);

const schemaSql = `
CREATE TYPE "ListingStatus" AS ENUM (
  'DRAFT', 'PENDING', 'APPROVED', 'LIVE', 'SOLD', 'EXPIRED', 'TAKEN_DOWN', 'REJECTED'
);
CREATE TYPE "ListingStatusEventSource" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'PAYMENT');
CREATE TYPE "ListingLifecycleAction" AS ENUM (
  'SUBMIT', 'APPROVE', 'REJECT', 'TAKE_DOWN', 'EXPIRE', 'MARK_SOLD', 'RENEW',
  'REINSTATE_LIVE', 'RETURN_TO_DRAFT', 'ACCOUNT_DISABLE', 'ACCOUNT_DISABLE_PENDING',
  'SYSTEM_BACKFILL'
);
CREATE TABLE "Listing" (
  id TEXT PRIMARY KEY,
  status "ListingStatus" NOT NULL,
  "expiresAt" TIMESTAMP
);
CREATE TABLE "ListingStatusEvent" (
  id TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL REFERENCES "Listing"(id),
  "fromStatus" "ListingStatus",
  "toStatus" "ListingStatus" NOT NULL,
  source "ListingStatusEventSource" NOT NULL,
  action "ListingLifecycleAction",
  notes TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

const fixtureSql = `
INSERT INTO "Listing" (id, status, "expiresAt") VALUES
  ('approved_live', 'APPROVED', NOW() + INTERVAL '7 days'),
  ('approved_pending_past', 'APPROVED', NOW() - INTERVAL '1 day'),
  ('approved_pending_null', 'APPROVED', NULL),
  ('taken_down_reject', 'TAKEN_DOWN', NULL),
  ('taken_down_keep_live', 'TAKEN_DOWN', NULL),
  ('taken_down_keep_none', 'TAKEN_DOWN', NULL),
  ('already_live', 'LIVE', NOW() + INTERVAL '3 days');

INSERT INTO "ListingStatusEvent" (id, "listingId", "fromStatus", "toStatus", source, "createdAt") VALUES
  ('evt_reject_old', 'taken_down_reject', 'LIVE', 'TAKEN_DOWN', 'ADMIN', NOW() - INTERVAL '2 days'),
  ('evt_reject_latest', 'taken_down_reject', 'PENDING', 'TAKEN_DOWN', 'ADMIN', NOW() - INTERVAL '1 hour'),
  ('evt_keep_live', 'taken_down_keep_live', 'LIVE', 'TAKEN_DOWN', 'ADMIN', NOW() - INTERVAL '1 hour');
`;

function docker(args: string[]) {
  return execFileSync("docker", args, { encoding: "utf8" });
}

function dockerAvailable() {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new Client(CONNECTION);
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("Disposable Postgres did not become ready");
}

describe.skipIf(!dockerAvailable())(
  "lifecycle backfill disposable database ALR-DAT-001",
  () => {
    let client: Client;

    beforeAll(async () => {
      try {
        docker(["rm", "-f", CONTAINER]);
      } catch {
        // No leftover container from a previous run.
      }
      docker([
        "run",
        "--rm",
        "-d",
        "--name",
        CONTAINER,
        "-e",
        "POSTGRES_PASSWORD=alr",
        "-e",
        "POSTGRES_DB=alr_dat_001",
        "-p",
        `${PORT}:5432`,
        "postgres:16",
      ]);
      await waitForPostgres();
      client = new Client(CONNECTION);
      await client.connect();
      await client.query(schemaSql);
      await client.query(fixtureSql);
      await client.query(backfillSql);
    }, 180_000);

    afterAll(async () => {
      await client?.end().catch(() => undefined);
      try {
        docker(["rm", "-f", CONTAINER]);
      } catch {
        // Container may already have been removed.
      }
    });

    it("applies conservative mapping to real rows and leaves ambiguous takedowns", async () => {
      const { rows } = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM "Listing" ORDER BY id',
      );
      const byId = Object.fromEntries(rows.map((row) => [row.id, row.status]));

      expect(byId).toMatchObject({
        approved_live: "LIVE",
        approved_pending_past: "PENDING",
        approved_pending_null: "PENDING",
        taken_down_reject: "REJECTED",
        taken_down_keep_live: "TAKEN_DOWN",
        taken_down_keep_none: "TAKEN_DOWN",
        already_live: "LIVE",
      });

      const events = await client.query<{ listingId: string; action: string }>(
        'SELECT "listingId", action FROM "ListingStatusEvent" WHERE action = \'SYSTEM_BACKFILL\' ORDER BY "listingId"',
      );
      expect(events.rows.map((row) => row.listingId)).toEqual([
        "approved_live",
        "approved_pending_null",
        "approved_pending_past",
        "taken_down_reject",
      ]);
    });
  },
);
