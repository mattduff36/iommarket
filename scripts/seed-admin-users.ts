/**
 * One-time script to create the two initial admin users in Supabase Auth
 * and upsert corresponding Prisma User rows with role ADMIN.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 *
 * Run: npm run seed:admin (loads .env.local then .env)
 */
import dotenv from "dotenv";
import { resolve } from "path";

// Load .env.local first (overrides), then .env for defaults (Next.js precedence)
dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), ".env") });
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const ADMIN_USERS = [
  { email: "admin@mpdee.co.uk", password: "Changeme123!", name: "Admin (mpdee)" },
  { email: "d.p.marshall@hotmail.co.uk", password: "Changeme123!", name: "D.P. Marshall" },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env and run again."
    );
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const raw =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? "";
  if (!raw) throw new Error("Missing DATABASE_URL or POSTGRES_URL_NON_POOLING");

  // Strip sslmode so pg v8+ doesn't treat require as verify-full (matches prisma/seed.ts)
  function cleanUrl(s: string): string {
    try {
      const u = new URL(s.trim());
      u.searchParams.delete("sslmode");
      return u.toString();
    } catch {
      return s.trim();
    }
  }

  const pool = new pg.Pool({
    connectionString: cleanUrl(raw),
    ssl: { rejectUnauthorized: false },
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  for (const { email, password, name } of ADMIN_USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : undefined,
    });

    if (error) {
      if (error.message.includes("already been registered")) {
        const existing = await supabase.auth.admin.listUsers();
        const user = existing.data.users.find((u) => u.email === email);
        if (user) {
          await prisma.user.upsert({
            where: { authUserId: user.id },
            update: { role: "ADMIN" },
            create: {
              authUserId: user.id,
              email: user.email ?? email,
              name: name ?? (user.user_metadata?.full_name as string | undefined),
              role: "ADMIN",
            },
          });
          console.log(`  Admin already exists in Auth; synced Prisma User: ${email}`);
          continue;
        }
      }
      throw new Error(`Failed to create admin ${email}: ${error.message}`);
    }

    if (!data.user) throw new Error(`No user returned for ${email}`);

    await prisma.user.upsert({
      where: { authUserId: data.user.id },
      update: { role: "ADMIN" },
      create: {
        authUserId: data.user.id,
        email: data.user.email ?? email,
        name: name ?? (data.user.user_metadata?.full_name as string | undefined),
        role: "ADMIN",
      },
    });
    console.log(`  Created admin: ${email}`);
  }

  await pool.end();
  console.log("Done. Admin users can sign in at /sign-in. They should change their password after first sign-in.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
