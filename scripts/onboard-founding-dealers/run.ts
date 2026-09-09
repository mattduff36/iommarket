import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { FEATURED_LISTING_PHOTO_LIMIT } from "../../lib/listings/photo-limits";
import { isPreviewSystemAuthUserId, isPreviewSystemEmail } from "../../lib/preview-packs/safety";
import {
  assertFoundingEmailAllowed,
  FOUNDING_DEALERS,
  type FoundingDealer,
} from "./allowlist";
import {
  assertNoNameCollision,
  ensureFoundingAuthUser,
  findAuthUserByEmail,
  listAuthUsers,
  loadFoundingAdmin,
  planFoundingProfile,
  type FoundingAuthAdmin,
} from "./accounts";
import {
  insertFoundingListing,
  loadCatalogIds,
  resolveFoundingListingPlan,
} from "./apply";
import type { FoundingProductionEnv } from "./env";
import { foundingImagePublicId } from "./identity";
import { withFoundingAdvisoryLock } from "./lock";
import {
  createEmptyManifest,
  type FoundingCredential,
  type FoundingRunManifest,
  writeCredentials,
  writeManifest,
} from "./manifest";
import {
  deleteFoundingCloudinaryAssets,
  FoundingSkippableImageError,
  loadArchiveImageBytes,
  uploadFoundingImage,
  type FoundingCloudinaryConfig,
  type FoundingUploadedImage,
} from "./media";
import { assertFoundingSafety, PRODUCTION_CONFIRM_DB } from "./safety";
import { assertSnapshotUnchanged, freezeFoundingSnapshots } from "./snapshots";

export function generateFoundingPassword() {
  return randomBytes(24).toString("base64url");
}

function createRunId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function runFoundingOnboard(input: {
  argv: string[];
  env: FoundingProductionEnv;
  prisma: PrismaClient;
  admin: FoundingAuthAdmin;
  now?: Date;
  cwd?: string;
  archiveRoot?: string;
  fetchImpl?: typeof fetch;
  generatePassword?: () => string;
}) {
  const args = assertFoundingSafety({
    argv: input.argv,
    destConfirmDb: PRODUCTION_CONFIRM_DB,
  });
  const now = input.now ?? new Date();
  const runId = createRunId(now);
  const cwd = input.cwd ?? process.cwd();
  const manifest = createEmptyManifest(runId);
  const cloudinary: FoundingCloudinaryConfig = {
    cloudName: input.env.cloudinaryCloudName,
    apiKey: input.env.cloudinaryApiKey,
    apiSecret: input.env.cloudinaryApiSecret,
  };

  const snapshots = await freezeFoundingSnapshots(input.archiveRoot ?? args.archiveRoot ?? undefined);
  for (const snapshot of snapshots) {
    manifest.archive[snapshot.dealerKey] = { runId: snapshot.runId, checksum: snapshot.checksum };
  }
  manifest.phase = "snapshots";
  writeManifest(runId, manifest, cwd);

  if (args.dryRun) {
    return dryRunReport({ snapshots, manifest, prisma: input.prisma });
  }

  const credentials: FoundingCredential[] = FOUNDING_DEALERS.map((dealer) => ({
    dealerKey: dealer.key,
    email: dealer.email,
    password: (input.generatePassword ?? generateFoundingPassword)(),
  }));
  const credentialPath = writeCredentials(runId, credentials, cwd);
  manifest.phase = "credentials";
  writeManifest(runId, manifest, cwd);

  try {
    await withFoundingAdvisoryLock(input.env.databaseUrl, async () => {
      await applyFoundingOnboard({
        snapshots,
        credentials,
        manifest,
        runId,
        cwd,
        prisma: input.prisma,
        admin: input.admin,
        cloudinary,
        now,
        fetchImpl: input.fetchImpl,
      });
    });
  } catch (error) {
    if (!manifest.dbCommitted) {
      await rollbackPreCommit({
        admin: input.admin,
        cloudinary,
        manifest,
        fetchImpl: input.fetchImpl,
      });
    }
    writeManifest(runId, manifest, cwd);
    throw error;
  }

  return { runId, credentialPath, manifest };
}

