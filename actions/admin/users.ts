"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { provisionDealerProfile } from "@/lib/dealers/access";
import {
  grantAdminDealerAccess,
  revokeAdminDealerAccess,
} from "@/lib/dealers/entitlement";
import { captureException } from "@/lib/monitoring";
import {
  listUsersSchema,
  setUserRoleSchema,
  grantDealerAccessSchema,
  revokeDealerAccessSchema,
  setUserDisabledSchema,
  deleteUserSchema,
  restoreUserSchema,
  setUserRegionSchema,
  type ListUsersInput,
  type SetUserRoleInput,
  type GrantDealerAccessInput,
  type RevokeDealerAccessInput,
  type SetUserDisabledInput,
  type DeleteUserInput,
  type RestoreUserInput,
  type SetUserRegionInput,
} from "@/lib/validations/admin";
import type { Prisma } from "@prisma/client";

const ROLE_CHANGE_TRANSACTION_ATTEMPTS = 3;

export async function listUsers(input: ListUsersInput) {
  await requireRole("ADMIN");

  const parsed = listUsersSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { query, role, regionId, disabled, page, pageSize } = parsed.data;

  const where: Prisma.UserWhereInput = {};
  if (query) {
    where.OR = [
      { email: { contains: query, mode: "insensitive" } },
      { name: { contains: query, mode: "insensitive" } },
    ];
  }
  if (role) where.role = role;
  if (regionId) where.regionId = regionId;
  if (disabled === true) where.disabledAt = { not: null };
  if (disabled === false) where.disabledAt = null;

  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        region: { select: { name: true } },
        dealerProfile: { select: { id: true, name: true, verified: true } },
        _count: { select: { listings: true, favourites: true } },
      },
    }),
    db.user.count({ where }),
  ]);

  return {
    data: {
      users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

export async function getUserAdminView(userId: string) {
  const admin = await requireRole("ADMIN");
  if (!userId) return { error: "Missing userId" };

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      region: true,
      dealerProfile: {
        include: {
          subscriptions: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      },
      _count: {
        select: {
          listings: true,
          favourites: true,
          savedSearches: true,
          reports: true,
          listingViews: true,
        },
      },
    },
  });

  if (!user) return { error: "User not found" };

  const recentListings = await db.listing.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, status: true, createdAt: true, price: true },
  });

  return { data: { user, recentListings } };
}

export async function setUserRole(input: SetUserRoleInput) {
  const admin = await requireRole("ADMIN");

  const parsed = setUserRoleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, role, grantDurationDays } = parsed.data;

  if (userId === admin.id) return { error: "Cannot change your own role" };

  try {
    const result = await updateUserRole({
      userId,
      role,
      grantDurationDays,
      adminId: admin.id,
    });
    if (result.kind === "not-found") return { error: "User not found" };
    if (result.kind === "duration-required") {
      return {
        error: {
          grantDurationDays: [
            "Choose a valid free dealer access duration before promoting this account.",
          ],
        },
      };
    }

    await logAdminAction({
      adminId: admin.id,
      action: "SET_USER_ROLE",
      entityType: "User",
      entityId: userId,
      details: {
        newRole: role,
        grantDurationDays: result.grantDurationDays,
        dealerAccessSource: result.accessSource,
        dealerAccessEndsAt: result.accessEndsAt?.toISOString() ?? null,
      },
    });

    revalidateDealerAccessPaths(userId);
    return { data: result.user };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setUserRole",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId, role },
    });
    return { error: "Failed to update role" };
  }
}

interface UpdateUserRoleInput {
  userId: string;
  role: SetUserRoleInput["role"];
  grantDurationDays?: number;
  adminId: string;
}

type UpdateUserRoleResult =
  | { kind: "not-found" }
  | { kind: "duration-required" }
  | {
      kind: "updated";
      user: { id: string; role: SetUserRoleInput["role"] };
      grantDurationDays: number | null;
      accessSource: "PAYMENT" | "ADMIN_GRANT" | null;
      accessEndsAt: Date | null;
    };

async function updateUserRole(
  input: UpdateUserRoleInput
): Promise<UpdateUserRoleResult> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < ROLE_CHANGE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await db.$transaction(
        async (tx) => {
          const targetUser = await tx.user.findUnique({
            where: { id: input.userId },
            select: { id: true, name: true, email: true, role: true },
          });
          if (!targetUser) return { kind: "not-found" };

          if (
            input.role === "DEALER" &&
            targetUser.role !== "DEALER" &&
            !input.grantDurationDays
          ) {
            return { kind: "duration-required" };
          }

          const dealerProfile =
            input.role === "DEALER"
              ? await provisionDealerProfile(tx, targetUser)
              : null;
          const grantResult =
            dealerProfile && input.grantDurationDays
              ? await grantAdminDealerAccess(tx, {
                  dealerId: dealerProfile.id,
                  adminId: input.adminId,
                  durationDays: input.grantDurationDays,
                })
              : null;
          if (input.role === "USER" && targetUser.role === "DEALER") {
            const dealer = await tx.dealerProfile.findUnique({
              where: { userId: input.userId },
              select: { id: true },
            });
            if (dealer) {
              await revokeAdminDealerAccess(tx, dealer.id);
              await tx.subscription.updateMany({
                where: { dealerId: dealer.id, status: "ACTIVE", source: "PAYMENT" },
                data: { cancelAtPeriodEnd: true },
              });
            }
          }

          const user = await tx.user.update({
            where: { id: input.userId },
            data: { role: input.role },
          });
          const accessEndsAt =
            grantResult?.kind === "paid-access-preserved"
              ? null
              : grantResult?.subscription.grantEndsAt ?? null;

          return {
            kind: "updated",
            user: { id: user.id, role: user.role },
            grantDurationDays: input.grantDurationDays ?? null,
            accessSource:
              grantResult?.kind === "paid-access-preserved"
                ? "PAYMENT"
                : grantResult
                  ? "ADMIN_GRANT"
                  : null,
            accessEndsAt,
          };
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error)) throw error;
    }
  }

  throw lastError;
}

