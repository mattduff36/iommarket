import { describe, expect, it } from "vitest";
import { resolveAuthInstanceIdPlan } from "../../scripts/prod-mirror/auth-instance";
import { AUTH_RESTORE_SKIP_TABLES } from "../../scripts/prod-mirror/constants";
import { pgDumpDataArgs, truncatePublicAndAuthSql } from "../../scripts/prod-mirror/dump";
import { pendingPrismaMigrations } from "../../scripts/prod-mirror/migrations";
import { assertStorageCopyEquivalent, assertStorageProofReady, nextStorageListOffset } from "../../scripts/prod-mirror/storage-proof";

describe("prod-mirror restore plan helpers", () => {
  it("excludes ephemeral auth tables from pg_dump and truncates users before public data", () => {
    const args = pgDumpDataArgs("postgresql://postgres:x@db.example/postgres", "dump.sql");
    for (const table of AUTH_RESTORE_SKIP_TABLES) {
      expect(args).toContain(`--exclude-table=auth.${table}`);
    }
    expect(truncatePublicAndAuthSql(["WaitlistUser", "User"])).toContain(
      "TRUNCATE TABLE auth.identities, auth.users CASCADE",
    );
  });

  it("rewrites auth instance_id when source and destination differ", () => {
    expect(resolveAuthInstanceIdPlan("aaaa", "aaaa")).toEqual({ action: "preserve" });
    expect(resolveAuthInstanceIdPlan("aaaa", "bbbb")).toEqual({ action: "rewrite", to: "bbbb" });
    expect(resolveAuthInstanceIdPlan(null, "bbbb")).toEqual({ action: "rewrite", to: "bbbb" });
    expect(resolveAuthInstanceIdPlan("aaaa", null).action).toBe("fail");
  });

  it("requires storage path and size equivalence and uses etag when present", () => {
    const source = [{ path: "a/logo.png", size: 12, etag: "1" }];
    expect(() =>
      assertStorageCopyEquivalent(source, [{ path: "a/logo.png", size: 12, etag: "1" }]),
    ).not.toThrow();
    expect(() =>
      assertStorageCopyEquivalent(source, [{ path: "a/logo.png", size: 11, etag: "1" }]),
    ).toThrow("size mismatch");
  });

  it("pages storage listings past the 1000-object limit", () => {
    expect(nextStorageListOffset(1000, 1000, 0)).toBe(1000);
    expect(nextStorageListOffset(12, 1000, 1000)).toBeNull();
  });

  it("applies only Prisma migrations that are missing on the destination", () => {
    const pending = pendingPrismaMigrations(
      [
        { name: "20260823010000_dealer_preview_packs", checksum: "a", sql: "SELECT 1" },
        { name: "20260316120000_waitlist_users", checksum: "b", sql: "SELECT 1" },
      ],
      ["20260316120000_waitlist_users"],
    );
    expect(pending.map((item) => item.name)).toEqual(["20260823010000_dealer_preview_packs"]);
  });

  it("refuses URL rewrite without a completed storage copy proof", () => {
    expect(() => assertStorageProofReady(null)).toThrow("storage copy proof");
    expect(() =>
      assertStorageProofReady({
        equivalent: true,
        bucket: "user-avatars",
        objectCount: 1,
        paths: ["a/logo.png"],
      }),
    ).not.toThrow();
  });
});
