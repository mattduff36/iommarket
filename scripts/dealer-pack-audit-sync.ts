/**
 * Frozen exact synchronization for preview packs and four production accounts.
 *
 * npm run dealer-packs:audit-sync -- plan-preview --run-id=<id>
 * npm run dealer-packs:audit-sync -- apply-preview --run-id=<id> <confirmations>
 * npm run dealer-packs:audit-sync -- verify-preview --run-id=<id> --preview-ref=... --confirm-db=...
 * npm run dealer-packs:audit-sync -- compare-source --run-id=<id> --preview-run=... --production-run=... --source-run=...
 */
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { applyPreviewPackAuditPlan } from "./dealer-pack-audit-sync/apply";
import { applyProductionAuditPlan } from "./dealer-pack-audit-sync/production-apply";
import { buildPreviewPackAuditPlan } from "./dealer-pack-audit-sync/plan";
import { buildProductionAuditPlan } from "./dealer-pack-audit-sync/production-plan";
import {
  auditPlanPath,
  auditRunDir,
  productionAuditPlanPath,
  readFrozenPlan,
  readFrozenProductionPlan,
  writeFrozenPlan,
  writeFrozenProductionPlan,
} from "./dealer-pack-audit-sync/plan-file";
import {
  APPLY_CONFIRM_PHRASE,
  PRODUCTION_APPLY_CONFIRM_PHRASE,
  assertProductionApplySafety,
  assertProductionBinding,
  assertApplySafety,
  assertPreviewBinding,
  PREVIEW_CONFIRM_DB,
  requireBackupId,
  verifyProductionBackup,
  verifyRequiredBackup,
} from "./dealer-pack-audit-sync/safety";
import { loadCliProductionLiveExclusions } from "./dealer-pack-audit-sync/finalize-live-cli";
import { assertFinalizedPreviewPlan } from "./dealer-pack-audit-sync/finalize-live";
import type { PreviewPackApplyReport } from "./dealer-pack-audit-sync/types";
import type { ProductionApplyReport } from "./dealer-pack-audit-sync/production-types";
import {
  renderPreviewAuditReport,
  renderProductionAuditReport,
} from "./dealer-pack-audit-sync/report";
import {
  buildSourceCompareReport,
  renderSourceCompareReport,
} from "./dealer-pack-audit-sync/source-compare";
import { verifyPreviewPackAuditPlan } from "./dealer-pack-audit-sync/verify";
import { verifyProductionAuditPlan } from "./dealer-pack-audit-sync/production-verify";
import { loadConnectionEnv, connectionCandidates } from "./prod-mirror/env";
import { createReadPool, createWritePool } from "./prod-mirror/db";
import { parseArgValue } from "./prod-mirror/safety";
import { chooseDirectConnectionString } from "./prod-mirror/target";
import { PREVIEW_PROJECT_REF } from "./wipe-preview-marketplace/target";
import {
  assertNoAmbientPreviewOverride,
  chooseFoundingConnectionString,
  loadFoundingProductionEnv,
} from "./onboard-founding-dealers/env";
import { PRODUCTION_ENV_FILE } from "./onboard-founding-dealers/safety";

type AuditCommand =
  | "plan-preview"
  | "apply-preview"
  | "verify-preview"
  | "plan-production"
  | "apply-production"
  | "verify-production"
  | "compare-source";

function parseCommand(argv: string[]): AuditCommand {
  const command = argv.find((arg) => !arg.startsWith("--"));
  if (
    command !== "plan-preview" &&
    command !== "apply-preview" &&
    command !== "verify-preview" &&
    command !== "plan-production" &&
    command !== "apply-production" &&
    command !== "verify-production" &&
    command !== "compare-source"
  ) {
    throw new Error(
      "Command must be plan-preview | apply-preview | verify-preview | plan-production | apply-production | verify-production | compare-source.",
    );
  }
  return command;
}

function isProductionCommand(command: AuditCommand) {
  return command.endsWith("-production");
}

function defaultRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadPreviewUrl(argv: string[]) {
  const envFile = parseArgValue(argv, "preview-env") ?? ".env.local";
  const env = loadConnectionEnv(envFile);
  const url = chooseDirectConnectionString(connectionCandidates(env), "preview");
  const cloudinaryEnvFile = parseArgValue(argv, "cloudinary-env");
  if (cloudinaryEnvFile) {
    const cloudinary = loadFoundingProductionEnv(cloudinaryEnvFile);
    process.env.SUPABASE_DB_CA_CERT = cloudinary.dbCaCert;
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = cloudinary.cloudinaryCloudName;
    process.env.CLOUDINARY_API_KEY = cloudinary.cloudinaryApiKey;
    process.env.CLOUDINARY_API_SECRET = cloudinary.cloudinaryApiSecret;
  }
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  return url;
}