export async function grantDealerAccess(input: GrantDealerAccessInput) {
  const admin = await requireRole("ADMIN");
  const parsed = grantDealerAccessSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const result = await runDealerGrantTransaction({
      userId: parsed.data.userId,
      durationDays: parsed.data.durationDays,
      adminId: admin.id,
    });
    if (result.kind === "not-found") return { error: "User not found" };
    if (result.kind === "not-dealer") {
      return { error: "Only dealer-role accounts can receive dealer access." };
    }

    await logAdminAction({
      adminId: admin.id,
      action:
        result.grant.kind === "extended"
          ? "EXTEND_DEALER_ADMIN_GRANT"
          : "GRANT_DEALER_ADMIN_ACCESS",
      entityType: "Subscription",
      entityId: result.grant.subscription.id,
      details: {
        userId: parsed.data.userId,
        dealerId: result.dealerId,
        source:
          result.grant.kind === "paid-access-preserved"
            ? "PAYMENT"
            : "ADMIN_GRANT",
        durationDays: parsed.data.durationDays,
        endsAt:
          result.grant.kind === "paid-access-preserved"
            ? null
            : result.grant.subscription.grantEndsAt?.toISOString() ?? null,
      },
    });

    revalidateDealerAccessPaths(parsed.data.userId);
    return {
      data: {
        source:
          result.grant.kind === "paid-access-preserved"
            ? "PAYMENT"
            : "ADMIN_GRANT",
        endsAt:
          result.grant.kind === "paid-access-preserved"
            ? null
            : result.grant.subscription.grantEndsAt,
      },
    };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "grantDealerAccess",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId: parsed.data.userId },
    });
    return { error: "Failed to grant dealer access" };
  }
}

export async function revokeDealerAccess(input: RevokeDealerAccessInput) {
  const admin = await requireRole("ADMIN");
  const parsed = revokeDealerAccessSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const result = await db.$transaction(
      async (tx) => {
        const targetUser = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: {
            id: true,
            dealerProfile: { select: { id: true } },
          },
        });
        if (!targetUser) return { kind: "not-found" as const };
        if (!targetUser.dealerProfile) return { kind: "no-profile" as const };

        const revoked = await revokeAdminDealerAccess(
          tx,
          targetUser.dealerProfile.id
        );
        return {
          kind: "revoked" as const,
          dealerId: targetUser.dealerProfile.id,
          count: revoked.count,
        };
      },
      { isolationLevel: "Serializable" }
    );
    if (result.kind === "not-found") return { error: "User not found" };
    if (result.kind === "no-profile" || result.count === 0) {
      return { error: "No active admin grant exists for this dealer." };
    }

    await logAdminAction({
      adminId: admin.id,
      action: "REVOKE_DEALER_ADMIN_GRANT",
      entityType: "DealerProfile",
      entityId: result.dealerId,
      details: { userId: parsed.data.userId, source: "ADMIN_GRANT" },
    });
    revalidateDealerAccessPaths(parsed.data.userId);
    return { data: { success: true } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "revokeDealerAccess",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId: parsed.data.userId },
    });
    return { error: "Failed to revoke dealer access" };
  }
}

async function runDealerGrantTransaction(input: {
  userId: string;
  durationDays: number;
  adminId: string;
}) {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < ROLE_CHANGE_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await db.$transaction(
        async (tx) => {
          const targetUser = await tx.user.findUnique({
            where: { id: input.userId },
            select: { id: true, name: true, email: true, role: true },
          });
          if (!targetUser) return { kind: "not-found" as const };
          if (targetUser.role !== "DEALER") {
            return { kind: "not-dealer" as const };
          }

          const dealerProfile = await provisionDealerProfile(tx, targetUser);
          const grant = await grantAdminDealerAccess(tx, {
            dealerId: dealerProfile.id,
            adminId: input.adminId,
            durationDays: input.durationDays,
          });
          return {
            kind: "granted" as const,
            dealerId: dealerProfile.id,
            grant,
          };
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error)) throw error;
    }
  }

  throw lastError;
}

function revalidateDealerAccessPaths(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/dealers");
  revalidatePath("/sell/dealer");
  revalidatePath("/dealer/subscribe");
  revalidatePath("/dealer/dashboard");
  revalidatePath("/dealer/profile");
  revalidatePath("/account");
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("P2002") || error.message.includes("P2034"))
  );
}

