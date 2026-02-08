import { db } from "@/lib/db";
import { isClerkConfigured } from "@/lib/auth/clerk-config";
import type { UserRole } from "@prisma/client";

/**
 * Get the current authenticated user from DB, syncing from Clerk if needed.
 * Returns null if not authenticated or Clerk is not configured.
 */
export async function getCurrentUser() {
  if (!isClerkConfigured()) {
    return null;
  }

  const { auth } = await import("@clerk/nextjs/server");
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const user = await db.user.findUnique({
    where: { clerkId },
    include: { dealerProfile: true },
  });

  return user;
}

/**
 * Sync a Clerk user to the local database (called on sign-up or first visit).
 */
export async function syncUser(clerkId: string, email: string, name?: string) {
  return db.user.upsert({
    where: { clerkId },
    update: { email, name },
    create: { clerkId, email, name, role: "BUYER" },
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
