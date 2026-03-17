import { db } from "@/lib/db";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { UserRole } from "@prisma/client";
import { z } from "zod";

const signUpRoleSchema = z.enum(["USER", "DEALER"]);

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

  const parsedRole = signUpRoleSchema.safeParse(authUser.user_metadata?.role);
  const requestedRole = parsedRole.success ? parsedRole.data : undefined;

  const user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { dealerProfile: true },
  });

  if (!user) {
    const synced = await syncUser(
      authUser.id,
      authUser.email ?? "",
      authUser.user_metadata?.full_name as string | undefined,
      requestedRole
    );
    return db.user.findUnique({
      where: { id: synced.id },
      include: { dealerProfile: true },
    });
  }

  return user;
}

/**
 * Sync a Supabase Auth user to the local database (called on first visit after sign-in).
 */
export async function syncUser(
  authUserId: string,
  email: string,
  name?: string,
  role: "USER" | "DEALER" = "USER"
) {
  return db.user.upsert({
    where: { authUserId },
    update: { email, name },
    create: { authUserId, email, name, role },
  });
}

/**
 * Require authentication. Throws if not authenticated or account is disabled.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  if (user.disabledAt) {
    throw new Error("Account disabled");
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
 * Check if the current user is an authenticated, non-disabled admin.
 */
export async function isAdmin() {
  try {
    const user = await requireAuth();
    return user.role === "ADMIN";
  } catch {
    return false;
  }
}
