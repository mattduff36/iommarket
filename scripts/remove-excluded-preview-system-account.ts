import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  deleteAccountMedia,
  deleteAuthUser,
  loadPublicTables,
  purgeUserAccountRecords,
} from "../lib/privacy/purge-user-account";
import {
  previewSystemAuthUserId,
  previewSystemEmail,
} from "../lib/preview-packs/safety";
import {
  assertNoAmbientPreviewOverride,
  chooseFoundingConnectionString,
  loadFoundingProductionEnv,
} from "./onboard-founding-dealers/env";
import { PRODUCTION_ENV_FILE } from "./onboard-founding-dealers/safety";
import { createWritePool } from "./prod-mirror/db";
import { parseArgValue } from "./prod-mirror/safety";
import { auditRunDir } from "./dealer-pack-audit-sync/plan-file";
import {
  assertProductionBinding,
  requireBackupId,
  verifyProductionBackup,
} from "./dealer-pack-audit-sync/safety";
import {
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
  TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
} from "./dealer-pack-audit-sync/production-types";

export const REMOVE_EXCLUDED_ACCOUNT_CONFIRMATION =
  `yes remove excluded preview-system account ${TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY} ${PRODUCTION_PROJECT_REF}`;

interface RemovalTarget {
  user: {
    id: string;
    authUserId: string | null;
    dealerProfile: { id: string; isAdminPreview: boolean } | null;
  } | null;
  pack: {
    id: string;
    dealerProfileId: string;
    enabled: boolean;
  } | null;
}

export function assertRemovalTarget(input: RemovalTarget) {
  if (!input.user && !input.pack) return "already-absent" as const;
  if (!input.user || !input.pack || !input.user.dealerProfile) {
    throw new Error("Refusing excluded account removal: target records are incomplete.");
  }
  if (
    input.user.authUserId !==
      previewSystemAuthUserId(TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY) ||
    !input.user.dealerProfile.isAdminPreview ||
    input.pack.dealerProfileId !== input.user.dealerProfile.id ||
    input.pack.enabled
  ) {
    throw new Error("Refusing excluded account removal: target identity is unsafe.");
  }
  return "remove" as const;
}

export async function main(argv = process.argv.slice(2)) {
  assertNoAmbientPreviewOverride(process.env);
  const runId = parseArgValue(argv, "run-id");
  if (!runId) throw new Error("--run-id is required.");
  const backupId = requireBackupId(
    parseArgValue(argv, "backup-id"),
    "Refusing excluded account removal",
  );
  const envFile = parseArgValue(argv, "production-env") ?? PRODUCTION_ENV_FILE;
  const env = loadFoundingProductionEnv(envFile);
  const url = env.sessionPoolerUrl ?? chooseFoundingConnectionString(env);
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  process.env.SUPABASE_DB_CA_CERT = env.dbCaCert;
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = env.cloudinaryCloudName;
  process.env.CLOUDINARY_API_KEY = env.cloudinaryApiKey;
  process.env.CLOUDINARY_API_SECRET = env.cloudinaryApiSecret;
  assertProductionBinding({
    databaseUrl: url,
    projectRef: parseArgValue(argv, "production-ref") ?? "",
    confirmDb: parseArgValue(argv, "confirm-db") ?? "",
  });
  if (parseArgValue(argv, "confirm") !== REMOVE_EXCLUDED_ACCOUNT_CONFIRMATION) {
    throw new Error(
      `Refusing excluded account removal: --confirm must be "${REMOVE_EXCLUDED_ACCOUNT_CONFIRMATION}".`,
    );
  }
  verifyProductionBackup(process.cwd(), backupId);

  const reportPath = resolve(
    auditRunDir(runId),
    "excluded-preview-system-account-removal.json",
  );
  if (existsSync(reportPath)) {
    throw new Error("Refusing excluded account removal: report already exists.");
  }

  const pool = createWritePool(url);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const email = previewSystemEmail(TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY);
    const [user, pack] = await Promise.all([
      prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          authUserId: true,
          dealerProfile: { select: { id: true, isAdminPreview: true } },
        },
      }),
      prisma.dealerPreviewPack.findUnique({
        where: { dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY },
        select: {
          id: true,
          dealerProfileId: true,
          enabled: true,
        },
      }),
    ]);
    const decision = assertRemovalTarget({ user, pack });
    let imageCount = 0;
    let listingIds: string[] = [];
    let imagePublicIds: string[] = [];
    let failedImagePublicIds: string[] = [];
    if (decision === "remove") {
      const tables = await loadPublicTables(prisma);
      const purged = await prisma.$transaction((tx) =>
        purgeUserAccountRecords(tx, user!.id, tables));
      await deleteAuthUser(purged.authUserId);
      const mediaDeletion = await deleteAccountMedia(purged.imagePublicIds);
      imageCount = purged.imagePublicIds.length;
      listingIds = purged.listingIds;
      imagePublicIds = mediaDeletion.attemptedPublicIds;
      failedImagePublicIds = mediaDeletion.failedPublicIds;
    }

    const [remainingUser, remainingPack] = await Promise.all([
      prisma.user.count({ where: { email } }),
      prisma.dealerPreviewPack.count({
        where: { dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY },
      }),
    ]);
    if (remainingUser !== 0 || remainingPack !== 0) {
      throw new Error("Excluded account removal verification failed.");
    }

    const report = {
      version: 1,
      runId,
      dealerKey: TEMPORARY_EXCLUDED_PRODUCTION_DEALER_KEY,
      email,
      backupId,
      createdAt: new Date().toISOString(),
      outcome: decision === "remove" ? "removed" : "already-absent",
      removedImageCount: imageCount,
      removedListingIds: listingIds,
      removedImagePublicIds: imagePublicIds,
      failedImagePublicIds,
      verifiedAbsent: true,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(
      `Excluded preview-system account ${report.outcome}; verifiedAbsent=true.\n`,
    );
  } finally {
    await Promise.allSettled([prisma.$disconnect(), pool.end()]);
  }
}

if (process.argv[1]?.includes("remove-excluded-preview-system-account")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
