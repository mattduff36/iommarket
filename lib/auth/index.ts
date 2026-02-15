import { db } from "@/lib/db";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@prisma/client";

/**
 * Get the current authenticated user from DB, syncing from Supabase Auth if needed.
 * Returns null if not authenticated or Supabase Auth is not configured.
 */
export async function getCurrentUser() {
  if (!isSupabaseAuthConfigured()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  let user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { dealerProfile: true },
  });

  if (!user) {
    const synced = await syncUser(
      authUser.id,
      authUser.email ?? "",
      authUser.user_metadata?.full_name as string | undefined
    );
    return db.user.findUnique({
      where: { id: synced.id },
      include: { dealerProfile: true },
    });
  }

  return user ?? null;
}

/**
 * Sync a Supabase Auth user to the local database (called on first visit after sign-in).
 */
export async function syncUser(authUserId: string, email: string, name?: string) {
  return db.user.upsert({
    where: { authUserId },
    update: { email, name },
    create: { authUserId, email, name, role: "USER" },
  });
}

/**
 * Require authentication. Throws if not authenticated.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

/**
 * Require a specific role. Throws if role doesn't match.
 */
export async function requireRole(role: UserRole) {
  const user = await requireAuth();
  if (user.role !== role && user.role !== "ADMIN") {
    throw new Error("Insufficient permissions");
  }
  return user;
}

/**
 * Check if the current user is an admin.
 */
export async function isAdmin() {
  const user = await getCurrentUser();
  return user?.role === "ADMIN";
}
