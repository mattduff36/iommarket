/**
 * Preview-only marketplace wipe for new-ford-dealership.
 * Workstream: FORD-WIPE-5E1E14
 *
 * Requires .env.local pointed at preview project syneonzucehwlghqmfbg.
 * Does not delete Cloudinary assets. Does not re-seed.
 *
 * Run: npx tsx scripts/wipe-preview-marketplace.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { wipeMarketplace } from "../prisma/seed/wipe";
import {
  DELETE_AUTH_EMAILS,
  KEEP_ACCOUNT_EMAILS,
  assertKeptDealerProfiles,
  assertKeptEmails,
  assertPreviewWipePreflight,
  assertPreserveCountsUnchanged,
  chooseWipeConnectionString,
  type PreserveCounts,
} from "./wipe-preview-marketplace/target";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

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

async function snapshotPreserveCounts(prisma: PrismaClient): Promise<PreserveCounts> {
  const [waitlistUsers, siteSettings, regions, categories, costEntries] = await Promise.all([
    prisma.waitlistUser.count(),
    prisma.siteSetting.count(),
    prisma.region.count(),
    prisma.category.count(),
    prisma.costEntry.count(),
  ]);
  return { waitlistUsers, siteSettings, regions, categories, costEntries };
}

async function listAuthUsers(admin: SupabaseClient) {
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

async function deletePreviewAuthUsers(
  admin: SupabaseClient,
  users: Array<{ id: string; email: string }>,
) {
  for (const email of DELETE_AUTH_EMAILS) {
    const matches = users.filter(
      (user) => user.email.trim().toLowerCase() === email,
    );
    if (matches.length === 0) {
      throw new Error(`Auth user not found for deletion: ${email}`);
    }
    if (matches.length > 1) {
      throw new Error(`Refusing Auth delete: ${matches.length} users match ${email}`);
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(matches[0].id);
    if (deleteError) {
      throw new Error(`Failed to delete Auth user ${email}: ${deleteError.message}`);
    }
  }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const connectionString = chooseWipeConnectionString({
    databaseUrl: process.env.DATABASE_URL,
    postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
    supabaseUrl,
  });

  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        dealerProfile: { select: { name: true } },
      },
    });
    const authUsers = await listAuthUsers(admin);
    const { preservedUserIds } = assertPreviewWipePreflight({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        dealerName: user.dealerProfile?.name ?? null,
      })),
      authUsers,
    });
    const beforePreserve = await snapshotPreserveCounts(prisma);

    await prisma.$transaction(
      async (tx) => {
        await wipeMarketplace(tx, preservedUserIds);
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    await deletePreviewAuthUsers(admin, authUsers);

    const [remainingUsers, remainingDealers, listingCount, paymentCount, reviewCount, afterPreserve] =
      await Promise.all([
        prisma.user.findMany({
          select: { email: true },
          orderBy: { email: "asc" },
        }),
        prisma.dealerProfile.findMany({
          select: { name: true, slug: true },
          orderBy: { name: "asc" },
        }),
        prisma.listing.count(),
        prisma.payment.count(),
        prisma.dealerReview.count(),
        snapshotPreserveCounts(prisma),
      ]);

    const remainingEmails = remainingUsers.map((user) => user.email);
    assertKeptEmails(remainingEmails);
    assertKeptDealerProfiles(remainingDealers);
    assertPreserveCountsUnchanged(beforePreserve, afterPreserve);

    if (listingCount !== 0 || paymentCount !== 0 || reviewCount !== 0) {
      throw new Error(
        `Marketplace not empty: listings=${listingCount} payments=${paymentCount} reviews=${reviewCount}`,
      );
    }

    const sampleUsers = remainingEmails.filter(
      (email) => email.endsWith(".im") || email.endsWith("@example.im"),
    );
    if (sampleUsers.length > 0) {
      throw new Error(`Sample users remain: ${sampleUsers.join(", ")}`);
    }

    const authEmails = (await listAuthUsers(admin)).map((user) => user.email);
    assertKeptEmails(authEmails, KEEP_ACCOUNT_EMAILS);
    const deletedAuth = new Set<string>(DELETE_AUTH_EMAILS);
    if (authEmails.some((email) => deletedAuth.has(email.trim().toLowerCase()))) {
      throw new Error("AV Squires Auth user still present.");
    }

    process.stdout.write(
      [
        "Preview marketplace wipe complete.",
        `users=${remainingEmails.join(",")}`,
        `dealers=${remainingDealers.map((dealer) => dealer.slug).join(",")}`,
        `listings=${listingCount}`,
        `payments=${paymentCount}`,
        `reviews=${reviewCount}`,
        `auth_users=${authEmails.length}`,
        `waitlist=${afterPreserve.waitlistUsers}`,
        `settings=${afterPreserve.siteSettings}`,
        `regions=${afterPreserve.regions}`,
        `categories=${afterPreserve.categories}`,
        `cost_entries=${afterPreserve.costEntries}`,
        "",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