async function dryRunReport(input: {
  snapshots: Awaited<ReturnType<typeof freezeFoundingSnapshots>>;
  manifest: FoundingRunManifest;
  prisma: PrismaClient;
}) {
  const catalog = await loadCatalogIds(input.prisma);
  for (const required of ["car", "van", "motorbike"]) {
    if (!catalog.categories[required]) throw new Error(`Missing category ${required}`);
  }
  const reports = [];
  for (const snapshot of input.snapshots) {
    const dealer = FOUNDING_DEALERS.find((item) => item.key === snapshot.dealerKey)!;
    await assertNoNameCollision(input.prisma, dealer, dealer.email);
    if (!catalog.regions[dealer.regionSlug]) {
      throw new Error(`Missing region ${dealer.regionSlug}`);
    }
    const planned = await resolveFoundingListingPlan(input.prisma, {
      dealer,
      vehicles: snapshot.vehicles,
    });
    reports.push({
      dealerKey: dealer.key,
      email: dealer.email,
      archiveRunId: snapshot.runId,
      importable: planned.planned.filter((item) => !item.existing).length,
      alreadyImported: planned.planned.filter((item) => item.existing).length,
      overflow: planned.overflow,
      skipped: planned.skipped,
    });
  }
  return { dryRun: true as const, reports, runId: input.manifest.runId };
}

