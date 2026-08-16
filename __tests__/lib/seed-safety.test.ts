import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSeedEnv } from "../../prisma/seed/env";
import { assertSeedGuards } from "../../prisma/seed/guards";
import {
  assertSeedSafety,
  isLiveSeedTarget,
  isLoopbackHost,
} from "../../prisma/seed/target";

describe("SEED-SAFE-001 live-target safeguards", () => {
  it("never loads destructive confirmations from environment files", () => {
    const directory = mkdtempSync(join(tmpdir(), "seed-env-"));
    const previousAllow = process.env.SEED_ALLOW;
    const previousDatabase = process.env.DATABASE_URL;
    const previousWritersPaused = process.env.SEED_WRITERS_PAUSED;
    try {
      delete process.env.SEED_ALLOW;
      delete process.env.DATABASE_URL;
      writeFileSync(
        join(directory, ".env.local"),
        "DATABASE_URL=postgresql://localhost/test\nSEED_ALLOW=1\nSEED_WRITERS_PAUSED=1\n",
      );
      loadSeedEnv(directory);
      expect(process.env.DATABASE_URL).toBe("postgresql://localhost/test");
      expect(process.env.SEED_ALLOW).toBeUndefined();
      expect(process.env.SEED_WRITERS_PAUSED).not.toBe("1");
    } finally {
      if (previousAllow === undefined) delete process.env.SEED_ALLOW;
      else process.env.SEED_ALLOW = previousAllow;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousWritersPaused === undefined) delete process.env.SEED_WRITERS_PAUSED;
      else process.env.SEED_WRITERS_PAUSED = previousWritersPaused;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses seed without SEED_ALLOW=1", () => {
    expect(() =>
      assertSeedSafety({}, { databaseHost: "localhost", redactedDatabase: "localhost/postgres" }),
    ).toThrow("SEED_ALLOW=1");
  });

  it("does not treat a non-loopback .local host as local", () => {
    expect(isLoopbackHost("prod-db.local")).toBe(false);
    expect(
      isLiveSeedTarget({
        seedTarget: "local",
        seedEnvFile: ".env.local",
        databaseHost: "prod-db.local",
      }),
    ).toBe(true);
  });

  it("does not treat a loopback host as live", () => {
    expect(
      isLiveSeedTarget({
        seedTarget: "local",
        seedEnvFile: ".env.local",
        databaseHost: "127.0.0.1",
      }),
    ).toBe(false);
  });

  it("requires full production confirmation for a remote host even when SEED_TARGET is omitted", () => {
    expect(
      isLiveSeedTarget({
        databaseHost: "aws-1-eu-west-2.pooler.supabase.com",
      }),
    ).toBe(true);
    expect(() =>
      assertSeedSafety(
        { SEED_ALLOW: "1" },
        {
          databaseHost: "aws-1-eu-west-2.pooler.supabase.com",
          redactedDatabase: "aws-1-eu-west-2.pooler.supabase.com/postgres",
        },
      ),
    ).toThrow("SEED_TARGET=production");
  });

  it("SEED_TARGET cannot downgrade a production env file", () => {
    expect(
      isLiveSeedTarget({
        seedTarget: "local",
        seedEnvFile: ".env.production",
        databaseHost: "localhost",
      }),
    ).toBe(true);
  });

  it("accepts a fully confirmed live target", () => {
    expect(() =>
      assertSeedSafety(
        {
          SEED_ALLOW: "1",
          SEED_TARGET: "production",
          SEED_ENV_FILE: ".env.production",
          SEED_BACKUP_ID: "backup-1",
          SEED_CONFIRM_DB: "db.example.com/postgres",
          SEED_WRITERS_PAUSED: "1",
        },
        {
          databaseHost: "db.example.com",
          redactedDatabase: "db.example.com/postgres",
        },
      ),
    ).not.toThrow();
  });
});

describe("SEED-HOLD-001 SEED-INBOX-001", () => {
  it("aborts on an intersecting unreleased legal hold", () => {
    expect(() =>
      assertSeedGuards({
        holds: [{ entityType: "LISTING", releasedAt: null }],
        inboxStatuses: ["PROCESSED"],
        preservedDeletionJobs: [],
      }),
    ).toThrow("legal hold");
  });

  it("allows released holds and denylisted hold types", () => {
    expect(() =>
      assertSeedGuards({
        holds: [
          { entityType: "LISTING", releasedAt: new Date() },
          { entityType: "WAITLIST_USER", releasedAt: null },
        ],
        inboxStatuses: ["PROCESSED", "QUARANTINED"],
        preservedDeletionJobs: [{ userId: "u1", status: "COMPLETED" }],
      }),
    ).not.toThrow();
  });

  it("aborts on replayable inbox rows", () => {
    expect(() =>
      assertSeedGuards({
        holds: [],
        inboxStatuses: ["PENDING"],
        preservedDeletionJobs: [],
      }),
    ).toThrow("PaymentWebhookInbox");
  });
});
