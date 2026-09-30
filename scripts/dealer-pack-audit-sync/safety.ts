import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  PREVIEW_PROJECT_REF,
  PREVIEW_DB_HOST,
  isAllowedPreviewDatabaseUrl,
} from "../wipe-preview-marketplace/target";
import { parseArgValue } from "../prod-mirror/safety";
import { assertProductionPreviewProvenance } from "./plan-file";
import type { PreviewPackAuditPlan } from "./types";
import type { ProductionAuditPlan } from "./production-types";
import {
  PRODUCTION_ACCOUNTS,
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  isTemporaryExcludedProductionAccount,
} from "./production-types";
import { PRODUCTION_POOLER_USER } from "../onboard-founding-dealers/safety";

export const PREVIEW_CONFIRM_DB = `${PREVIEW_DB_HOST}/postgres`;
export const APPLY_CONFIRM_PHRASE =
  `yes exact-sync dealer preview packs ${PREVIEW_PROJECT_REF}`;
export const PRODUCTION_APPLY_CONFIRM_PHRASE =
  `yes exact-sync four production dealer accounts ${PRODUCTION_PROJECT_REF}`;

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
  const cliBackupId = requireBackupId(value("backup-id"), "Refusing audit sync");
  if (cliBackupId !== input.plan.backupId) {
    throw new Error("Refusing audit sync: --backup-id does not match the frozen plan.");
  }
  if (!isSafeBackupId(input.plan.backupId)) {
    throw new Error("Refusing audit sync: frozen plan backup ID is invalid.");
  }
  assertPlanBackupFreshness(input.plan.backupId, input.plan.createdAt, "Refusing audit sync");
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
  if (!input.plan.backupId.trim()) {
    throw new Error("Refusing audit sync: frozen plan backup ID is invalid.");
  }
}

export const SAFE_BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;
const BACKUP_CLOCK_SKEW_MS = 5 * 60 * 1000;
const BACKUP_ID_CREATED_AT =
  /^pmr-(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/;

export function isSafeBackupId(value: string) {
  return SAFE_BACKUP_ID.test(value) && !value.includes("..");
}

export function requireBackupId(value: string | undefined, prefix: string) {
  const backupId = value?.trim() ?? "";
  if (!backupId) {
    throw new Error(`${prefix}: --backup-id is required.`);
  }
  if (!isSafeBackupId(backupId)) {
    throw new Error(`${prefix}: --backup-id is invalid.`);
  }
  return backupId;
}

export function parseBackupIdCreatedAt(backupId: string) {
  const match = backupId.match(BACKUP_ID_CREATED_AT);
  if (!match) return null;
  const parsed = new Date(`${match[1]}${match[2]}:${match[3]}:${match[4]}.${match[5]}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asTime(value: string | Date | number | undefined) {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function assertBackupFreshness(input: {
  createdAt: string | Date | number;
  prefix: string;
  referenceAt?: string | Date | number;
  now?: string | Date | number;
}) {
  const createdAt = asTime(input.createdAt);
  const now = asTime(input.now) ?? Date.now();
  const referenceAt = asTime(input.referenceAt);
  if (createdAt == null) {
    throw new Error(`${input.prefix}: backup timestamp is invalid.`);
  }
  if (createdAt > now + BACKUP_CLOCK_SKEW_MS) {
    throw new Error(`${input.prefix}: backup timestamp is in the future.`);
  }
  const floor = (referenceAt ?? now) - MAX_BACKUP_AGE_MS;
  if (createdAt < floor) {
    throw new Error(`${input.prefix}: backup is stale.`);
  }
}

function assertPlanBackupFreshness(
  backupId: string,
  planCreatedAt: string,
  prefix: string,
) {
  const createdAt = parseBackupIdCreatedAt(backupId);
  if (!createdAt) return;
  assertBackupFreshness({
    createdAt,
    referenceAt: planCreatedAt,
    now: createdAt,
    prefix,
  });
}

interface BackupManifest {
  id: string;
  workstream: string;
  targetRef: string;
  confirmDb: string;
  createdAt?: string;
  files: Array<{ name: string; sha256: string; bytes: number }>;
}

export interface VerifyBackupOptions {
  now?: string | Date | number;
  referenceAt?: string | Date | number;
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
  now?: string | Date | number;
  referenceAt?: string | Date | number;
}) {
  const backupsRoot = resolve(input.cwd, ".local", "db-backups");
  const dir = resolve(backupsRoot, input.backupId);
  if (dirname(dir) !== backupsRoot || basename(dir) !== input.backupId) {
    throw new Error("Refusing audit sync: --backup-id is invalid.");
  }
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
  const createdAt = manifest.createdAt ?? statSync(manifestPath).mtime;
  assertBackupFreshness({
    createdAt,
    now: input.now,
    referenceAt: input.referenceAt,
    prefix: "Refusing audit sync",
  });
  return manifest;
}

export function verifyRequiredBackup(
  cwd = process.cwd(),
  backupId?: string,
  options: VerifyBackupOptions = {},
) {
  return verifyBackup({
    cwd,
    backupId: requireBackupId(backupId, "Refusing audit sync"),
    projectRef: PREVIEW_PROJECT_REF,
    confirmDb: PREVIEW_CONFIRM_DB,
    now: options.now,
    referenceAt: options.referenceAt,
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

export function verifyProductionBackup(
  cwd = process.cwd(),
  backupId?: string,
  options: VerifyBackupOptions = {},
) {
  return verifyBackup({
    cwd,
    backupId: requireBackupId(backupId, "Refusing production audit sync"),
    projectRef: PRODUCTION_PROJECT_REF,
    confirmDb: PRODUCTION_CONFIRM_DB,
    now: options.now,
    referenceAt: options.referenceAt,
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
  const cliBackupId = requireBackupId(value("backup-id"), "Refusing production audit sync");
  if (cliBackupId !== input.plan.backupId) {
    throw new Error(
      "Refusing production audit sync: --backup-id does not match the frozen plan.",
    );
  }
  if (!isSafeBackupId(input.plan.backupId)) {
    throw new Error("Refusing production audit sync: frozen plan backup ID is invalid.");
  }
  assertPlanBackupFreshness(
    input.plan.backupId,
    input.plan.createdAt,
    "Refusing production audit sync",
  );
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
  if (actualKeys.some(isTemporaryExcludedProductionAccount)) {
    throw new Error(
      `Refusing production audit sync: ${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY} is excluded.`,
    );
  }
  if (
    input.plan.target.projectRef !== PRODUCTION_PROJECT_REF ||
    input.plan.target.confirmDb !== PRODUCTION_CONFIRM_DB ||
    !input.plan.backupId.trim() ||
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
  assertProductionPreviewProvenance(input.plan);
}