async function applyFoundingOnboard(input: {
  snapshots: Awaited<ReturnType<typeof freezeFoundingSnapshots>>;
  credentials: FoundingCredential[];
  manifest: FoundingRunManifest;
  runId: string;
  cwd: string;
  prisma: PrismaClient;
  admin: FoundingAuthAdmin;
  cloudinary: FoundingCloudinaryConfig;
  now: Date;
  fetchImpl?: typeof fetch;
}) {
  const authUsers = await listAuthUsers(input.admin);
  const issuedCredentials: FoundingCredential[] = [];
  const authByKey: Record<string, { id: string; email: string }> = {};
  for (const dealer of FOUNDING_DEALERS) {
    assertFoundingEmailAllowed(dealer.email);
    if (isPreviewSystemEmail(dealer.email)) {
      throw new Error("Refusing founding onboard: preview-system email.");
    }
    const credential = input.credentials.find((item) => item.dealerKey === dealer.key)!;
    const existing = findAuthUserByEmail(authUsers, dealer.email);
    const existingPrisma = await input.prisma.user.findFirst({
      where: { email: { equals: dealer.email, mode: "insensitive" } },
      select: { dealerProfile: { select: { id: true, isAdminPreview: true } } },
    });
    if (existingPrisma?.dealerProfile?.isAdminPreview) {
      throw new Error("Refusing founding onboard: cannot attach to an admin preview dealer.");
    }
    const ensured = await ensureFoundingAuthUser({
      admin: input.admin,
      dealer,
      credential,
      existing,
      manifestAuthUserId: input.manifest.authUserIds[dealer.key],
      rotatePassword: Boolean(existing) && !existingPrisma?.dealerProfile,
    });
    if (isPreviewSystemAuthUserId(ensured.user.id)) {
      throw new Error("Refusing founding onboard: preview-system auth id.");
    }
    if (ensured.created) {
      input.manifest.createdAuthUserIds = [...input.manifest.createdAuthUserIds, ensured.user.id];
    }
    if (ensured.passwordIssued) issuedCredentials.push(credential);
    authByKey[dealer.key] = { id: ensured.user.id, email: dealer.email };
    input.manifest.authUserIds[dealer.key] = ensured.user.id;
    input.manifest.phase = "auth";
    writeManifest(input.runId, input.manifest, input.cwd);
  }
  writeCredentials(input.runId, issuedCredentials, input.cwd);

  const imageMap = new Map<string, FoundingUploadedImage[]>();
  for (const snapshot of input.snapshots) {
    await assertSnapshotUnchanged(snapshot);
    const dealer = FOUNDING_DEALERS.find((item) => item.key === snapshot.dealerKey)!;
    const planned = await resolveFoundingListingPlan(input.prisma, {
      dealer,
      vehicles: snapshot.vehicles,
    });
    for (const item of planned.planned) {
      if (item.existing) continue;
      const vehicle = snapshot.vehicles.find((row) => row.identityKey === item.identityKey)!;
      const uploaded: FoundingUploadedImage[] = [];
      const images = vehicle.images
        .filter((image) => image.status === "ok" || image.localPath || image.originalUrl)
        .slice(0, FEATURED_LISTING_PHOTO_LIMIT);
      for (const [order, image] of images.entries()) {
        try {
          const bytes = await loadArchiveImageBytes({
            archiveDir: snapshot.dir,
            image,
            fetchImpl: input.fetchImpl,
          });
          const publicId = foundingImagePublicId(dealer.key, item.slug, order);
          const uploadedImage = await uploadFoundingImage({
            config: input.cloudinary,
            publicId,
            bytes: bytes.bytes,
            contentType: bytes.contentType,
            fetchImpl: input.fetchImpl,
          });
          uploaded.push({ ...uploadedImage, order });
          if (!uploadedImage.reused) {
            input.manifest.cloudinaryPublicIds = [...input.manifest.cloudinaryPublicIds, publicId];
            input.manifest.phase = "media";
            writeManifest(input.runId, input.manifest, input.cwd);
          }
        } catch (error) {
          if (error instanceof FoundingSkippableImageError) continue;
          throw error;
        }
      }
      imageMap.set(item.slug, uploaded);
    }
  }
  input.manifest.phase = "media";
  writeManifest(input.runId, input.manifest, input.cwd);

  await input.prisma.$transaction(
    async (tx) => {
      const adminUser = await loadFoundingAdmin(tx);
      const catalog = await loadCatalogIds(tx);
      for (const required of ["car", "van", "motorbike"]) {
        if (!catalog.categories[required]) throw new Error(`Missing category ${required}`);
      }
      for (const dealer of FOUNDING_DEALERS) {
        await assertNoNameCollision(tx, dealer, dealer.email);
        if (!catalog.regions[dealer.regionSlug]) {
          throw new Error(`Missing region ${dealer.regionSlug}`);
        }
        const snapshot = input.snapshots.find((item) => item.dealerKey === dealer.key)!;
        await assertSnapshotUnchanged(snapshot);
        const auth = authByKey[dealer.key]!;
        const prismaUser = await upsertFoundingPrismaUser(tx, {
          dealer,
          authUserId: auth.id,
          email: dealer.email,
        });
        if (prismaUser.authUserId !== auth.id || prismaUser.email.toLowerCase() !== dealer.email) {
          throw new Error("Refusing founding onboard: Auth/Prisma identity mismatch.");
        }
        const existingProfile = await tx.dealerProfile.findUnique({
          where: { userId: prismaUser.id },
          include: { subscriptions: true },
        });
        const plannedProfile = planFoundingProfile({
          prismaUserId: prismaUser.id,
          dealer,
          existing: existingProfile,
          subscriptions: existingProfile?.subscriptions ?? [],
          now: input.now,
        });
        const profile = existingProfile
          ? await tx.dealerProfile.update({
              where: { id: existingProfile.id },
              data: {
                name: dealer.displayName,
                website: plannedProfile.website,
                verified: true,
                tier: "PRO",
                bio: plannedProfile.bio,
                phone: plannedProfile.phone,
                logoUrl: plannedProfile.logoUrl,
                isAdminPreview: false,
              },
            })
          : await tx.dealerProfile.create({
              data: {
                userId: prismaUser.id,
                name: dealer.displayName,
                slug: plannedProfile.slug,
                website: plannedProfile.website,
                verified: true,
                tier: "PRO",
                bio: plannedProfile.bio,
                phone: plannedProfile.phone,
                logoUrl: plannedProfile.logoUrl,
                isAdminPreview: false,
              },
            });
        if (profile.isAdminPreview) {
          throw new Error("Refusing founding onboard: preview dealer.");
        }
        await tx.user.update({
          where: { id: prismaUser.id },
          data: { role: "DEALER", name: dealer.displayName },
        });
        if (plannedProfile.grant.kind === "create") {
          await tx.subscription.create({
            data: {
              dealerId: profile.id,
              paymentProvider: "ADMIN",
              source: "ADMIN_GRANT",
              status: "ACTIVE",
              currentPeriodEnd: plannedProfile.grant.endsAt,
              grantStartsAt: plannedProfile.grant.startsAt,
              grantEndsAt: plannedProfile.grant.endsAt,
              grantedByAdminId: adminUser.id,
            },
          });
        }
        input.manifest.grant[dealer.key] = {
          kind: plannedProfile.grant.kind,
          startsAt: plannedProfile.grant.startsAt.toISOString(),
          endsAt: plannedProfile.grant.endsAt.toISOString(),
        };

        const planned = await resolveFoundingListingPlan(tx, {
          dealer,
          vehicles: snapshot.vehicles,
        });
        let imported = 0;
        for (const item of planned.planned) {
          if (item.existing) continue;
          const created = await insertFoundingListing(tx, {
            userId: prismaUser.id,
            dealerId: profile.id,
            adminUserId: adminUser.id,
            planned: item,
            images: imageMap.get(item.slug) ?? [],
            catalog,
            dealer,
            now: input.now,
          });
          if (created.created) {
            imported += 1;
            input.manifest.listingSlugs = [...input.manifest.listingSlugs, item.slug];
          }
        }
        input.manifest.counts[dealer.key] = {
          imported,
          skipped: planned.skipped,
          overflow: planned.overflow,
        };
      }
      input.manifest.phase = "db";
    },
    { isolationLevel: "Serializable", timeout: 120_000 },
  );
  input.manifest.dbCommitted = true;
  writeManifest(input.runId, input.manifest, input.cwd);
  await verifyFoundingPostflight(input.prisma, input.admin, input.manifest);
  input.manifest.phase = "postflight";
  writeManifest(input.runId, input.manifest, input.cwd);
}