function loadProductionUrl(argv: string[]) {
  assertNoAmbientPreviewOverride(process.env);
  const envFile = parseArgValue(argv, "production-env") ?? PRODUCTION_ENV_FILE;
  const env = loadFoundingProductionEnv(envFile);
  const url = env.sessionPoolerUrl ?? chooseFoundingConnectionString(env);
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  process.env.SUPABASE_DB_CA_CERT = env.dbCaCert;
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = env.cloudinaryCloudName;
  process.env.CLOUDINARY_API_KEY = env.cloudinaryApiKey;
  process.env.CLOUDINARY_API_SECRET = env.cloudinaryApiSecret;
  return url;
}

function client(url: string, write: boolean) {
  const pool = write ? createWritePool(url) : createReadPool(url);
  return {
    pool,
    prisma: new PrismaClient({ adapter: new PrismaPg(pool) }),
  };
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
    projectRef: PREVIEW_PROJECT_REF,
    confirmDb: PREVIEW_CONFIRM_DB,
  });
  const runId = parseArgValue(argv, "run-id") ?? defaultRunId();
  const sourceRunId = parseArgValue(argv, "source-run");
  if (!sourceRunId) throw new Error("--source-run is required.");
  const backupId = requireBackupId(parseArgValue(argv, "backup-id"), "Refusing audit sync");
  verifyRequiredBackup(process.cwd(), backupId);
  const plan = await buildPreviewPackAuditPlan({
    prisma,
    runId,
    projectRef: PREVIEW_PROJECT_REF,
    confirmDb: PREVIEW_CONFIRM_DB,
    sourceRunId,
    backupId,
    dealerKey: parseArgValue(argv, "dealer") ?? undefined,
  });
  const path = auditPlanPath(runId);
  await writeFrozenPlan(path, plan);
  process.stdout.write(
    `Frozen ${plan.actionCount} preview pack action(s) at ${path}\n` +
    `fingerprint=${plan.fingerprint}\n`,
  );
}

