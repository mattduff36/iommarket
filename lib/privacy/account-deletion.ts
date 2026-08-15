import type { AccountDeletionJob, AccountDeletionPhase, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPolicyFlags } from "@/lib/policy/flags";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteImage } from "@/lib/upload/cloudinary";

const LEASE_MS = 5 * 60_000;
const RETRY_MS = 15 * 60_000;

type DbClient = Prisma.TransactionClient | typeof db;

export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

export function activeDeletionLeaseWhere(
  job: Pick<AccountDeletionJob, "id" | "leaseToken">,
  now = new Date(),
) {
  return {
    id: job.id,
    leaseToken: job.leaseToken,
    status: "PROCESSING" as const,
    leaseExpiresAt: { gt: now },
  };
}

export async function enqueueAccountDeletionJob(
  client: DbClient,
  userId: string,
) {
  return client.accountDeletionJob.upsert({
    where: { userId },
    create: {
      userId,
      status: "REQUESTED",
      phase: "REQUESTED",
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

export async function hasActiveLegalHold(entityType: string, entityId: string) {
  const hold = await db.retentionLegalHold.findFirst({
    where: { entityType, entityId, releasedAt: null },
    select: { id: true },
  });
  return Boolean(hold);
}

function cloudinaryPublicIdFromUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("res.cloudinary.com")) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.findIndex((part) => part === "upload" || part === "private");
    if (uploadIndex < 0) return null;
    const rest = parts.slice(uploadIndex + 1).filter((part) => !part.startsWith("v") || part.length < 3);
    const publicId = rest.join("/").replace(/\.[a-zA-Z0-9]+$/, "");
    return publicId || null;
  } catch {
    return null;
  }
}

async function deleteProfileMedia(urls: Array<string | null | undefined>) {
  for (const url of urls) {
    const publicId = cloudinaryPublicIdFromUrl(url);
    if (!publicId) continue;
    try {
      await deleteImage(publicId);
    } catch {
      // Media deletion is best-effort; the job still anonymises the profile.
    }
  }
}

async function renewDeletionLease(
  client: DbClient,
  job: AccountDeletionJob,
  phase: AccountDeletionPhase,
  now = new Date(),
) {
  const renewed = await client.accountDeletionJob.updateMany({
    where: activeDeletionLeaseWhere(job, now),
    data: {
      phase,
      lockedAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    },
  });
  if (renewed.count !== 1) {
    throw new AccountDeletionError("Deletion lease is no longer owned.");
  }
}

async function leaseNextDeletionJob(now = new Date()) {
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const leaseToken = crypto.randomUUID();
  return db.$transaction(async (tx) => {
    const job = await tx.accountDeletionJob.findFirst({
      where: {
        status: { in: ["REQUESTED", "FAILED", "PROCESSING"] },
        NOT: { lastError: "LEGAL_HOLD" },
        OR: [
          { status: "PROCESSING", leaseExpiresAt: { lte: now } },
          {
            status: { in: ["REQUESTED", "FAILED"] },
            AND: [
              { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
              { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
            ],
          },
        ],
      },
      orderBy: { requestedAt: "asc" },
    });
    if (!job) return null;
    const leased = await tx.accountDeletionJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        status: "PROCESSING",
        lockedAt: now,
        leaseToken,
        leaseExpiresAt,
        attempts: { increment: 1 },
      },
    });
    if (leased.count !== 1) return null;
    return tx.accountDeletionJob.findUniqueOrThrow({ where: { id: job.id } });
  });
}

async function failJob(job: AccountDeletionJob, error: string) {
  const now = new Date();
  await db.accountDeletionJob.updateMany({
    where: activeDeletionLeaseWhere(job, now),
    data: {
      status: "FAILED",
      lastError: error,
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: error === "LEGAL_HOLD" ? null : new Date(now.getTime() + RETRY_MS),
    },
  });
}

