/**
 * Applies the Clerk → Supabase auth schema migration (User.clerkId → authUserId, UserRole enum).
 * Run once if your DB still has the old schema: npx tsx scripts/run-auth-migration.ts
 *
 * Loads .env.local then .env (same as seed:admin).
 */
import dotenv from "dotenv";
import { resolve } from "path";
import pg from "pg";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const raw =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "";
if (!raw) throw new Error("Missing DATABASE_URL or POSTGRES_URL_NON_POOLING");

function cleanUrl(s: string): string {
  try {
    const u = new URL(s.trim());
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return s.trim();
  }
}

const migrationSql = `
-- Rename User.clerkId to authUserId
ALTER TABLE "User" RENAME COLUMN "clerkId" TO "authUserId";

-- Recreate indexes (names may differ; drop if exist then create)
DROP INDEX IF EXISTS "User_clerkId_key";
DROP INDEX IF EXISTS "User_clerkId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "User_authUserId_key" ON "User"("authUserId");
CREATE INDEX IF NOT EXISTS "User_authUserId_idx" ON "User"("authUserId");

-- Replace UserRole enum: BUYER/SELLER -> USER
CREATE TYPE "UserRole_new" AS ENUM ('USER', 'DEALER', 'ADMIN');

ALTER TABLE "User" ALTER COLUMN role DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN role TYPE "UserRole_new" USING (
  CASE role::text
    WHEN 'BUYER' THEN 'USER'::"UserRole_new"
    WHEN 'SELLER' THEN 'USER'::"UserRole_new"
    ELSE role::text::"UserRole_new"
  END
);
ALTER TABLE "User" ALTER COLUMN role SET DEFAULT 'USER'::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
`;

async function main() {
  const client = new pg.Client({
    connectionString: cleanUrl(raw),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const check = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'authUserId'
    `);
    if (check.rows.length > 0) {
      console.log("Schema already has authUserId; nothing to do.");
      return;
    }
    await client.query(migrationSql);
    console.log("Auth migration applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
