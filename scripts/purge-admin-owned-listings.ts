import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { loadFoundingProductionEnv } from "./onboard-founding-dealers/env";
import {
  assertAdminListingOwners,
  assertPurgeApplyAllowed,
  ADMIN_OWNED_LISTING_EMAILS,
  projectRefForEnvironment,
  type PurgeEnvironment,
} from "./purge-admin-owned-listings/safety";
import {
  chooseWipeConnectionString,
  isAllowedPreviewDatabaseUrl,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertPreviewWipeTarget,
} from "./wipe-preview-marketplace/target";

function argument(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parseArgs() {
  const environment = argument("environment");
  if (environment !== "preview" && environment !== "production") {
    throw new Error("--environment must be preview or production.");
  }
  return {
    environment: environment as PurgeEnvironment,
    apply: process.argv.includes("--apply"),
    confirmation: argument("confirm"),
    backupId: argument("backup-id"),
  };
}

function setDatabaseEnvironment(input: {
  databaseUrl: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  dbCaCert?: string;
  cloudinaryCloudName?: string;
  cloudinaryApiKey?: string;
  cloudinaryApiSecret?: string;
}) {
  process.env.POSTGRES_URL = input.databaseUrl;
  process.env.POSTGRES_URL_NON_POOLING = input.databaseUrl;
  process.env.DATABASE_URL = input.databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = input.supabaseUrl;
  process.env.SUPABASE_URL = input.supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = input.serviceRoleKey;
  if (input.dbCaCert) process.env.SUPABASE_DB_CA_CERT = input.dbCaCert;
  if (input.cloudinaryCloudName) {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = input.cloudinaryCloudName;
  }
  if (input.cloudinaryApiKey) process.env.CLOUDINARY_API_KEY = input.cloudinaryApiKey;
  if (input.cloudinaryApiSecret) process.env.CLOUDINARY_API_SECRET = input.cloudinaryApiSecret;
}

function configureEnvironment(environment: PurgeEnvironment) {
  if (environment === "production") {
    const env = loadFoundingProductionEnv();
    setDatabaseEnvironment({
      databaseUrl: env.sessionPoolerUrl ?? env.databaseUrl,
      supabaseUrl: env.supabaseUrl,
      serviceRoleKey: env.serviceRoleKey,
      dbCaCert: env.dbCaCert,
      cloudinaryCloudName: env.cloudinaryCloudName,
      cloudinaryApiKey: env.cloudinaryApiKey,
      cloudinaryApiSecret: env.cloudinaryApiSecret,
    });
    return PRODUCTION_PROJECT_REF;
  }

  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error("Preview .env.local was not found.");
  const env = parseEnv(readFileSync(envPath, "utf8"));
  assertPreviewWipeTarget({
    databaseUrl: env.DATABASE_URL,
    postgresUrlNonPooling: env.POSTGRES_URL_NON_POOLING,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const databaseUrl =
    env.POSTGRES_URL && isAllowedPreviewDatabaseUrl(env.POSTGRES_URL)
      ? env.POSTGRES_URL
      : chooseWipeConnectionString({
          databaseUrl: env.DATABASE_URL,
          postgresUrlNonPooling: env.POSTGRES_URL_NON_POOLING,
          supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
        });
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "";
  if (!serviceRoleKey) throw new Error("Preview service-role key is missing.");
  setDatabaseEnvironment({
    databaseUrl,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    dbCaCert: env.SUPABASE_DB_CA_CERT,
    cloudinaryCloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    cloudinaryApiKey: env.CLOUDINARY_API_KEY,
    cloudinaryApiSecret: env.CLOUDINARY_API_SECRET,
  });
  return PREVIEW_PROJECT_REF;
}

function cloudinaryIds(
  images: Array<{ publicId: string; provider: string }>,
) {
  return images
    .filter((image) => image.provider === "CLOUDINARY")
    .map((image) => image.publicId);
}

async function main() {
  const args = parseArgs();
  assertPurgeApplyAllowed(args);
  const projectRef = configureEnvironment(args.environment);
  if (projectRef !== projectRefForEnvironment(args.environment)) {
    throw new Error("Refusing purge: environment target mismatch.");
  }

  const { db } = await import("../lib/db");
  try {
    const users = await db.user.findMany({
      where: {
        OR: ADMIN_OWNED_LISTING_EMAILS.map((email) => ({
          email: { equals: email, mode: "insensitive" as const },
        })),
      },
      select: {
        id: true,
        email: true,
        role: true,
        deletedAt: true,
        authUserId: true,
        dealerProfile: { select: { id: true } },
      },
    });
    assertAdminListingOwners(users);
    const userIds = users.map((user) => user.id);
    const [listings, intents, otherListings] = await Promise.all([
      db.listing.findMany({
        where: { userId: { in: userIds } },
        select: {
          id: true,
          status: true,
          userId: true,
          images: { select: { publicId: true, provider: true } },
          revisions: {
            select: { images: { select: { publicId: true, provider: true } } },
          },
        },
      }),
      db.listingImageUploadIntent.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, publicId: true },
      }),
      db.listing.count({ where: { userId: { notIn: userIds } } }),
    ]);
    const listingIds = listings.map((listing) => listing.id);
    const legalHolds = await db.retentionLegalHold.count({
      where: {
        releasedAt: null,
        OR: [
          { entityType: "USER", entityId: { in: userIds } },
          ...(listingIds.length > 0
            ? [{ entityType: "LISTING", entityId: { in: listingIds } }]
            : []),
        ],
      },
    });
    if (legalHolds > 0) throw new Error("Refusing purge: an active legal hold exists.");
    const mediaIds = [
      ...listings.flatMap((listing) => cloudinaryIds(listing.images)),
      ...listings.flatMap((listing) =>
        listing.revisions.flatMap((revision) => cloudinaryIds(revision.images)),
      ),
      ...intents.map((intent) => intent.publicId),
    ];
    process.stdout.write(
      `${JSON.stringify({
        mode: args.apply ? "apply" : "dry-run",
        environment: args.environment,
        projectRef,
        admins: users.map((user) => ({
          email: user.email,
          role: user.role,
          dealerProfile: Boolean(user.dealerProfile),
        })),
        listings: listings.map((listing) => ({ id: listing.id, status: listing.status })),
        intents: intents.length,
        otherListings,
        media: mediaIds.length,
      }, null, 2)}\n`,
    );
    if (!args.apply) return;

    const deleted = await db.$transaction(async (tx) => {
      const currentUsers = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, role: true, deletedAt: true, authUserId: true },
      });
      assertAdminListingOwners(currentUsers);
      if (currentUsers.length !== users.length) {
        throw new Error("Refusing purge: admin identities changed.");
      }
      const currentListings = await tx.listing.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      });
      const currentIds = currentListings.map((listing) => listing.id);
      if (currentIds.length > 0) {
        await tx.payment.deleteMany({ where: { listingId: { in: currentIds } } });
        await tx.report.deleteMany({ where: { listingId: { in: currentIds } } });
        await tx.listing.deleteMany({ where: { id: { in: currentIds } } });
      }
      await tx.listingImageUploadIntent.deleteMany({ where: { userId: { in: userIds } } });
      await tx.adminAuditLog.create({
        data: {
          adminId: currentUsers.find((user) => user.email.toLowerCase() === "admin@mpdee.co.uk")!.id,
          action: "DELETE_ADMIN_OWNED_LISTINGS",
          entityType: "Listing",
          details: {
            environment: args.environment,
            listingIds: currentIds,
            emails: [...ADMIN_OWNED_LISTING_EMAILS],
          },
        },
      });
      return currentIds.length;
    });

    if (mediaIds.length > 0) {
      const { deleteAccountMedia } = await import("../lib/privacy/purge-user-account");
      await deleteAccountMedia(mediaIds);
    }

    const [remainingListings, remainingIntents, remainingOthers, remainingAdmins] =
      await Promise.all([
        db.listing.count({ where: { userId: { in: userIds } } }),
        db.listingImageUploadIntent.count({ where: { userId: { in: userIds } } }),
        db.listing.count({ where: { userId: { notIn: userIds } } }),
        db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            email: true,
            role: true,
            deletedAt: true,
            authUserId: true,
            dealerProfile: { select: { id: true } },
          },
        }),
      ]);
    assertAdminListingOwners(remainingAdmins);
    if (
      remainingListings !== 0 ||
      remainingIntents !== 0 ||
      remainingOthers !== otherListings ||
      remainingAdmins.some((user) => user.dealerProfile || !user.authUserId)
    ) {
      throw new Error("Purge verification failed.");
    }
    process.stdout.write(
      `${JSON.stringify({
        verified: true,
        environment: args.environment,
        deleted,
        remainingListings,
        remainingIntents,
        otherListings: remainingOthers,
        admins: remainingAdmins.map((user) => ({
          email: user.email,
          role: user.role,
          dealerProfile: Boolean(user.dealerProfile),
        })),
      }, null, 2)}\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
