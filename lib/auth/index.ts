import { db } from "@/lib/db";
import { isSupabaseAuthConfigured } from "@/lib/auth/supabase-config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { findBlockingOnboardingInvite, OnboardingIncompleteError } from "@/lib/dealers/onboarding/access-gate";
import {
  isOnboardingSessionStale,
  readOnboardingSessionInvalidBefore,
} from "@/lib/dealers/onboarding/session-cutoff";
import { profileNameSchema } from "@/lib/validations/profile-name";
import type { UserRole } from "@prisma/client";
import { hasStagingAccess, requiresStagingAdmin } from "@/lib/deployment/staging-access-policy";

function withStagingAccess<T extends {
  role: string;
  email: string;
  disabledAt?: unknown;
  deletedAt?: unknown;
}>(user: T, authUser: {
  email?: string;
  email_confirmed_at?: string;
}) {
  return {
    ...user,
    stagingAccessAllowed: hasStagingAccess({
      ...user,
      role: user.role,
      email: user.email,
      verifiedAuthEmail: authUser.email_confirmed_at ? authUser.email ?? null : null,
    }),
  };
}

export class AuthenticationRequiredError extends Error {
  readonly statusCode = 401 as const;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export { OnboardingIncompleteError };

export class AccountDisabledError extends Error {
  readonly statusCode = 403 as const;
  constructor(message = "Account disabled") {
    super(message);
    this.name = "AccountDisabledError";
  }
}

export class DeletedAccountError extends Error {
  readonly statusCode = 403 as const;
  constructor(message = "This account has been deleted") {
    super(message);
    this.name = "DeletedAccountError";
  }
}

export class ProfileNameRequiredError extends Error {
  readonly statusCode = 400 as const;
  constructor(message = "A valid name is required to create an account profile") {
    super(message);
    this.name = "ProfileNameRequiredError";
  }
}

export class InsufficientPermissionsError extends Error {
  readonly statusCode = 403 as const;
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "InsufficientPermissionsError";
  }
}

function getAuthProfileName(metadata: Record<string, unknown>): string | undefined {
  for (const key of ["full_name", "name", "display_name"] as const) {
    const parsed = profileNameSchema.safeParse(metadata[key]);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

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
  if (readOnboardingSessionInvalidBefore(authUser.app_metadata) !== null) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (isOnboardingSessionStale(authUser.app_metadata, session?.access_token)) {
      return null;
    }
  }

  const user = await db.user.findUnique({
    where: { authUserId: authUser.id },
    include: { dealerProfile: true },
  });

  if (!user) {
    try {
      const synced = await syncUser(
        authUser.id,
        authUser.email ?? "",
        getAuthProfileName(authUser.user_metadata ?? {}),
        authUser.app_metadata?.policy_acceptance
      );
      const syncedUser = await db.user.findUnique({
        where: { id: synced.id },
        include: { dealerProfile: true },
      });
      if (syncedUser?.deletedAt) {
        await supabase.auth.signOut();
        return null;
      }
      if (syncedUser?.disabledAt) return null;
      return syncedUser ? withStagingAccess(syncedUser, authUser) : null;
    } catch (error) {
      if (error instanceof DeletedAccountError) {
        await supabase.auth.signOut();
        return null;
      }
      throw error;
    }
  }

  if (user.deletedAt) {
    await supabase.auth.signOut();
    return null;
  }

  if (user.disabledAt) return null;

  return withStagingAccess(user, authUser);
}

/**
 * Sync a Supabase Auth user to the local database (called on first visit after sign-in).
 * New users are always created with USER role. Dealer role is granted only through
 * the subscription flow (admin or self-service).
 */
export async function syncUser(
  authUserId: string,
  email: string,
  name?: string,
  policyAcceptanceReceipt?: unknown
) {
  const persist = () => db.$transaction(async (tx) => {
    const parsedName = profileNameSchema.safeParse(name);
    const existing = await tx.user.findUnique({
      where: { authUserId },
      select: { id: true },
    });
    const user = existing
      ? await tx.user.update({
          where: { authUserId },
          data: {
            email,
            ...(parsedName.success ? { name: parsedName.data } : {}),
          },
        })
      : parsedName.success
        ? await tx.user.create({
            data: {
              authUserId,
              email,
              name: parsedName.data,
              role: "USER",
            },
          })
        : null;
    if (!user) throw new ProfileNameRequiredError();
    if (policyAcceptanceReceipt) {
      const { importSignupAcceptances } = await import(
        "@/lib/policy/acceptance"
      );
      await importSignupAcceptances(tx, user.id, policyAcceptanceReceipt);
    }
    return user;
  });

  try {
    return await persist();
  } catch (err) {
    let finalError = err;
    const isUniqueViolation = (error: unknown) => {
      const prismaCode =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      return prismaCode === "P2002" ||
        (error instanceof Error &&
          (error.message.includes("Unique constraint") || error.message.includes("P2002")));
    };

    if (isUniqueViolation(err)) {
      const concurrentIdentity = await db.user.findUnique({
        where: { authUserId },
        select: { id: true, deletedAt: true, disabledAt: true },
      });
      if (concurrentIdentity?.deletedAt) throw new DeletedAccountError();
      if (concurrentIdentity?.disabledAt) return concurrentIdentity;
      if (concurrentIdentity) {
        try {
          return await persist();
        } catch (retryError) {
          finalError = retryError;
        }
      }
    }

    if (isUniqueViolation(finalError) && email) {
      const existing = await db.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { deletedAt: true },
      });
      if (existing?.deletedAt) throw new DeletedAccountError();
    }
    throw finalError;
  }
}

/**
 * Require authentication. Throws if not authenticated or account is disabled.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthenticationRequiredError();
  }
  if (requiresStagingAdmin() && !user.stagingAccessAllowed) {
    throw new InsufficientPermissionsError("Staging is restricted to administrators and approved test accounts.");
  }
  if (user.disabledAt) {
    throw new AccountDisabledError();
  }
  if (await findBlockingOnboardingInvite(user.id)) {
    throw new OnboardingIncompleteError();
  }
  return user;
}

/**
 * Require a specific role. Throws if role doesn't match.
 */
export async function requireRole(role: UserRole) {
  const user = await requireAuth();
  if (user.role !== role && user.role !== "ADMIN") {
    throw new InsufficientPermissionsError();
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
