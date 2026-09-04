/**
 * Confirmation-gated preview marketplace rebuild.
 * Workstream: PREVIEW-SAMPLE-A7C3E91F
 *
 * Default: verify backups, print the snapshot card, exit without writes.
 * Apply:   npx tsx scripts/preview-rebuild.ts --confirm="<token from card>"
 */
import dotenv from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { applyMarketplacePlan } from "../prisma/seed/apply";
import { buildMarketplacePlan } from "../prisma/seed/dataset";
import { assertSeedGuards } from "../prisma/seed/guards";
import {
  assertPreviewSeedEnvFile,
  choosePreviewSeedConnectionString,
  PREVIEW_SEED_KEEP_EMAILS,
} from "./seed-preview-marketplace/target";
import { parseRebuildArgs } from "./preview-rebuild/args";
import { verifyPairedBackups } from "./preview-rebuild/backups";
import { loadPreserveFingerprint } from "./preview-rebuild/fingerprint";
import { applyPreviewRebuildInTransaction } from "./preview-rebuild/phase";
import { runPreviewRebuild, type RebuildLiveState } from "./preview-rebuild/run";
import { plannedAuthDeletions, resolveAuthUsersToDelete } from "./preview-rebuild/auth";
import { assertPreflightAuthRoster } from "./wipe-preview-marketplace/target";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

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

type PreviewAuthAdmin = {
  auth: {
    admin: {
      listUsers: (args: { page: number; perPage: number }) => Promise<{
        data: { users?: Array<{ id: string; email?: string | null }> | null };
        error: { message: string } | null;
      }>;
      deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

async function listAuthUsers(admin: PreviewAuthAdmin) {
  const users: Array<{ id: string; email: string }> = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list Auth users: ${error.message}`);
    const batch = data.users ?? [];
    for (const user of batch) {
      users.push({ id: user.id, email: user.email ?? `__no_email__:${user.id}` });
    }
    if (batch.length < perPage) break;
    page += 1;
  }
  return users;
}

export async function main(argv = process.argv.slice(2)) {
  assertPreviewSeedEnvFile(process.env.SEED_ENV_FILE);
  const { confirm } = parseRebuildArgs(argv);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const connectionString = choosePreviewSeedConnectionString({
    databaseUrl: process.env.DATABASE_URL,
    postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
    supabaseUrl,
  });
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const loadState = async (): Promise<RebuildLiveState> => {
    const [users, listings, dealers, preserve] = await Promise.all([
      prisma.user.findMany({ select: { email: true } }),
      prisma.listing.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.dealerProfile.findMany({ select: { name: true } }),
      loadPreserveFingerprint(prisma),
    ]);
    const listingByStatus: Record<string, number> = {};
    let listingCount = 0;
    for (const row of listings) {
      listingByStatus[row.status] = row._count._all;
      listingCount += row._count._all;
    }
    const authEmails = (await listAuthUsers(admin)).map((user) => user.email);
    assertPreflightAuthRoster(authEmails);
    plannedAuthDeletions(authEmails);
    return {
      prismaEmails: users.map((user) => user.email),
      authEmails,
      listingCount,
      listingByStatus,
      dealerNames: dealers.map((dealer) => dealer.name),
      preserve,
    };
  };

  try {
    const result = await runPreviewRebuild({
      confirm,
      hooks: {
        verifyBackups: verifyPairedBackups,
        loadState,
        mutate: confirm
          ? {
              deleteAuth: async (emails) => {
                const targets = resolveAuthUsersToDelete(await listAuthUsers(admin), emails);
                for (const user of targets) {
                  const { error } = await admin.auth.admin.deleteUser(user.id);
                  if (error) {
                    throw new Error(`Failed to delete Auth user ${user.email}: ${error.message}`);
                  }
                }
              },
              verifyAuth: async () =>
                (await listAuthUsers(admin)).map((user) => user.email),
              rebuildDatabase: async (before) => {
                const users = await prisma.user.findMany({
                  select: {
                    id: true,
                    authUserId: true,
                    email: true,
                    name: true,
                    role: true,
                  },
                });
                const keep = new Set<string>(PREVIEW_SEED_KEEP_EMAILS);
                const preservedUsers = users.filter((user) =>
                  keep.has(user.email.trim().toLowerCase()),
                );
                if (preservedUsers.length !== PREVIEW_SEED_KEEP_EMAILS.length) {
                  throw new Error(
                    `Preview rebuild requires kept admins: ${PREVIEW_SEED_KEEP_EMAILS.join(", ")}`,
                  );
                }
                const preservedIdentities = preservedUsers.map((user) => ({
                  id: user.id,
                  authUserId: user.authUserId,
                  email: user.email,
                  role: user.role,
                }));
                const [holds, inbox, deletionJobs] = await Promise.all([
                  prisma.retentionLegalHold.findMany({
                    where: { releasedAt: null },
                    select: { entityType: true, releasedAt: true },
                  }),
                  prisma.paymentWebhookInbox.findMany({ select: { status: true } }),
                  prisma.accountDeletionJob.findMany({
                    select: { userId: true, status: true },
                  }),
                ]);
                assertSeedGuards({
                  holds,
                  inboxStatuses: inbox.map((row) => row.status),
                  preservedDeletionJobs: deletionJobs.filter((job) =>
                    preservedIdentities.some((user) => user.id === job.userId),
                  ),
                });
                const now = new Date();
                const plan = buildMarketplacePlan({
                  preservedDealers: [],
                  preservedUsers: preservedUsers.map((user) => ({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                  })),
                  now,
                });
                return applyPreviewRebuildInTransaction({
                  transaction: (
                    work: (tx: Prisma.TransactionClient) => Promise<
                      Awaited<ReturnType<typeof loadPreserveFingerprint>>
                    >,
                  ) => prisma.$transaction(work, { timeout: 300_000, maxWait: 20_000 }),
                  apply: (tx: Prisma.TransactionClient) =>
                    applyMarketplacePlan(tx, {
                      plan,
                      preservedIdentities,
                      now,
                      stripPreservedDealerProfiles: true,
                      resolveCatalogOnly: true,
                    }),
                  loadFingerprint: loadPreserveFingerprint,
                  before,
                });
              },
            }
          : undefined,
      },
    });
    if (result.mutated) {
      process.stdout.write("Preview rebuild applied.\n");
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (process.argv[1]?.includes("preview-rebuild.ts")) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Preview rebuild failed."}\n`,
    );
    process.exitCode = 1;
  });
}
