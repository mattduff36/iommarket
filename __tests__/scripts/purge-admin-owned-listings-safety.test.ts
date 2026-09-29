import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_OWNED_LISTING_EMAILS,
  assertAdminListingOwners,
  assertPurgeApplyAllowed,
  PURGE_CONFIRMATION,
} from "../../scripts/purge-admin-owned-listings/safety";
import { PREVIEW_PROJECT_REF } from "../../scripts/wipe-preview-marketplace/target";

const admins = ADMIN_OWNED_LISTING_EMAILS.map((email) => ({
  email,
  role: "ADMIN",
  deletedAt: null,
}));

describe("admin-owned listing purge safety", () => {
  it("accepts only the two active admin accounts", () => {
    expect(() => assertAdminListingOwners(admins)).not.toThrow();
    expect(() =>
      assertAdminListingOwners([{ ...admins[0], role: "USER" }, admins[1]]),
    ).toThrow(/not an active admin/);
    expect(() => assertAdminListingOwners([admins[0]])).toThrow(/approved emails/);
  });

  it("requires the exact confirmation and a backup for that environment", () => {
    const cwd = mkdtempSync(join(tmpdir(), "admin-listing-purge-"));
    const backupId = "pmr-test";
    mkdirSync(join(cwd, ".local/db-backups", backupId), { recursive: true });
    writeFileSync(
      join(cwd, ".local/db-backups", backupId, "manifest.json"),
      JSON.stringify({ id: backupId, targetRef: PREVIEW_PROJECT_REF }),
    );

    expect(() =>
      assertPurgeApplyAllowed({
        apply: true,
        confirmation: "no",
        backupId,
        environment: "preview",
        cwd,
      }),
    ).toThrow(PURGE_CONFIRMATION);
    expect(() =>
      assertPurgeApplyAllowed({
        apply: true,
        confirmation: PURGE_CONFIRMATION,
        backupId,
        environment: "production",
        cwd,
      }),
    ).toThrow(/backup target/);
    expect(() =>
      assertPurgeApplyAllowed({
        apply: true,
        confirmation: PURGE_CONFIRMATION,
        backupId,
        environment: "preview",
        cwd,
      }),
    ).not.toThrow();
  });
});