async function anonymiseAccountRows(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { dealerProfile: true },
  });
  if (!user) throw new AccountDeletionError("User not found");

  await tx.favourite.deleteMany({ where: { userId } });
  await tx.savedSearch.deleteMany({ where: { userId } });
  await tx.listingView.updateMany({
    where: { viewerId: userId },
    data: { viewerId: null },
  });
  if (user.dealerProfile) {
    await tx.dealerProfile.update({
      where: { id: user.dealerProfile.id },
      data: {
        name: "Deleted dealer",
        slug: `deleted-${user.dealerProfile.id}`,
        bio: null,
        website: null,
        phone: null,
        logoUrl: null,
        verified: false,
      },
    });
  }
  await tx.user.update({
    where: { id: userId },
    data: {
      email: `deleted+${userId}@invalid.local`,
      name: "Deleted user",
      phone: null,
      bio: null,
      avatarUrl: null,
      authUserId: `deleted:${userId}`,
      deletedAt: user.deletedAt ?? new Date(),
      disabledAt: user.disabledAt ?? new Date(),
    },
  });
}

export async function anonymiseAccountAndComplete(
  tx: Prisma.TransactionClient,
  job: AccountDeletionJob,
  now = new Date(),
) {
  await renewDeletionLease(tx, job, "ANONYMISE", now);
  await anonymiseAccountRows(tx, job.userId);
  const completeNow = new Date();
  const completed = await tx.accountDeletionJob.updateMany({
    where: activeDeletionLeaseWhere(job, completeNow),
    data: {
      status: "COMPLETED",
      phase: "COMPLETED",
      completedAt: completeNow,
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  if (completed.count !== 1) {
    throw new AccountDeletionError("Deletion lease is no longer owned.");
  }
}

export async function processAccountDeletionJob(job: AccountDeletionJob) {
  if (await hasActiveLegalHold("USER", job.userId)) {
    await failJob(job, "LEGAL_HOLD");
    return { status: "FAILED" as const, reason: "LEGAL_HOLD" };
  }

  try {
    await renewDeletionLease(db, job, "AUTH");
    const user = await db.user.findUnique({
      where: { id: job.userId },
      include: { dealerProfile: true },
    });
    if (!user) throw new AccountDeletionError("User not found");

    if (user.authUserId && !user.authUserId.startsWith("deleted:")) {
      const admin = createSupabaseAdminClient();
      const { error } = await admin.auth.admin.deleteUser(user.authUserId);
      if (error && !/not found|user not found/i.test(error.message)) {
        throw new AccountDeletionError(error.message);
      }
    }

    await renewDeletionLease(db, job, "MEDIA");
    await deleteProfileMedia([user.avatarUrl, user.dealerProfile?.logoUrl]);

    await db.$transaction(async (tx) => {
      await anonymiseAccountAndComplete(tx, job);
    });
    return { status: "COMPLETED" as const };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Account deletion failed";
    await failJob(job, message);
    return { status: "FAILED" as const, reason: message };
  }
}

export async function runAccountDeletionWorker(limit = 10) {
  if (!getPolicyFlags().enableDeletionWorker) {
    return { processed: 0, skipped: true as const };
  }

  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await leaseNextDeletionJob();
    if (!job) break;
    await processAccountDeletionJob(job);
    processed += 1;
  }
  return { processed, skipped: false as const };
}

export function canRestoreDeletedUser(job: {
  status: AccountDeletionJob["status"];
} | null) {
  if (!job) return true;
  return job.status !== "PROCESSING" && job.status !== "COMPLETED";
}

export async function cancelRestorableDeletionJob(
  client: DbClient,
  userId: string,
) {
  const job = await client.accountDeletionJob.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (!canRestoreDeletedUser(job)) {
    throw new AccountDeletionError(
      "This account has a processing or completed deletion job and cannot be restored.",
    );
  }
  if (!job || job.status === "CANCELLED") return job;
  const cancelled = await client.accountDeletionJob.updateMany({
    where: {
      id: job.id,
      status: { in: ["REQUESTED", "FAILED"] },
    },
    data: {
      status: "CANCELLED",
      lockedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      lastError: null,
    },
  });
  if (cancelled.count !== 1) {
    throw new AccountDeletionError(
      "This account has a processing or completed deletion job and cannot be restored.",
    );
  }
  return job;
}
