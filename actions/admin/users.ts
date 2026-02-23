"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import {
  listUsersSchema,
  setUserRoleSchema,
  setUserDisabledSchema,
  setUserRegionSchema,
  type ListUsersInput,
  type SetUserRoleInput,
  type SetUserDisabledInput,
  type SetUserRegionInput,
} from "@/lib/validations/admin";
import type { Prisma } from "@prisma/client";

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

  const { userId, role } = parsed.data;

  if (userId === admin.id) return { error: "Cannot change your own role" };

  try {
    const user = await db.user.update({
      where: { id: userId },
      data: { role },
    });

    await logAdminAction({
      adminId: admin.id,
      action: "SET_USER_ROLE",
      entityType: "User",
      entityId: userId,
      details: { newRole: role },
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { data: user };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update role";
    return { error: message };
  }
}

export async function setUserDisabled(input: SetUserDisabledInput) {
  const admin = await requireRole("ADMIN");

  const parsed = setUserDisabledSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, disabled, reason } = parsed.data;

  if (userId === admin.id) return { error: "Cannot disable your own account" };

  try {
    const user = await db.user.update({
      where: { id: userId },
      data: {
        disabledAt: disabled ? new Date() : null,
        disabledReason: disabled ? (reason ?? "Disabled by admin") : null,
      },
    });

    await logAdminAction({
      adminId: admin.id,
      action: disabled ? "DISABLE_USER" : "ENABLE_USER",
      entityType: "User",
      entityId: userId,
      details: { reason },
    });

    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${userId}`);
    return { data: user };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update user";
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
    const message = err instanceof Error ? err.message : "Failed to update region";
    return { error: message };
  }
}
