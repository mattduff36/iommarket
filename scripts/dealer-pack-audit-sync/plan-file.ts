import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PreviewPackAuditPlan } from "./types";
import {
  PRODUCTION_ACCOUNTS,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
  isTemporaryExcludedProductionAccount,
  type ProductionAuditPlan,
} from "./production-types";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function planFingerprint(
  plan:
    | Omit<PreviewPackAuditPlan, "fingerprint">
    | PreviewPackAuditPlan
    | Omit<ProductionAuditPlan, "fingerprint">
    | ProductionAuditPlan,
) {
  const unsigned = Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== "fingerprint"),
  );
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest("hex");
}

export function sealPlan(
  plan: Omit<PreviewPackAuditPlan, "fingerprint">,
): PreviewPackAuditPlan {
  return { ...plan, fingerprint: planFingerprint(plan) };
}

export function sealProductionPlan(
  plan: Omit<ProductionAuditPlan, "fingerprint">,
): ProductionAuditPlan {
  return { ...plan, fingerprint: planFingerprint(plan) };
}

export function assertProductionPreviewProvenance(plan: ProductionAuditPlan) {
  if (
    typeof plan.finalPreviewRunId !== "string" ||
    !plan.finalPreviewRunId.trim() ||
    typeof plan.finalPreviewFingerprint !== "string" ||
    !plan.finalPreviewFingerprint.trim()
  ) {
    throw new Error(
      "Refusing production audit sync: frozen plan is missing finalized preview provenance.",
    );
  }
}

export function assertPlanIntegrity(plan: PreviewPackAuditPlan) {
  if (typeof plan.backupId !== "string" || !plan.backupId.trim()) {
    throw new Error("Refusing audit sync: frozen plan backup ID is invalid.");
  }
  if (plan.actionCount !== plan.actions.length) {
    throw new Error("Refusing audit sync: frozen plan action count is invalid.");
  }
  if (
    plan.actions.some((action) =>
      action.kind === "replace" &&
      action.listings.some((listing) => listing.images.length === 0))
  ) {
    throw new Error(
      "Refusing audit sync: frozen plan includes a listing with no valid source image.",
    );
  }
  const actual = planFingerprint(plan);
  if (actual !== plan.fingerprint) {
    throw new Error("Refusing audit sync: frozen plan fingerprint is invalid.");
  }
}

export function assertProductionPlanIntegrity(plan: ProductionAuditPlan) {
  if (typeof plan.backupId !== "string" || !plan.backupId.trim()) {
    throw new Error("Refusing production audit sync: frozen plan backup ID is invalid.");
  }
  assertProductionPreviewProvenance(plan);
  const allowedKeys = new Set<string>(
    PRODUCTION_ACCOUNTS.map((account) => account.dealerKey),
  );
  const accountKeys = plan.accounts.map((account) => account.dealerKey);
  if (accountKeys.some(isTemporaryExcludedProductionAccount)) {
    throw new Error(
      `Refusing production audit sync: ${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY} is excluded.`,
    );
  }
  if (
    accountKeys.length === 0 ||
    new Set(accountKeys).size !== accountKeys.length ||
    accountKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error(
      "Refusing production audit sync: frozen plan accounts must be a non-empty allowlisted subset.",
    );
  }
  if (
    plan.accounts.some((account) =>
      account.actions.some((action) =>
        action.kind !== "take_down" && action.source.images.length === 0))
  ) {
    throw new Error(
      "Refusing production audit sync: frozen plan includes a listing with no valid source image.",
    );
  }
  const actualCount = plan.accounts.reduce(
    (count, account) => count + account.actions.length,
    0,
  );
  if (plan.actionCount !== actualCount) {
    throw new Error("Refusing production audit sync: frozen plan action count is invalid.");
  }
  if (planFingerprint(plan) !== plan.fingerprint) {
    throw new Error("Refusing production audit sync: frozen plan fingerprint is invalid.");
  }
}

export function auditRunDir(runId: string, cwd = process.cwd()) {
  return resolve(cwd, "private", "dealer-pack-audit", runId);
}

export function auditPlanPath(runId: string, cwd = process.cwd()) {
  return resolve(auditRunDir(runId, cwd), "preview-plan.json");
}

export function productionAuditPlanPath(runId: string, cwd = process.cwd()) {
  return resolve(auditRunDir(runId, cwd), "production-plan.json");
}

export async function writeFrozenPlan(path: string, plan: PreviewPackAuditPlan) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function writeFrozenProductionPlan(
  path: string,
  plan: ProductionAuditPlan,
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function readFrozenPlan(path: string) {
  const plan = JSON.parse(await readFile(path, "utf8")) as PreviewPackAuditPlan;
  assertPlanIntegrity(plan);
  return plan;
}

export async function readFrozenProductionPlan(path: string) {
  const plan = JSON.parse(await readFile(path, "utf8")) as ProductionAuditPlan;
  assertProductionPlanIntegrity(plan);
  return plan;
}
