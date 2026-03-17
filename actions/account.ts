"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import {
  deactivateMyAccountSchema,
  updateDealerSelfProfileSchema,
  updateMyProfileSchema,
  type DeactivateMyAccountInput,
  type UpdateDealerSelfProfileInput,
  type UpdateMyProfileInput,
} from "@/lib/validations/account";

export async function updateMyProfile(input: UpdateMyProfileInput) {
  const user = await requireAuth();

  const parsed = updateMyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  try {
    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        name: data.name,
        regionId: data.regionId,
        phone: data.phone || null,
        bio: data.bio || null,
        avatarUrl: data.avatarUrl || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        bio: true,
        avatarUrl: true,
        regionId: true,
      },
    });

    revalidatePath("/account");
    revalidatePath("/account/profile");
    return { data: updated };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update profile";
    return { error: message };
  }
}

export async function updateMyDealerProfile(input: UpdateDealerSelfProfileInput) {
  const user = await requireAuth();
  if (!user.dealerProfile) {
    return { error: "Dealer profile not found" };
  }

  const parsed = updateDealerSelfProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  try {
    const existingSlug = await db.dealerProfile.findFirst({
      where: {
        slug: data.slug,
        id: { not: user.dealerProfile.id },
      },
      select: { id: true },
    });

    if (existingSlug) {
      return { error: { slug: ["This slug is already in use"] } };
    }

    const updated = await db.dealerProfile.update({
      where: { id: user.dealerProfile.id },
      data: {
        name: data.name,
        slug: data.slug,
        bio: data.bio || null,
        website: data.website || null,
        phone: data.phone || null,
        logoUrl: data.logoUrl || null,
      },
    });

    revalidatePath("/dealer/dashboard");
    revalidatePath("/dealer/profile");
    revalidatePath(`/dealers/${updated.slug}`);
    return { data: updated };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update dealer profile";
    return { error: message };
  }
}

export async function deactivateMyAccount(input: DeactivateMyAccountInput) {
  const user = await requireAuth();

  const parsed = deactivateMyAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    await db.$transaction(async (tx) => {
      const activeListings = await tx.listing.findMany({
        where: {
          userId: user.id,
          status: { in: ["DRAFT", "PENDING", "APPROVED", "LIVE"] },
        },
        select: { id: true, status: true },
      });

      for (const listing of activeListings) {
        await tx.listing.update({
          where: { id: listing.id },
          data: { status: "TAKEN_DOWN" },
        });

        await tx.listingStatusEvent.create({
          data: {
            listingId: listing.id,
            fromStatus: listing.status,
            toStatus: "TAKEN_DOWN",
            changedByUserId: user.id,
            source: "USER",
            notes: "Account deletion requested",
          },
        });
      }

      await tx.user.update({
        where: { id: user.id },
        data: {
          deletedAt: new Date(),
          deletionRequestedAt: new Date(),
          deletionReason: parsed.data.reason || "User requested deletion",
          disabledAt: new Date(),
          disabledReason: "Account deleted by user",
        },
      });
    });

    revalidatePath("/");
    revalidatePath("/account");
    revalidatePath("/search");
    return { data: { success: true } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to deactivate account";
    return { error: message };
  }
}
