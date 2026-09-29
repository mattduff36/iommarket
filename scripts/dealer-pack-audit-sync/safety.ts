import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PREVIEW_PROJECT_REF,
  PREVIEW_DB_HOST,
  isAllowedPreviewDatabaseUrl,
} from "../wipe-preview-marketplace/target";
import { parseArgValue } from "../prod-mirror/safety";
import type { PreviewPackAuditPlan } from "./types";
import { REQUIRED_BACKUP_ID } from "./types";
import type { ProductionAuditPlan } from "./production-types";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_BACKUP_ID,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
} from "./production-types";
import { PRODUCTION_POOLER_USER } from "../onboard-founding-dealers/safety";

export const PREVIEW_CONFIRM_DB = `${PREVIEW_DB_HOST}/postgres`;
export const APPLY_CONFIRM_PHRASE =
  `yes exact-sync dealer preview packs ${PREVIEW_PROJECT_REF}`;
export const PRODUCTION_APPLY_CONFIRM_PHRASE =
  `yes exact-sync five production dealer accounts ${PRODUCTION_PROJECT_REF}`;

export function assertPreviewBinding(input: {
  databaseUrl: string | undefined;
  projectRef: string;
  confirmDb: string;
}) {
  if (!isAllowedPreviewDatabaseUrl(input.databaseUrl)) {
    throw new Error("Refusing audit sync: database URL is not the preview target.");
  }
  if (input.projectRef !== PREVIEW_PROJECT_REF) {
    throw new Error("Refusing audit sync: preview project ref mismatch.");
  }
  if (input.confirmDb !== PREVIEW_CONFIRM_DB) {
    throw new Error("Refusing audit sync: preview database confirmation mismatch.");
  }
}

export function assertApplySafety(input: {
  argv: string[];
  plan: PreviewPackAuditPlan;
  databaseUrl: string | undefined;
}) {
  const value = (name: string) => parseArgValue(input.argv, name);
  assertPreviewBinding({
    databaseUrl: input.databaseUrl,
    projectRef: value("preview-ref") ?? "",
    confirmDb: value("confirm-db") ?? "",
  });
  if (value("allow") !== "1") {
    throw new Error("Refusing audit sync: --allow=1 is required.");
  }
  if (value("backup-id") !== REQUIRED_BACKUP_ID) {
    throw new Error("Refusing audit sync: required backup ID mismatch.");
  }
  if (value("plan-fingerprint") !== input.plan.fingerprint) {
    throw new Error("Refusing audit sync: --plan-fingerprint mismatch.");
  }
  if (value("plan-count") !== String(input.plan.actionCount)) {
    throw new Error("Refusing audit sync: --plan-count mismatch.");
  }
  if (value("confirm") !== APPLY_CONFIRM_PHRASE) {
    throw new Error(`Refusing audit sync: --confirm must be "${APPLY_CONFIRM_PHRASE}".`);
  }
  if (
    input.plan.target.projectRef !== PREVIEW_PROJECT_REF ||
    input.plan.target.confirmDb !== PREVIEW_CONFIRM_DB
  ) {
    throw new Error("Refusing audit sync: frozen plan target mismatch.");
  }
  if (input.plan.backupId !== REQUIRED_BACKUP_ID) {
    throw new Error("Refusing audit sync: frozen plan backup mismatch.");
  }
}

interface BackupManifest {
  id: string;
  workstream: string;
  targetRef: string;
  confirmDb: string;
  files: Array<{ name: string; sha256: string; bytes: number }>;
}

const REQUIRED_BACKUP_FILES = new Set([
  "waitlist.json",
  "counts.json",
  "auth-instance.json",
  "truncate.sql",
  "public-auth.data.sql",
]);

