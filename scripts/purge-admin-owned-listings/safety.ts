import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
} from "../wipe-preview-marketplace/target";

export const ADMIN_OWNED_LISTING_EMAILS = [
  "admin@mpdee.co.uk",
  "d.p.marshall@hotmail.co.uk",
] as const;

export const PURGE_CONFIRMATION = "purge-admin-owned-listings-2026-09-29";

export type PurgeEnvironment = "preview" | "production";

export function projectRefForEnvironment(environment: PurgeEnvironment) {
  return environment === "production" ? PRODUCTION_PROJECT_REF : PREVIEW_PROJECT_REF;
}

export function assertAdminListingOwners(
  users: Array<{ email: string; role: string; deletedAt: Date | null }>,
) {
  const actual = [...users]
    .map((user) => ({
      email: user.email.trim().toLowerCase(),
      role: user.role,
      deletedAt: user.deletedAt,
    }))
    .sort((left, right) => left.email.localeCompare(right.email));
  const expected = [...ADMIN_OWNED_LISTING_EMAILS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((user, index) => user.email !== expected[index])
  ) {
    throw new Error("Refusing purge: admin account set does not match the approved emails.");
  }
  for (const user of actual) {
    if (user.role !== "ADMIN" || user.deletedAt) {
      throw new Error(`Refusing purge: ${user.email} is not an active admin.`);
    }
  }
}

export function assertPurgeBackup(input: {
  cwd?: string;
  backupId: string;
  environment: PurgeEnvironment;
}) {
  const manifest = JSON.parse(
    readFileSync(join(input.cwd ?? process.cwd(), ".local/db-backups", input.backupId, "manifest.json"), "utf8"),
  ) as { id?: string; targetRef?: string };
  if (manifest.id !== input.backupId) {
    throw new Error("Refusing purge: backup manifest id does not match.");
  }
  if (manifest.targetRef !== projectRefForEnvironment(input.environment)) {
    throw new Error("Refusing purge: backup target does not match the selected environment.");
  }
}

export function assertPurgeApplyAllowed(input: {
  apply: boolean;
  confirmation: string | undefined;
  backupId: string | undefined;
  environment: PurgeEnvironment;
  cwd?: string;
}) {
  if (!input.apply) return;
  if (input.confirmation !== PURGE_CONFIRMATION) {
    throw new Error(`Refusing purge: --confirm must be ${PURGE_CONFIRMATION}.`);
  }
  if (!input.backupId) throw new Error("Refusing purge: --backup-id is required.");
  assertPurgeBackup({
    cwd: input.cwd,
    backupId: input.backupId,
    environment: input.environment,
  });
}
