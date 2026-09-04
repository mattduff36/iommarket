import { createHash } from "node:crypto";
import {
  DELETE_AUTH_EMAILS,
  KEEP_ACCOUNT_EMAILS,
  PREVIEW_PROJECT_REF,
} from "../wipe-preview-marketplace/target";
import { PREVIEW_SEED_KEEP_EMAILS } from "../seed-preview-marketplace/target";
import type { VerifiedBackup } from "./backups";
import type { PreserveFingerprint } from "./fingerprint";

export const PREVIEW_REBUILD_TOKEN_PREFIX = "yes wipe preview";

export interface RebuildSnapshot {
  projectRef: string;
  keepEmails: string[];
  deleteAuthEmails: string[];
  prismaEmails: string[];
  authEmails: string[];
  listingCount: number;
  listingByStatus: Record<string, number>;
  dealerNames: string[];
  backupIds: { preview: string; production: string };
  backupHashes: { preview: string; production: string };
  preserve: PreserveFingerprint;
  planned: {
    live: number;
    sold: number;
    expired: number;
    dealers: number;
    privateSellers: number;
  };
}

export function dumpFileHash(backup: VerifiedBackup) {
  const dump = backup.manifest.files.find((file) => file.name === "public-auth.data.sql");
  if (!dump) throw new Error(`Refusing rebuild: ${backup.kind} dump hash missing.`);
  return dump.sha256;
}

export function buildRebuildSnapshot(input: {
  prismaEmails: string[];
  authEmails: string[];
  deleteAuthEmails: string[];
  listingCount: number;
  listingByStatus: Record<string, number>;
  dealerNames: string[];
  backups: { preview: VerifiedBackup; production: VerifiedBackup };
  preserve: PreserveFingerprint;
  planned: RebuildSnapshot["planned"];
}): RebuildSnapshot {
  return {
    projectRef: PREVIEW_PROJECT_REF,
    keepEmails: [...PREVIEW_SEED_KEEP_EMAILS],
    deleteAuthEmails: [...input.deleteAuthEmails].sort(),
    prismaEmails: [...input.prismaEmails].sort(),
    authEmails: [...KEEP_ACCOUNT_EMAILS, ...DELETE_AUTH_EMAILS].sort(),
    listingCount: input.listingCount,
    listingByStatus: Object.fromEntries(
      Object.entries(input.listingByStatus).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    dealerNames: [...input.dealerNames].sort(),
    backupIds: {
      preview: input.backups.preview.manifest.id,
      production: input.backups.production.manifest.id,
    },
    backupHashes: {
      preview: dumpFileHash(input.backups.preview),
      production: dumpFileHash(input.backups.production),
    },
    preserve: input.preserve,
    planned: input.planned,
  };
}

export function confirmationToken(snapshot: RebuildSnapshot) {
  const digest = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 12);
  return `${PREVIEW_REBUILD_TOKEN_PREFIX} ${PREVIEW_PROJECT_REF} ${digest}`;
}

export function assertConfirmationToken(snapshot: RebuildSnapshot, actual?: string) {
  const expected = confirmationToken(snapshot);
  if (!actual?.trim()) {
    throw new Error("Refusing rebuild: confirmation token required.");
  }
  if (actual.trim() !== expected) {
    throw new Error("Refusing rebuild: confirmation token does not match snapshot.");
  }
}

export function formatConfirmationCard(snapshot: RebuildSnapshot) {
  return [
    "PREVIEW REBUILD CONFIRMATION",
    `project=${snapshot.projectRef}`,
    `keep=${snapshot.keepEmails.join(",")}`,
    `delete_auth=${snapshot.deleteAuthEmails.join(",")}`,
    `prisma_users=${snapshot.prismaEmails.length}`,
    `auth_users=${snapshot.authEmails.join(",")}`,
    `listings=${snapshot.listingCount}`,
    `dealers=${snapshot.dealerNames.length}`,
    `preview_backup=${snapshot.backupIds.preview}`,
    `preview_dump_sha256=${snapshot.backupHashes.preview}`,
    `production_backup=${snapshot.backupIds.production}`,
    `production_dump_sha256=${snapshot.backupHashes.production}`,
    `planned_live=${snapshot.planned.live}`,
    `planned_sold=${snapshot.planned.sold}`,
    `planned_expired=${snapshot.planned.expired}`,
    `token=${confirmationToken(snapshot)}`,
    "",
  ].join("\n");
}