function verifyBackup(input: {
  cwd: string;
  backupId: string;
  projectRef: string;
  confirmDb: string;
}) {
  const dir = resolve(input.cwd, ".local", "db-backups", input.backupId);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Refusing audit sync: backup ${input.backupId} manifest was not found.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (
    manifest.id !== input.backupId ||
    manifest.workstream !== "prod-mirror-20260831" ||
    manifest.targetRef !== input.projectRef ||
    manifest.confirmDb !== input.confirmDb
  ) {
    throw new Error("Refusing audit sync: backup manifest target mismatch.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Refusing audit sync: backup manifest has no file hashes.");
  }
  const names = new Set(manifest.files.map((record) => record.name));
  if (
    names.size !== REQUIRED_BACKUP_FILES.size ||
    [...REQUIRED_BACKUP_FILES].some((name) => !names.has(name))
  ) {
    throw new Error("Refusing audit sync: backup artifact set is incomplete.");
  }
  for (const record of manifest.files) {
    const path = join(dir, record.name);
    if (!existsSync(path)) {
      throw new Error(`Refusing audit sync: backup file missing (${record.name}).`);
    }
    const bytes = readFileSync(path);
    if (
      record.bytes !== bytes.length ||
      bytes.length === 0 ||
      (record.name === "public-auth.data.sql" && bytes.length < 1_000_000)
    ) {
      throw new Error(`Refusing audit sync: backup byte count is invalid (${record.name}).`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
      throw new Error(`Refusing audit sync: backup hash mismatch (${record.name}).`);
    }
  }
  return manifest;
}

export function verifyRequiredBackup(
  cwd = process.cwd(),
  backupId = REQUIRED_BACKUP_ID,
) {
  return verifyBackup({
    cwd,
    backupId,
    projectRef: PREVIEW_PROJECT_REF,
    confirmDb: PREVIEW_CONFIRM_DB,
  });
}

export function assertProductionBinding(input: {
  databaseUrl: string | undefined;
  projectRef: string;
  confirmDb: string;
}) {
  let parsed: URL;
  try {
    parsed = new URL(input.databaseUrl ?? "");
  } catch {
    throw new Error("Refusing production audit sync: invalid database URL.");
  }
  const expectedHost = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
  const isDirect =
    parsed.hostname.toLowerCase() === expectedHost &&
    parsed.username === "postgres";
  const isSessionPooler =
    parsed.hostname.toLowerCase().endsWith(".pooler.supabase.com") &&
    decodeURIComponent(parsed.username).toLowerCase() ===
      PRODUCTION_POOLER_USER.toLowerCase() &&
    parsed.port === "5432";
  if (
    (!isDirect && !isSessionPooler) ||
    input.projectRef !== PRODUCTION_PROJECT_REF ||
    input.confirmDb !== PRODUCTION_CONFIRM_DB
  ) {
    throw new Error("Refusing production audit sync: production target binding mismatch.");
  }
}

export function verifyProductionBackup(cwd = process.cwd()) {
  return verifyBackup({
    cwd,
    backupId: PRODUCTION_BACKUP_ID,
    projectRef: PRODUCTION_PROJECT_REF,
    confirmDb: PRODUCTION_CONFIRM_DB,
  });
}

export function assertProductionApplySafety(input: {
  argv: string[];
  plan: ProductionAuditPlan;
  databaseUrl: string | undefined;
}) {
  const value = (name: string) => parseArgValue(input.argv, name);
  assertProductionBinding({
    databaseUrl: input.databaseUrl,
    projectRef: value("production-ref") ?? value("dest-ref") ?? "",
    confirmDb: value("confirm-db") ?? "",
  });
  if (value("allow") !== "1") {
    throw new Error("Refusing production audit sync: --allow=1 is required.");
  }
  if (value("backup-id") !== PRODUCTION_BACKUP_ID) {
    throw new Error("Refusing production audit sync: required backup ID mismatch.");
  }
  if (value("plan-fingerprint") !== input.plan.fingerprint) {
    throw new Error("Refusing production audit sync: --plan-fingerprint mismatch.");
  }
  if (value("plan-count") !== String(input.plan.actionCount)) {
    throw new Error("Refusing production audit sync: --plan-count mismatch.");
  }
  if (value("confirm") !== PRODUCTION_APPLY_CONFIRM_PHRASE) {
    throw new Error(
      `Refusing production audit sync: --confirm must be "${PRODUCTION_APPLY_CONFIRM_PHRASE}".`,
    );
  }
  const actualKeys = input.plan.accounts.map((account) => account.dealerKey);
  const expectedKeys = PRODUCTION_ACCOUNTS
    .map((account) => account.dealerKey)
    .filter((key) => actualKeys.includes(key));
  if (
    input.plan.target.projectRef !== PRODUCTION_PROJECT_REF ||
    input.plan.target.confirmDb !== PRODUCTION_CONFIRM_DB ||
    input.plan.backupId !== PRODUCTION_BACKUP_ID ||
    actualKeys.length === 0 ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
  ) {
    throw new Error("Refusing production audit sync: frozen target/account binding mismatch.");
  }
  const blocked = input.plan.accounts.filter(
    (account) => !account.applicable || account.blockers.length > 0,
  );
  if (blocked.length > 0) {
    throw new Error(
      `Refusing production audit sync: plan is non-applicable (${blocked
        .map((account) => account.dealerKey)
        .join(",")}).`,
    );
  }
}