export async function setUserDisabled(input: SetUserDisabledInput) {
  const admin = await requireRole("ADMIN");

  const parsed = setUserDisabledSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, disabled, reason, reasonCode } = parsed.data;

  if (userId === admin.id) return { error: "Cannot disable your own account" };

  try {
    const { user, notifications } = await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          disabledAt: disabled ? new Date() : null,
          disabledReason: disabled ? (reason ?? "Disabled by admin") : null,
          disabledReasonCode: disabled ? reasonCode ?? null : null,
        },
      });

      let listingNotifications: Awaited<
        ReturnType<
          typeof import("@/lib/listings/account-disable").applyAccountDisableToListings
        >
      >["notifications"] = [];
      if (disabled) {
        const { applyAccountDisableToListings } = await import(
          "@/lib/listings/account-disable"
        );
        const disabledListings = await applyAccountDisableToListings({
          tx,
          userId,
          actor: { id: admin.id, role: "ADMIN" },
          source: "ADMIN",
          notes: reason ?? "Account disabled by admin",
        });
        listingNotifications = disabledListings.notifications;
      }

      await logAdminAction(
        {
          adminId: admin.id,
          action: disabled ? "DISABLE_USER" : "ENABLE_USER",
          entityType: "User",
          entityId: userId,
          details: { reason, reasonCode },
        },
        tx,
      );

      return { user: updated, notifications: listingNotifications };
    });

    const { dispatchListingNotifications } = await import(
      "@/lib/email/listing-notifications"
    );
    try {
      await dispatchListingNotifications(notifications);
    } catch {
      // Email is best-effort after the account-disable commit.
    }

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { data: user };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setUserDisabled",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId, disabled },
    });
    const message = err instanceof Error ? err.message : "Failed to update user";
    return { error: message };
  }
}

export async function deleteUser(input: DeleteUserInput) {
  const admin = await requireRole("ADMIN");

  const parsed = deleteUserSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, reason } = parsed.data;

  if (userId === admin.id) return { error: "Cannot delete your own account" };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      authUserId: true,
      dealerProfile: { select: { id: true } },
    },
  });

  if (!user) return { error: "User not found" };

  try {
    const notifications = await db.$transaction(async (tx) => {
      const { applyAccountDisableToListings } = await import(
        "@/lib/listings/account-disable"
      );
      const disabledListings = await applyAccountDisableToListings({
        tx,
        userId,
        actor: { id: admin.id, role: "ADMIN" },
        source: "ADMIN",
        notes: reason ?? "Account soft-deleted by admin",
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          deletionRequestedAt: new Date(),
          deletionReason: reason ?? "Deleted by admin",
          disabledAt: new Date(),
          disabledReason: reason ?? "Deleted by admin",
        },
      });

      await logAdminAction(
        {
          adminId: admin.id,
          action: "SOFT_DELETE_USER",
          entityType: "User",
          entityId: userId,
          details: {
            dealerProfileId: user.dealerProfile?.id ?? null,
            reason: reason ?? null,
          },
        },
        tx,
      );
      return disabledListings.notifications;
    });

    const { dispatchListingNotifications } = await import(
      "@/lib/email/listing-notifications"
    );
    try {
      await dispatchListingNotifications(notifications);
    } catch {
      // Email is best-effort after the account-delete commit.
    }

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath("/admin/dealers");
    revalidatePath("/");
    revalidatePath("/search");
    return { data: { success: true } };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "deleteUser",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId },
    });
    const message = err instanceof Error ? err.message : "Failed to delete user";
    return { error: message };
  }
}

export async function restoreUser(input: RestoreUserInput) {
  const admin = await requireRole("ADMIN");
  const parsed = restoreUserSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };
  if (parsed.data.userId === admin.id) {
    return { error: "Cannot restore your own account from this action." };
  }

  try {
    const user = await db.$transaction(async (tx) => {
      const restored = await tx.user.update({
        where: { id: parsed.data.userId },
        data: {
          deletedAt: null,
          deletionRequestedAt: null,
          deletionReason: null,
          disabledAt: null,
          disabledReason: null,
          disabledReasonCode: null,
        },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "RESTORE_USER",
          entityType: "User",
          entityId: restored.id,
        },
        tx,
      );
      return restored;
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${user.id}`);
    return { data: user };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to restore user";
    return { error: message };
  }
}

export async function setUserRegion(input: SetUserRegionInput) {
  const admin = await requireRole("ADMIN");

  const parsed = setUserRegionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, regionId } = parsed.data;

  try {
    const user = await db.user.update({
      where: { id: userId },
      data: { regionId },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "SET_USER_REGION",
      entityType: "User",
      entityId: userId,
      details: { regionId },
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { data: user };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "setUserRegion",
      route: "/admin/users",
      requestPath: "/admin/users",
      userId: admin.id,
      tags: { userId, regionId: regionId ?? "null" },
    });
    const message = err instanceof Error ? err.message : "Failed to update region";
    return { error: message };
  }
}
