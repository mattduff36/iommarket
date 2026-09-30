/**
 * Preview-only reconstruction of audited dealer-pack exclusions for admin review.
 *
 * npm run dealer-packs:review-sync -- plan-preview --run-id=<id> --backup-id=<id>
 * npm run dealer-packs:review-sync -- apply-preview --run-id=<id> <confirmations>
 * npm run dealer-packs:review-sync -- verify-preview --run-id=<id> --preview-ref=... --confirm-db=...
 */
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { applyPreviewReviewPlan } from "./dealer-pack-audit-sync/review-apply";
import {
  buildPreviewReviewPlan,
  readFrozenReviewPlan,
  reviewPlanPath,
  writeFrozenReviewPlan,
} from "./dealer-pack-audit-sync/review-plan";
import {
  REVIEW_APPLY_CONFIRM_PHRASE,
  assertReviewApplySafety,
} from "./dealer-pack-audit-sync/review-safety";
import type { PreviewReviewApplyReport } from "./dealer-pack-audit-sync/review-types";
import type { PreviewReviewVerifyReport } from "./dealer-pack-audit-sync/review-types";
import {
  CANONICAL_AUDIT_PLAN_RELATIVE,
  CANONICAL_REVIEW_SOURCE_RUN_ID,
} from "./dealer-pack-audit-sync/review-types";
import { verifyPreviewReviewPlan } from "./dealer-pack-audit-sync/review-verify";
import {
  PREVIEW_CONFIRM_DB,
  assertPreviewBinding,
  requireBackupId,
  verifyRequiredBackup,
} from "./dealer-pack-audit-sync/safety";
import { auditRunDir } from "./dealer-pack-audit-sync/plan-file";
import { loadConnectionEnv, connectionCandidates } from "./prod-mirror/env";
import { createReadPool, createWritePool } from "./prod-mirror/db";
import { parseArgValue } from "./prod-mirror/safety";
import { chooseDirectConnectionString } from "./prod-mirror/target";
import { PREVIEW_PROJECT_REF } from "./wipe-preview-marketplace/target";
import { loadFoundingProductionEnv } from "./onboard-founding-dealers/env";
import { PRODUCTION_ENV_FILE } from "./onboard-founding-dealers/safety";

type ReviewCommand = "plan-preview" | "apply-preview" | "verify-preview";

function parseCommand(argv: string[]): ReviewCommand {
  const command = argv.find((arg) => !arg.startsWith("--"));
  if (
    command !== "plan-preview" &&
    command !== "apply-preview" &&
    command !== "verify-preview"
  ) {
    throw new Error("Command must be plan-preview | apply-preview | verify-preview.");
  }
  return command;
}

