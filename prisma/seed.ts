import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { applyMarketplacePlan } from "./seed/apply";
import { buildMarketplacePlan } from "./seed/dataset";
import { getSeedConnectionString, loadSeedEnv } from "./seed/env";
import { assertSeedGuards } from "./seed/guards";
import { comparePreservedIdentities, isPreservedAuthUserId } from "./seed/preserve";
import { assertSeedSafety, parseDatabaseHost, redactDatabaseTarget } from "./seed/target";

function cleanUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("pgbouncer");
    parsed.searchParams.delete("supa");
    return parsed.toString();
  } catch {
    return raw.trim();
  }
}

async function main() {
  loadSeedEnv();
  const connectionString = getSeedConnectionString();
  const databaseHost = parseDatabaseHost(connectionString);
  const redactedDatabase = redactDatabaseTarget(connectionString);
  assertSeedSafety(
    {
      SEED_ALLOW: process.env.SEED_ALLOW,
      SEED_TARGET: process.env.SEED_TARGET,
      SEED_ENV_FILE: process.env.SEED_ENV_FILE,
      SEED_BACKUP_ID: process.env.SEED_BACKUP_ID,
      SEED_CONFIRM_DB: process.env.SEED_CONFIRM_DB,
      SEED_WRITERS_PAUSED: process.env.SEED_WRITERS_PAUSED,
    },
    { databaseHost, redactedDatabase },
  );

  if (!connectionString) {
    throw new Error("No database URL found for seed.");
  }

  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [users, holds, inbox, deletionJobs] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          authUserId: true,
          email: true,
          name: true,
          role: true,
          dealerProfile: {
            select: { id: true, slug: true, name: true, tier: true, verified: true },
          },
        },
      }),
      prisma.retentionLegalHold.findMany({
        where: { releasedAt: null },
        select: { entityType: true, releasedAt: true },
      }),
      prisma.paymentWebhookInbox.findMany({
        select: { status: true },
      }),
      prisma.accountDeletionJob.findMany({
        select: { userId: true, status: true },
      }),
    ]);

    const preservedUsers = users.filter((user) =>
      isPreservedAuthUserId(user.authUserId),
    );
    const preservedIdentities = preservedUsers.map((user) => ({
      id: user.id,
      authUserId: user.authUserId,
      email: user.email,
      role: user.role,
    }));

    assertSeedGuards({
      holds,
      inboxStatuses: inbox.map((row) => row.status),
      preservedDeletionJobs: deletionJobs.filter((job) =>
        preservedIdentities.some((user) => user.id === job.userId),
      ),
    });

    console.log(
      `Preflight: ${preservedIdentities.length} preserved logins, ${users.length} users total.`,
    );
    for (const user of preservedIdentities) {
      console.log(`  keep ${user.role} ${user.email}`);
    }

    const now = new Date();
    const plan = buildMarketplacePlan({
      preservedDealers: preservedUsers
        .filter((user) => user.dealerProfile)
        .map((user) => ({
          userId: user.id,
          dealerId: user.dealerProfile!.id,
          slug: user.dealerProfile!.slug,
          name: user.dealerProfile!.name,
          tier: user.dealerProfile!.tier,
          verified: user.dealerProfile!.verified,
        })),
      preservedUsers: preservedUsers.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      })),
      now,
    });

    await prisma.$transaction(
      async (tx) => {
        await applyMarketplacePlan(tx, {
          plan,
          preservedIdentities,
          now,
        });
        const identities = await tx.user.findMany({
          where: { id: { in: preservedIdentities.map((row) => row.id) } },
          select: { id: true, authUserId: true, email: true, role: true },
        });
        comparePreservedIdentities(preservedIdentities, identities);
      },
      { timeout: 300_000, maxWait: 20_000 },
    );

    const after = await prisma.user.findMany({
      where: { id: { in: preservedIdentities.map((row) => row.id) } },
      select: { id: true, authUserId: true, email: true, role: true },
    });
    comparePreservedIdentities(preservedIdentities, after);

    const [live, sold, expired, dealers] = await Promise.all([
      prisma.listing.count({ where: { status: "LIVE" } }),
      prisma.listing.count({ where: { status: "SOLD" } }),
      prisma.listing.count({ where: { status: "EXPIRED" } }),
      prisma.dealerProfile.count(),
    ]);
    console.log(
      `Seed ${plan.version} complete: ${dealers} dealers, ${live} live, ${sold} sold, ${expired} expired.`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed.");
  process.exitCode = 1;
});