async function verifyFoundingPostflight(
  prisma: PrismaClient,
  admin: FoundingAuthAdmin,
  manifest: FoundingRunManifest,
) {
  const authUsers = await listAuthUsers(admin);
  for (const dealer of FOUNDING_DEALERS) {
    const auth = findAuthUserByEmail(authUsers, dealer.email);
    if (!auth || auth.id !== manifest.authUserIds[dealer.key]) {
      throw new Error(`Founding postflight failed: ${dealer.key} Auth user is missing.`);
    }
    const user = await prisma.user.findFirst({
      where: { email: { equals: dealer.email, mode: "insensitive" } },
      include: {
        dealerProfile: {
          include: { subscriptions: true, listings: { select: { slug: true, status: true, previewPackId: true } } },
        },
      },
    });
    if (!user?.dealerProfile) {
      throw new Error(`Founding postflight failed: ${dealer.key} is missing a real dealer profile.`);
    }
    if (user.authUserId !== auth.id) {
      throw new Error(`Founding postflight failed: ${dealer.key} Auth/Prisma mismatch.`);
    }
    if (user.dealerProfile.isAdminPreview || user.dealerProfile.tier !== "PRO" || !user.dealerProfile.verified) {
      throw new Error(`Founding postflight failed: ${dealer.key} profile is not a verified Pro dealer.`);
    }
    const grants = user.dealerProfile.subscriptions.filter(
      (row) => row.source === "ADMIN_GRANT" && row.status === "ACTIVE",
    );
    if (grants.length !== 1) {
      throw new Error(`Founding postflight failed: ${dealer.key} grant count is ${grants.length}.`);
    }
    const expectedSlugs = manifest.listingSlugs.filter((slug) => slug.startsWith(`fd-${dealer.key}-`));
    for (const slug of expectedSlugs) {
      const listing = user.dealerProfile.listings.find((row) => row.slug === slug);
      if (!listing || listing.status !== "LIVE" || listing.previewPackId) {
        throw new Error(`Founding postflight failed: ${dealer.key} listing ${slug} is not public LIVE.`);
      }
    }
  }
}

async function upsertFoundingPrismaUser(
  tx: Prisma.TransactionClient,
  input: { dealer: FoundingDealer; authUserId: string; email: string },
) {
  const byAuth = await tx.user.findUnique({ where: { authUserId: input.authUserId } });
  const byEmail = await tx.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
  });
  if (byAuth && byEmail && byAuth.id !== byEmail.id) {
    throw new Error("Refusing founding onboard: Auth/Prisma email identity split.");
  }
  const existing = byAuth ?? byEmail;
  if (existing) {
    if (existing.authUserId !== input.authUserId || existing.email.toLowerCase() !== input.email.toLowerCase()) {
      throw new Error("Refusing founding onboard: Auth/Prisma identity mismatch.");
    }
    return existing;
  }
  return tx.user.create({
    data: {
      authUserId: input.authUserId,
      email: input.email,
      name: input.dealer.displayName,
      role: "DEALER",
    },
  });
}

export async function rollbackPreCommit(input: {
  admin: FoundingAuthAdmin;
  cloudinary: FoundingCloudinaryConfig;
  manifest: FoundingRunManifest;
  fetchImpl?: typeof fetch;
}) {
  const errors: string[] = [];
  try {
    await deleteFoundingCloudinaryAssets({
      config: input.cloudinary,
      publicIds: input.manifest.cloudinaryPublicIds,
      fetchImpl: input.fetchImpl,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Cloudinary rollback failed.");
  }
  for (const id of input.manifest.createdAuthUserIds) {
    try {
      const { error } = await input.admin.auth.admin.deleteUser(id);
      if (error) errors.push(error.message);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Auth rollback failed for ${id}.`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Founding pre-commit rollback incomplete: ${errors.join("; ")}`);
  }
}
