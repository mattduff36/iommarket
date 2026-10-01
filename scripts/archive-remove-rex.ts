import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  deleteAccountMedia,
  deleteAuthUser,
  loadPublicTables,
  purgeUserAccountRecords,
} from "../lib/privacy/purge-user-account";
import {
  previewSystemEmail,
} from "../lib/preview-packs/safety";
import {
  assertNoAmbientPreviewOverride,
  chooseFoundingConnectionString,
  loadFoundingProductionEnv,
} from "./onboard-founding-dealers/env";
import { PRODUCTION_ENV_FILE } from "./onboard-founding-dealers/safety";
import { createWritePool } from "./prod-mirror/db";
import { connectionCandidates, loadConnectionEnv } from "./prod-mirror/env";
import { parseArgValue } from "./prod-mirror/safety";
import { chooseDirectConnectionString } from "./prod-mirror/target";
import {
  assertPreviewBinding,
  assertProductionBinding,
  PREVIEW_CONFIRM_DB,
  requireBackupId,
  verifyProductionBackup,
  verifyRequiredBackup,
} from "./dealer-pack-audit-sync/safety";
import {
  PRODUCTION_CONFIRM_DB,
  PRODUCTION_PROJECT_REF,
} from "./dealer-pack-audit-sync/production-types";
import { PREVIEW_PROJECT_REF } from "./wipe-preview-marketplace/target";

const DEALER_KEY = "rex-motor-company";
const DEALER_NAME = "Rex Motor Company";
const ARCHIVE_ROOT = resolve(
  "private",
  "Archived",
  "dealer-preview-packs",
  DEALER_KEY,
);
const ALLOWED_EMAILS = [
  previewSystemEmail(DEALER_KEY),
  "rexmotorcompany@itrader.im.preview",
  "rex-motor-company@itrader.im.preview",
];
const ALLOWED_SLUGS = [DEALER_KEY, `preview-${DEALER_KEY}`];

type Target = "preview" | "production";

export function removalConfirmation(target: Target) {
  return `yes archive and remove ${DEALER_KEY} from ${target}`;
}

function loadRuntimeEnv(path: string) {
  if (!existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  const env = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(env)) {
    if (value) process.env[key] = value;
  }
}

function configureTarget(argv: string[], target: Target) {
  if (target === "preview") {
    const envFile = parseArgValue(argv, "preview-env") ?? ".env.local";
    loadRuntimeEnv(envFile);
    const env = loadConnectionEnv(envFile);
    const url = chooseDirectConnectionString(connectionCandidates(env), "preview");
    assertPreviewBinding({
      databaseUrl: url,
      projectRef: parseArgValue(argv, "preview-ref") ?? PREVIEW_PROJECT_REF,
      confirmDb: parseArgValue(argv, "confirm-db") ?? PREVIEW_CONFIRM_DB,
    });
    return url;
  }

  assertNoAmbientPreviewOverride(process.env);
  const envFile = parseArgValue(argv, "production-env") ?? PRODUCTION_ENV_FILE;
  const env = loadFoundingProductionEnv(envFile);
  loadRuntimeEnv(envFile);
  const url = env.sessionPoolerUrl ?? chooseFoundingConnectionString(env);
  process.env.SUPABASE_DB_CA_CERT = env.dbCaCert;
  assertProductionBinding({
    databaseUrl: url,
    projectRef: parseArgValue(argv, "production-ref") ?? PRODUCTION_PROJECT_REF,
    confirmDb: parseArgValue(argv, "confirm-db") ?? PRODUCTION_CONFIRM_DB,
  });
  return url;
}

async function findRexRecords(prisma: PrismaClient) {
  const packs = await prisma.dealerPreviewPack.findMany({
    where: { dealerKey: DEALER_KEY },
  });
  const packProfileIds = packs.map((pack) => pack.dealerProfileId);
  const profiles = await prisma.dealerProfile.findMany({
    where: {
      OR: [
        { id: { in: packProfileIds } },
        { name: { equals: DEALER_NAME, mode: "insensitive" } },
        { slug: { in: ALLOWED_SLUGS } },
      ],
    },
  });
  const profileIds = profiles.map((profile) => profile.id);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: profiles.map((profile) => profile.userId) } },
        { email: { in: ALLOWED_EMAILS, mode: "insensitive" } },
      ],
    },
  });
  const listings = await prisma.listing.findMany({
    where: {
      OR: [
        { previewPackId: { in: packs.map((pack) => pack.id) } },
        { dealerId: { in: profileIds } },
        { userId: { in: users.map((user) => user.id) } },
      ],
    },
    include: {
      images: true,
      attributeValues: true,
    },
  });
  return { packs, profiles, users, listings };
}

