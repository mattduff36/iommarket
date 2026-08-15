"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { getCurrentDealerEntitlement } from "@/lib/dealers/entitlement";
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
  if (!hasDealerDashboardAccess(user)) {
    return { error: "Not authorized to update a dealer profile" };
  }
  if (!(await getCurrentDealerEntitlement(user))) {
    return { error: "Active dealer access is required to update a dealer profile" };
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
    const notifications = await db.$transaction(async (tx) => {
      const { applyAccountDisableToListings } = await import(
        "@/lib/listings/account-disable"
      );
      const disabled = await applyAccountDisableToListings({
        tx,
        userId: user.id,
        actor: { id: user.id, role: "USER" },
        source: "USER",
        notes: "Account deletion requested",
      });

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
      return disabled.notifications;
    });

    const { dispatchListingNotifications } = await import(
      "@/lib/email/listing-notifications"
    );
    try {
      await dispatchListingNotifications(notifications);
    } catch {
      // Email is best-effort after the account-disable commit.
    }

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
