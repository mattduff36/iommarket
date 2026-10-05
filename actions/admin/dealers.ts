"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAdminAction } from "@/lib/admin/audit";
import { getAdminDealerWhere } from "@/lib/dealers/access";
import { grantAdminDealerAccess } from "@/lib/dealers/entitlement";
import {
  createDealerProfileSchema,
  type CreateDealerProfileInput,
} from "@/lib/validations/admin";
import type { Prisma } from "@prisma/client";
import { reportHandledException } from "@/lib/monitoring";
import { resolveDealerMailRecipients } from "@/lib/dealers/correspondence-routing";
import {
  applySampleDealerVisibility,
  applySampleListingVisibility,
  getSampleVisibility,
} from "@/lib/listings/sample-visibility";

export async function listDealers(input: { query?: string; verified?: boolean; page?: number; pageSize?: number }) {
  await requireRole("ADMIN");

  const query = input.query ?? "";
  const verified = input.verified;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const sampleVisibility = await getSampleVisibility();

  const where: Prisma.DealerProfileWhereInput = getAdminDealerWhere();

  if (query) {
    where.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { slug: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
    ];
  }
  if (verified !== undefined) where.verified = verified;
  const visibleDealers = applySampleDealerVisibility(where, sampleVisibility);
  const visibleListings = applySampleListingVisibility({}, sampleVisibility);

  const [dealers, total] = await Promise.all([
    db.dealerProfile.findMany({
      where: visibleDealers,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
        _count: {
          select: {
            listings: { where: visibleListings },
            subscriptions: true,
          },
        },
      },
    }),
    db.dealerProfile.count({ where: visibleDealers }),
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
  if (user.role === "USER") {
    return {
      error:
        "Private users must receive a dealer upgrade offer and accept the dealer documents before activation.",
    };
  }

  try {
    const profile = await db.$transaction(
      async (tx) => {
        const currentUser = await tx.user.findUnique({
          where: { id: userId },
          select: {
            role: true,
            dealerProfile: { select: { id: true } },
          },
        });
        if (!currentUser) throw new Error("User not found");
        if (currentUser.dealerProfile) {
          throw new Error("User already has a dealer profile");
        }
        if (currentUser.role === "USER") {
          throw new Error(
            "Private users must receive a dealer upgrade offer and accept the dealer documents before activation.",
          );
        }
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
    await reportHandledException({
      error: err,
      action: "createDealerProfile",
      route: "/admin/dealers",
    });
    const message = err instanceof Error ? err.message : "Failed to create dealer profile";
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
      const recipients = await resolveDealerMailRecipients({
        dealerId,
        primaryEmail: result.email,
        category: "DEALER_ACCOUNT",
      });
      if (recipients.length > 0) {
        await sendDealerVerificationEmail({
          to: recipients,
          dealerName: result.name,
          verified,
        });
      }
    }

    revalidatePath("/admin/dealers");
    return { data: result.profile };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "verifyDealer",
      route: "/admin/dealers",
    });
    const message = err instanceof Error ? err.message : "Failed to update verification";
    return { error: message };
  }
}

export async function downgradeDealerToUser(dealerId: string) {
  const admin = await requireRole("ADMIN");
  if (!dealerId) return { error: "Missing dealerId" };

  const profile = await db.dealerProfile.findUnique({
    where: { id: dealerId },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!profile) return { error: "Dealer profile not found" };
  if (profile.user.role !== "DEALER") {
    return { error: "Only dealer accounts can be downgraded to users." };
  }

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
    await reportHandledException({
      error: err,
      action: "downgradeDealerToUser",
      route: "/admin/dealers",
    });
    const message = err instanceof Error ? err.message : "Failed to downgrade dealer";
    return { error: message };
  }
}