function defaultRunId() {
  return `preview-review-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function loadPreviewUrl(argv: string[]) {
  if (parseArgValue(argv, "production-ref") || parseArgValue(argv, "dest-ref")) {
    throw new Error("Refusing review sync: production flags are not allowed.");
  }
  const envFile = parseArgValue(argv, "preview-env") ?? ".env.local";
  const env = loadConnectionEnv(envFile);
  const url = chooseDirectConnectionString(connectionCandidates(env), "preview");
  const cloudinary = loadFoundingProductionEnv(
    parseArgValue(argv, "cloudinary-env") ?? PRODUCTION_ENV_FILE,
  );
  process.env.SUPABASE_DB_CA_CERT = env.dbCaCert ?? cloudinary.dbCaCert;
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = cloudinary.cloudinaryCloudName;
  process.env.CLOUDINARY_API_KEY = cloudinary.cloudinaryApiKey;
  process.env.CLOUDINARY_API_SECRET = cloudinary.cloudinaryApiSecret;
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  return url;
}

function client(url: string, write: boolean) {
  const pool = write ? createWritePool(url) : createReadPool(url);
  return {
    pool,
    prisma: new PrismaClient({ adapter: new PrismaPg(pool) }),
  };
}

export function assertReviewApplyCanResume(
  priorReport: PreviewReviewApplyReport,
  plan: { runId: string; fingerprint: string },
) {
  if (
    priorReport.runId !== plan.runId ||
    priorReport.planFingerprint !== plan.fingerprint
  ) {
    throw new Error("Refusing review sync: existing apply report does not match the plan.");
  }
  if (priorReport.results.every((result) => result.status === "applied")) {
    throw new Error("Refusing review sync: apply already completed successfully.");
  }
}

export function renderPreviewReviewReport(
  report: PreviewReviewVerifyReport,
  backupId: string,
) {
  const lines = [
    "# Preview pack review report",
    "",
    `- Run: \`${report.runId}\``,
    `- Rollback backup: \`${backupId}\``,
    `- Verified: ${report.ok ? "yes" : "no"}`,
    `- Non-Rex packs: ${report.packCount}`,
    `- Listings marked for review: ${report.listingCount}`,
    "",
    "| Dealer | Enabled | Total listings | Review listings | Review listings without images |",
    "|---|---:|---:|---:|---:|",
    ...report.packCensus.map((pack) =>
      `| ${pack.displayName.replaceAll("|", "\\|")} | ${pack.enabled ? "yes" : "no"} | ${pack.listingCount} | ${pack.reviewListingCount} | ${pack.zeroImageReviewCount} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function writeJsonOnce(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, payload, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    try {
      await link(temporary, path);
    } catch (error) {
      if (
        !(error && typeof error === "object" && "code" in error && error.code === "EEXIST") ||
        await readFile(path, "utf8").catch(() => null) !== payload
      ) {
        throw error;
      }
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function planPreview(argv: string[], prisma: PrismaClient, url: string) {
  assertPreviewBinding({
    databaseUrl: url,
    projectRef: parseArgValue(argv, "preview-ref") ?? PREVIEW_PROJECT_REF,
    confirmDb: parseArgValue(argv, "confirm-db") ?? PREVIEW_CONFIRM_DB,
  });
  const runId = parseArgValue(argv, "run-id") ?? defaultRunId();
  const sourceRunId = parseArgValue(argv, "source-run") ?? CANONICAL_REVIEW_SOURCE_RUN_ID;
  const backupId = requireBackupId(parseArgValue(argv, "backup-id"), "Refusing review sync");
  verifyRequiredBackup(process.cwd(), backupId);
  const plan = await buildPreviewReviewPlan({
    prisma,
    runId,
    projectRef: PREVIEW_PROJECT_REF,
    confirmDb: PREVIEW_CONFIRM_DB,
    sourceRunId,
    backupId,
    auditPlanPath: parseArgValue(argv, "audit-plan") ?? CANONICAL_AUDIT_PLAN_RELATIVE,
  });
  const path = reviewPlanPath(runId);
  await writeFrozenReviewPlan(path, plan);
  process.stdout.write(
    `Frozen ${plan.listingCount} review listing(s) across ${plan.actionCount} pack(s) at ${path}\n` +
    `fingerprint=${plan.fingerprint}\n`,
  );
}

async function applyPreview(argv: string[], prisma: PrismaClient, url: string) {
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  const plan = await readFrozenReviewPlan(reviewPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen review plan run ID mismatch.");
  assertReviewApplySafety({ argv, plan, databaseUrl: url });
  verifyRequiredBackup(process.cwd(), plan.backupId);
  const reportPath = resolve(auditRunDir(runId), "preview-review-apply.json");
  let priorReport: PreviewReviewApplyReport | null = null;
  if (existsSync(reportPath)) {
    priorReport = JSON.parse(await readFile(reportPath, "utf8")) as PreviewReviewApplyReport;
    assertReviewApplyCanResume(priorReport, plan);
  }
  const results = await applyPreviewReviewPlan({ prisma, plan });
  const report: PreviewReviewApplyReport = {
    runId,
    planFingerprint: plan.fingerprint,
    createdAt: new Date().toISOString(),
    results,
  };
  if (priorReport) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } else {
    await writeJsonOnce(reportPath, report);
  }
  const failed = results.filter((result) => result.status === "failed");
  process.stdout.write(`Applied ${results.length - failed.length}/${results.length} review pack(s).\n`);
  if (failed.length > 0) {
    throw new Error(`${failed.length} review pack(s) failed.`);
  }
}

async function verifyPreview(argv: string[], prisma: PrismaClient, url: string) {
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  assertPreviewBinding({
    databaseUrl: url,
    projectRef: parseArgValue(argv, "preview-ref") ?? "",
    confirmDb: parseArgValue(argv, "confirm-db") ?? "",
  });
  const plan = await readFrozenReviewPlan(reviewPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen review plan run ID mismatch.");
  verifyRequiredBackup(process.cwd(), plan.backupId);
  const applyPath = resolve(auditRunDir(runId), "preview-review-apply.json");
  const applyReport = await readFile(applyPath, "utf8")
    .then((contents) => JSON.parse(contents) as PreviewReviewApplyReport)
    .catch(() => null);
  const report = await verifyPreviewReviewPlan({ prisma, plan, applyReport });
  const verifyPath = resolve(auditRunDir(runId), "preview-review-verify.json");
  if (existsSync(verifyPath)) {
    await writeFile(verifyPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } else {
    await writeJsonOnce(verifyPath, report);
  }
  await writeFile(
    resolve(auditRunDir(runId), "preview-review-report.md"),
    renderPreviewReviewReport(report, plan.backupId),
    "utf8",
  );
  process.stdout.write(
    `Verified ${report.results.length} pack(s); listings=${report.listingCount}; ok=${report.ok}.\n`,
  );
  if (!report.ok) throw new Error("Preview review verification failed.");
}

export async function main(argv = process.argv.slice(2)) {
  const command = parseCommand(argv);
  const url = loadPreviewUrl(argv);
  const connected = client(url, command === "apply-preview");
  try {
    if (command === "plan-preview") await planPreview(argv, connected.prisma, url);
    if (command === "apply-preview") await applyPreview(argv, connected.prisma, url);
    if (command === "verify-preview") await verifyPreview(argv, connected.prisma, url);
  } finally {
    await Promise.allSettled([connected.prisma.$disconnect(), connected.pool.end()]);
  }
}

if (process.argv[1]?.includes("dealer-pack-review-sync")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`Apply confirmation phrase: ${REVIEW_APPLY_CONFIRM_PHRASE}\n`);
    process.exitCode = 1;
  });
}