export function assertRexRecordsSafe(records: Awaited<ReturnType<typeof findRexRecords>>) {
  const profileIds = new Set(records.profiles.map((profile) => profile.id));
  const profileUserIds = new Set(records.profiles.map((profile) => profile.userId));
  if (records.packs.some((pack) => pack.dealerKey !== DEALER_KEY)) {
    throw new Error("Refusing Rex removal: a non-Rex preview pack was selected.");
  }
  if (
    records.profiles.some(
      (profile) =>
        !records.packs.some((pack) => pack.dealerProfileId === profile.id) &&
        profile.name.toLowerCase() !== DEALER_NAME.toLowerCase() &&
        !ALLOWED_SLUGS.includes(profile.slug),
    )
  ) {
    throw new Error("Refusing Rex removal: a dealer profile has an unsafe identity.");
  }
  if (
    records.users.some(
      (user) =>
        !profileUserIds.has(user.id) &&
        !ALLOWED_EMAILS.some((email) => email.toLowerCase() === user.email.toLowerCase()),
    )
  ) {
    throw new Error("Refusing Rex removal: a user has an unsafe identity.");
  }
  if (
    records.listings.some(
      (listing) =>
        !profileIds.has(listing.dealerId ?? "") &&
        !records.users.some((user) => user.id === listing.userId) &&
        !records.packs.some((pack) => pack.id === listing.previewPackId),
    )
  ) {
    throw new Error("Refusing Rex removal: an unrelated listing was selected.");
  }
}

async function writeJsonOnce(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function main(argv = process.argv.slice(2)) {
  const target = parseArgValue(argv, "target");
  if (target !== "preview" && target !== "production") {
    throw new Error("--target must be preview or production.");
  }
  const runId = parseArgValue(argv, "run-id");
  if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) {
    throw new Error("--run-id is required and must be filename-safe.");
  }
  if (parseArgValue(argv, "confirm") !== removalConfirmation(target)) {
    throw new Error(`--confirm must be "${removalConfirmation(target)}".`);
  }
  const backupId = requireBackupId(
    parseArgValue(argv, "backup-id"),
    "Refusing Rex archive and removal",
  );
  if (target === "preview") verifyRequiredBackup(process.cwd(), backupId);
  else verifyProductionBackup(process.cwd(), backupId);

  const url = configureTarget(argv, target);
  process.env.DATABASE_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  const pool = createWritePool(url);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const snapshotPath = resolve(ARCHIVE_ROOT, `${target}-${runId}-snapshot.json`);
  const reportPath = resolve(ARCHIVE_ROOT, `${target}-${runId}-removal.json`);
  if (existsSync(snapshotPath) || existsSync(reportPath)) {
    throw new Error(`Archive output already exists for ${target}/${runId}.`);
  }

  try {
    const records = await findRexRecords(prisma);
    assertRexRecordsSafe(records);
    const createdAt = new Date().toISOString();
    await writeJsonOnce(snapshotPath, {
      version: 1,
      archivedAt: createdAt,
      target,
      dealerKey: DEALER_KEY,
      backupId,
      records,
    });

    const authUserIds: Array<string | null> = [];
    const imagePublicIds: string[] = [];
    const removedListingIds: string[] = [];
    if (records.users.length > 0) {
      const tables = await loadPublicTables(prisma);
      for (const user of records.users) {
        const purged = await prisma.$transaction((tx) =>
          purgeUserAccountRecords(tx, user.id, tables),
        );
        authUserIds.push(purged.authUserId);
        imagePublicIds.push(...purged.imagePublicIds);
        removedListingIds.push(...purged.listingIds);
      }
    }
    for (const authUserId of authUserIds) await deleteAuthUser(authUserId);
    const media = await deleteAccountMedia(imagePublicIds);

    const remaining = await findRexRecords(prisma);
    if (
      remaining.packs.length ||
      remaining.profiles.length ||
      remaining.users.length ||
      remaining.listings.length
    ) {
      throw new Error("Rex removal verification failed: matching records remain.");
    }

    await writeJsonOnce(reportPath, {
      version: 1,
      createdAt: new Date().toISOString(),
      target,
      dealerKey: DEALER_KEY,
      backupId,
      outcome: records.users.length || records.packs.length ? "removed" : "already-absent",
      archivedSnapshot: snapshotPath,
      removedUserIds: records.users.map((user) => user.id),
      removedProfileIds: records.profiles.map((profile) => profile.id),
      removedPackIds: records.packs.map((pack) => pack.id),
      removedListingIds,
      removedImagePublicIds: media.attemptedPublicIds,
      failedImagePublicIds: media.failedPublicIds,
      verifiedAbsent: true,
    });
    process.stdout.write(
      `Rex ${target}: archived ${records.listings.length} listing(s), removed ${records.users.length} account(s), verified absent.\n`,
    );
  } finally {
    await Promise.allSettled([prisma.$disconnect(), pool.end()]);
  }
}

if (process.argv[1]?.includes("archive-remove-rex")) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