async function applyPreview(argv: string[], prisma: PrismaClient, url: string) {
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  const plan = await readFrozenPlan(auditPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen preview plan run ID mismatch.");
  assertFinalizedPreviewPlan(plan);
  assertApplySafety({ argv, plan, databaseUrl: url });
  verifyRequiredBackup(process.cwd(), plan.backupId);
  const reportPath = resolve(auditRunDir(runId), "apply-report.json");
  if (existsSync(reportPath)) {
    throw new Error("Refusing preview audit sync: apply report already exists.");
  }
  const results = await applyPreviewPackAuditPlan({ prisma, plan });
  const report: PreviewPackApplyReport = {
    runId,
    planFingerprint: plan.fingerprint,
    createdAt: new Date().toISOString(),
    results,
  };
  await writeJsonOnce(reportPath, report);
  const failed = results.filter((result) => result.status === "failed");
  process.stdout.write(`Applied ${results.length - failed.length}/${results.length} pack action(s).\n`);
  if (failed.length > 0) {
    throw new Error(`${failed.length} pack action(s) failed and remain disabled.`);
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
  const plan = await readFrozenPlan(auditPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen preview plan run ID mismatch.");
  assertFinalizedPreviewPlan(plan);
  verifyRequiredBackup(process.cwd(), plan.backupId);
  const applyPath = resolve(auditRunDir(runId), "apply-report.json");
  const applyReport = await readFile(applyPath, "utf8")
    .then((contents) => JSON.parse(contents) as PreviewPackApplyReport)
    .catch(() => null);
  const report = await verifyPreviewPackAuditPlan({ prisma, plan, applyReport });
  await writeJsonOnce(resolve(auditRunDir(runId), "verify-report.json"), report);
  await writeFile(
    resolve(auditRunDir(runId), "preview-audit-report.md"),
    renderPreviewAuditReport({ plan, apply: applyReport, verify: report }),
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(`Verified ${report.results.length} pack(s); ok=${report.ok}.\n`);
  if (!report.ok) throw new Error("Preview pack exact verification failed.");
}

function assertProductionCliBinding(argv: string[], url: string) {
  assertProductionBinding({
    databaseUrl: url,
    projectRef:
      parseArgValue(argv, "production-ref") ??
      parseArgValue(argv, "dest-ref") ??
      "",
    confirmDb: parseArgValue(argv, "confirm-db") ?? "",
  });
}

async function planProduction(
  argv: string[],
  prisma: PrismaClient,
  url: string,
) {
  assertProductionCliBinding(argv, url);
  const runId = parseArgValue(argv, "run-id") ?? defaultRunId();
  const live = await loadCliProductionLiveExclusions({ argv });
  const foundingSourceRunId = parseArgValue(argv, "source-run");
  if (!foundingSourceRunId) throw new Error("--source-run is required.");
  if (foundingSourceRunId !== live.finalPlan.sourceRunId) {
    throw new Error(
      "Refusing production plan: --source-run does not match the finalized preview plan sourceRunId.",
    );
  }
  const backupId = requireBackupId(
    parseArgValue(argv, "backup-id"),
    "Refusing production audit sync",
  );
  verifyProductionBackup(process.cwd(), backupId);
  const plan = await buildProductionAuditPlan({
    prisma,
    runId,
    foundingSourceRunId,
    backupId,
    finalPreviewPlan: live.finalPlan,
    dealerKey: parseArgValue(argv, "dealer") ?? undefined,
  });
  const path = productionAuditPlanPath(runId);
  await writeFrozenProductionPlan(path, plan);
  const blocked = plan.accounts.filter((account) => !account.applicable);
  process.stdout.write(
    `Frozen ${plan.actionCount} production action(s) across ${plan.accounts.length} account(s) at ${path}\n` +
    `fingerprint=${plan.fingerprint}\n` +
    `applicable=${blocked.length === 0}\n`,
  );
  if (blocked.length > 0) {
    throw new Error(
      `Production plan is non-applicable: ${blocked
        .map((account) => `${account.dealerKey}[${account.blockers.join(",")}]`)
        .join("; ")}`,
    );
  }
}

async function applyProduction(
  argv: string[],
  prisma: PrismaClient,
  url: string,
) {
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  const plan = await readFrozenProductionPlan(productionAuditPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen production plan run ID mismatch.");
  assertProductionApplySafety({ argv, plan, databaseUrl: url });
  verifyProductionBackup(process.cwd(), plan.backupId);
  const reportPath = resolve(auditRunDir(runId), "production-apply-report.json");
  if (existsSync(reportPath)) {
    throw new Error("Refusing production audit sync: apply report already exists.");
  }
  const report = await applyProductionAuditPlan({ prisma, plan });
  await writeJsonOnce(reportPath, report);
  process.stdout.write(`Applied ${report.actionsApplied} production action(s).\n`);
}

async function verifyProduction(
  argv: string[],
  prisma: PrismaClient,
  url: string,
) {
  assertProductionCliBinding(argv, url);
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  const plan = await readFrozenProductionPlan(productionAuditPlanPath(runId));
  if (plan.runId !== runId) throw new Error("Frozen production plan run ID mismatch.");
  verifyProductionBackup(process.cwd(), plan.backupId);
  const applyReport = await readFile(
    resolve(auditRunDir(runId), "production-apply-report.json"),
    "utf8",
  ).then((contents) => JSON.parse(contents) as ProductionApplyReport)
    .catch(() => null);
  const report = await verifyProductionAuditPlan({ prisma, plan, applyReport });
  await writeJsonOnce(resolve(auditRunDir(runId), "production-verify-report.json"), report);
  if (!applyReport) {
    throw new Error("Production apply report is required for evidence reporting.");
  }
  await writeFile(
    resolve(auditRunDir(runId), "production-audit-report.md"),
    renderProductionAuditReport({ plan, apply: applyReport, verify: report }),
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(
    `Verified ${report.accounts.length} production account(s); ok=${report.ok}.\n`,
  );
  if (!report.ok) throw new Error("Production dealer audit exact verification failed.");
}

async function compareSource(argv: string[]) {
  const runId = parseArgValue(argv, "run-id");
  const previewRun = parseArgValue(argv, "preview-run");
  const previewOverlayRuns = (parseArgValue(argv, "preview-overlay-run") ?? "")
    .split(",")
    .filter(Boolean);
  const productionOverlayRuns = (
    parseArgValue(argv, "production-overlay-run") ?? ""
  )
    .split(",")
    .filter(Boolean);
  const productionRun = parseArgValue(argv, "production-run");
  const sourceRun = parseArgValue(argv, "source-run");
  const sourceOverlayDealer = parseArgValue(argv, "source-overlay-dealer");
  const sourceOverlayRun = parseArgValue(argv, "source-overlay-run");
  if (!runId || !previewRun || !productionRun || !sourceRun) {
    throw new Error(
      "--run-id, --preview-run, --production-run, and --source-run are required.",
    );
  }
  if (Boolean(sourceOverlayDealer) !== Boolean(sourceOverlayRun)) {
    throw new Error(
      "--source-overlay-dealer and --source-overlay-run must be provided together.",
    );
  }
  const previewPlan = await readFrozenPlan(auditPlanPath(previewRun));
  const previewOverlayPlans = await Promise.all(
    previewOverlayRuns.map((overlayRun) =>
      readFrozenPlan(auditPlanPath(overlayRun)),
    ),
  );
  const productionOverlayPlans = await Promise.all(
    productionOverlayRuns.map((overlayRun) =>
      readFrozenProductionPlan(productionAuditPlanPath(overlayRun)),
    ),
  );
  const productionPlan = await readFrozenProductionPlan(
    productionAuditPlanPath(productionRun),
  );
  if (previewPlan.runId !== previewRun) {
    throw new Error("Frozen preview plan run ID mismatch.");
  }
  if (
    previewOverlayPlans.some(
      (plan, index) => plan.runId !== previewOverlayRuns[index],
    ) ||
    productionOverlayPlans.some(
      (plan, index) => plan.runId !== productionOverlayRuns[index],
    )
  ) {
    throw new Error("Frozen overlay plan run ID mismatch.");
  }
  if (productionPlan.runId !== productionRun) {
    throw new Error("Frozen production plan run ID mismatch.");
  }
  const report = await buildSourceCompareReport({
    runId,
    previewPlan,
    previewOverlayPlans,
    productionPlan,
    productionOverlayPlans,
    sourceRunId: sourceRun,
    sourceRunOverrides:
      sourceOverlayDealer && sourceOverlayRun
        ? { [sourceOverlayDealer]: sourceOverlayRun }
        : {},
  });
  await writeJsonOnce(resolve(auditRunDir(runId), "source-compare-report.json"), report);
  await writeFile(
    resolve(auditRunDir(runId), "source-compare-report.md"),
    renderSourceCompareReport(report),
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(
    `Compared ${report.dealers.length} dealer(s); unexplained=${report.unexplainedCount}; ok=${report.ok}.\n`,
  );
  const unexplainedDealers = report.dealers.filter(
    (dealer) => dealer.unexplainedCount > 0,
  );
  if (unexplainedDealers.length > 0) {
    process.stdout.write(
      `Unexplained by dealer: ${unexplainedDealers
        .map((dealer) => `${dealer.dealerKey}=${dealer.unexplainedCount}`)
        .join(", ")}\n`,
    );
    process.stdout.write(
      `Unexplained records: ${unexplainedDealers
        .flatMap((dealer) =>
          dealer.listings
            .filter((listing) => listing.unexplained)
            .map(
              (listing) =>
                `${dealer.dealerKey}:${listing.identityKey}[${
                  listing.listingChanges.join("+") || listing.explanation
                }]`,
            ),
        )
        .join(", ")}\n`,
    );
  }
  if (!report.ok) throw new Error("Source compare found unexplained records.");
}

export async function main(argv = process.argv.slice(2)) {
  const command = parseCommand(argv);
  if (command === "compare-source") {
    await compareSource(argv);
    return;
  }
  const url = isProductionCommand(command)
    ? loadProductionUrl(argv)
    : loadPreviewUrl(argv);
  const connected = client(
    url,
    command === "apply-preview" || command === "apply-production",
  );
  try {
    if (command === "plan-preview") await planPreview(argv, connected.prisma, url);
    if (command === "apply-preview") await applyPreview(argv, connected.prisma, url);
    if (command === "verify-preview") await verifyPreview(argv, connected.prisma, url);
    if (command === "plan-production") {
      await planProduction(argv, connected.prisma, url);
    }
    if (command === "apply-production") {
      await applyProduction(argv, connected.prisma, url);
    }
    if (command === "verify-production") {
      await verifyProduction(argv, connected.prisma, url);
    }
  } finally {
    await Promise.allSettled([connected.prisma.$disconnect(), connected.pool.end()]);
  }
}

if (process.argv[1]?.includes("dealer-pack-audit-sync")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`Apply confirmation phrase: ${APPLY_CONFIRM_PHRASE}\n`);
    process.stderr.write(
      `Production apply confirmation phrase: ${PRODUCTION_APPLY_CONFIRM_PHRASE}\n`,
    );
    process.exitCode = 1;
  });
}
