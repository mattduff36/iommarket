/**
 * Read-only post-rebuild verification. Does not mutate.
 */
import dotenv from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { choosePreviewSeedConnectionString } from "../seed-preview-marketplace/target";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

function cleanUrl(raw: string) {
  const parsed = new URL(raw.trim());
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("pgbouncer");
  parsed.searchParams.delete("supa");
  return parsed.toString();
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const connectionString = choosePreviewSeedConnectionString({
    databaseUrl: process.env.DATABASE_URL,
    postgresUrlNonPooling: process.env.POSTGRES_URL_NON_POOLING,
    supabaseUrl,
  });
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase env.");
  const pool = new pg.Pool({
    connectionString: cleanUrl(connectionString),
    ssl: { rejectUnauthorized: false },
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const [users, listings, dealers, packs, auth, categories] = await Promise.all([
      prisma.user.findMany({ select: { email: true, role: true } }),
      prisma.listing.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.dealerProfile.findMany({ select: { name: true } }),
      prisma.dealerPreviewPack.count(),
      admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
      prisma.category.findMany({ select: { id: true, slug: true } }),
    ]);
    const categoryRows = await prisma.listing.groupBy({
      by: ["categoryId"],
      _count: { _all: true },
    });
    const photoRows = await prisma.listing.findMany({
      where: { status: { in: ["LIVE", "PENDING", "SOLD"] } },
      select: { status: true, _count: { select: { images: true } } },
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          auth: (auth.data.users ?? []).map((user) => user.email),
          userCount: users.length,
          emails: users.map((user) => user.email).sort(),
          listings,
          dealerCount: dealers.length,
          dealers: dealers.map((dealer) => dealer.name).sort(),
          packs,
          categories: Object.fromEntries(
            categoryRows.map((row) => [
              categories.find((category) => category.id === row.categoryId)?.slug ??
                row.categoryId,
              row._count._all,
            ]),
          ),
          livePendingSoldUnder2Photos: photoRows.filter((row) => row._count.images < 2)
            .length,
          blockedDealers: dealers.filter((dealer) =>
            /morris|ocean/i.test(dealer.name),
          ),
          blockedUsers: users.filter((user) =>
            /davooomarsh|mattduff36/i.test(user.email),
          ),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
