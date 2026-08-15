"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { getAdminDealerWhere } from "@/lib/dealers/access";
import { grantAdminDealerAccess } from "@/lib/dealers/entitlement";
import {
  createDealerProfileSchema,
  updateDealerProfileSchema,
  type CreateDealerProfileInput,
  type UpdateDealerProfileInput,
} from "@/lib/validations/admin";
import type { Prisma } from "@prisma/client";

export async function listDealers(input: { query?: string; verified?: boolean; page?: number; pageSize?: number }) {
  await requireRole("ADMIN");

  const query = input.query ?? "";
  const verified = input.verified;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));

  const where: Prisma.DealerProfileWhereInput = getAdminDealerWhere();

  if (query) {
    where.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { slug: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
    ];
  }
  if (verified !== undefined) where.verified = verified;

  const [dealers, total] = await Promise.all([
    db.dealerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        _count: { select: { listings: true, subscriptions: true } },
      },
    }),
    db.dealerProfile.count({ where }),
  ]);

  return { data: { dealers, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
}

export async function createDealerProfile(input: CreateDealerProfileInput) {
  const admin = await requireRole("ADMIN");

  const parsed = createDealerProfileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { userId, grantDurationDays, ...profileData } = parsed.data;

  const user = await db.user.findUnique({ where: { id: userId }, include: { dealerProfile: true } });
  if (!user) return { error: "User not found" };
  if (user.dealerProfile) return { error: "User already has a dealer profile" };

  try {
    const profile = await db.$transaction(
      async (tx) => {
        const createdProfile = await tx.dealerProfile.create({
          data: { userId, ...profileData },
        });
        await grantAdminDealerAccess(tx, {
          dealerId: createdProfile.id,
          adminId: admin.id,
          durationDays: grantDurationDays,
        });
        await tx.user.update({
          where: { id: userId },
          data: { role: "DEALER" },
        });
        return createdProfile;
      },
      { isolationLevel: "Serializable" }
    );

    await logAdminAction({
      adminId: admin.id,
      action: "CREATE_DEALER_PROFILE",
      entityType: "DealerProfile",
      entityId: profile.id,
      details: {
        userId,
        name: profileData.name,
        source: "ADMIN_GRANT",
        grantDurationDays,
      },
    });

    revalidatePath("/admin/dealers");
    revalidatePath("/admin/users");
    return { data: profile };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create dealer profile";
    return { error: message };
  }
}

export async function updateDealerProfile(input: UpdateDealerProfileInput) {
  const admin = await requireRole("ADMIN");

  const parsed = updateDealerProfileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const { dealerId, ...data } = parsed.data;

  try {
    const profile = await db.dealerProfile.update({
      where: { id: dealerId },
      data,
    });

    await logAdminAction({
      adminId: admin.id,
      action: "UPDATE_DEALER_PROFILE",
      entityType: "DealerProfile",
      entityId: dealerId,
      details: data,
    });

    revalidatePath("/admin/dealers");
    return { data: profile };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update dealer profile";
    return { error: message };
  }
}

export async function verifyDealer(dealerId: string, verified: boolean) {
  const admin = await requireRole("ADMIN");
  if (!dealerId) return { error: "Missing dealerId" };

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.dealerProfile.findUnique({
        where: { id: dealerId },
        include: { user: { select: { email: true } } },
      });
      if (!existing) throw new Error("Dealer not found");

      const profile = await tx.dealerProfile.update({
        where: { id: dealerId },
        data: { verified },
      });

      await logAdminAction(
        {
          adminId: admin.id,
          action: verified ? "VERIFY_DEALER" : "UNVERIFY_DEALER",
          entityType: "DealerProfile",
          entityId: dealerId,
        },
        tx,
      );

      return {
        profile,
        changed: existing.verified !== verified,
        email: existing.user.email,
        name: existing.name,
      };
    });

    if (result.changed) {
      const { sendDealerVerificationEmail } = await import(
        "@/lib/email/dealer-notifications"
      );
      await sendDealerVerificationEmail({
        to: result.email,
        dealerName: result.name,
        verified,
      });
    }

    revalidatePath("/admin/dealers");
    return { data: result.profile };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update verification";
    return { error: message };
  }
}

export async function downgradeDealerToUser(dealerId: string) {
  const admin = await requireRole("ADMIN");
  if (!dealerId) return { error: "Missing dealerId" };

  const profile = await db.dealerProfile.findUnique({
    where: { id: dealerId },
    include: { user: { select: { id: true } } },
  });
  if (!profile) return { error: "Dealer profile not found" };

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: profile.userId },
        data: { role: "USER" },
      });
      const { revokeAdminDealerAccess } = await import("@/lib/dealers/entitlement");
      await revokeAdminDealerAccess(tx, dealerId);
      await tx.subscription.updateMany({
        where: { dealerId, status: "ACTIVE", source: "PAYMENT" },
        data: { cancelAtPeriodEnd: true },
      });
    });

    await logAdminAction({
      adminId: admin.id,
      action: "DOWNGRADE_DEALER",
      entityType: "DealerProfile",
      entityId: dealerId,
      details: { userId: profile.userId },
    });

    revalidatePath("/admin/dealers");
    revalidatePath("/admin/users");
    revalidatePath("/dealer/dashboard");
    revalidatePath("/dealer/profile");
    revalidatePath("/account");
    return { data: { success: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to downgrade dealer";
    return { error: message };
  }
}
