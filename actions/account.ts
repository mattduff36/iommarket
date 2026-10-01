"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { hasDealerDashboardAccess } from "@/lib/dealers/access";
import { hasOperationalDealerAccess } from "@/lib/dealers/entitlement";
import {
  deactivateMyAccountSchema,
  updateDealerSelfProfileSchema,
  updateMyProfileSchema,
  type DeactivateMyAccountInput,
  type UpdateDealerSelfProfileInput,
  type UpdateMyProfileInput,
} from "@/lib/validations/account";
import { reportHandledException } from "@/lib/monitoring";
import {
  getDealerProfileAddressChangeError,
  getDealerProfileAddressChangeWindowStart,
  shouldCountDealerProfileAddressChange,
} from "@/lib/dealers/profile-address";

export async function updateMyProfile(input: UpdateMyProfileInput) {
  const user = await requireAcceptedAuth();

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
    await reportHandledException({
      error: err,
      action: "updateMyProfile",
      route: "/account/profile",
      userId: user.id,
    });
    const message =
      err instanceof Error ? err.message : "Failed to update profile";
    return { error: message };
  }
}

export async function updateMyDealerProfile(input: UpdateDealerSelfProfileInput) {
  const user = await requireAcceptedAuth();
  if (!hasDealerDashboardAccess(user)) {
    return { error: "Not authorized to update a dealer profile" };
  }
  if (!(await hasOperationalDealerAccess(user))) {
    return { error: "Active dealer access is required to update a dealer profile" };
  }

  const parsed = updateDealerSelfProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const data = parsed.data;

  try {
    const result = await db.$transaction(async (tx) => {
      const [profile] = await tx.$queryRaw<Array<{ id: string; slug: string }>>`
        SELECT "id", "slug"
        FROM "DealerProfile"
        WHERE "id" = ${user.dealerProfile.id}
        FOR UPDATE
      `;
      if (!profile) return { error: { slug: ["Dealer profile not found"] } };

      const slugChanged = profile.slug !== data.slug;
      if (slugChanged) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(candidate, 0))
          FROM (
            SELECT DISTINCT candidate COLLATE "C" AS candidate
            FROM unnest(ARRAY[${profile.slug}, ${data.slug}]::TEXT[]) AS keys(candidate)
            ORDER BY candidate
          ) AS ordered_slugs
        `;

        const [existingProfile, reservedAddress] = await Promise.all([
          tx.dealerProfile.findFirst({
            where: { slug: data.slug, id: { not: profile.id } },
            select: { id: true },
          }),
          tx.dealerProfileSlugHistory.findUnique({
            where: { slug: data.slug },
            select: { id: true },
          }),
        ]);
        if (existingProfile || reservedAddress) {
          return { error: { slug: ["This public profile address is already in use"] } };
        }

        const now = new Date();
        const changesInWindow = await tx.dealerProfileSlugHistory.count({
          where: {
            dealerId: profile.id,
            countsTowardsLimit: true,
            changedAt: { gte: getDealerProfileAddressChangeWindowStart(now) },
          },
        });
        const limitError = getDealerProfileAddressChangeError({
          currentSlug: profile.slug,
          nextSlug: data.slug,
          changesInWindow,
        });
        if (limitError) return { error: { slug: [limitError] } };

        if (
          shouldCountDealerProfileAddressChange({
            source: "SELF_SERVICE",
            previousSlug: profile.slug,
            userId: user.id,
          })
        ) {
          await tx.$executeRaw`
            SELECT set_config('app.dealer_profile_address_source', 'SELF_SERVICE', true)
          `;
        }
      }

      const updated = await tx.dealerProfile.update({
        where: { id: profile.id },
        data: {
          name: data.name,
          slug: data.slug,
          bio: data.bio || null,
          website: data.website || null,
          phone: data.phone || null,
        },
      });

      return { data: updated, previousSlug: profile.slug };
    });

    if ("error" in result) return result;

    revalidatePath("/dealer/dashboard");
    revalidatePath("/dealer/profile");
    revalidatePath(`/dealers/${result.data.slug}`);
    if (result.previousSlug !== result.data.slug) {
      revalidatePath(`/dealers/${result.previousSlug}`);
    }
    return { data: result.data };
  } catch (err) {
    await reportHandledException({
      error: err,
      action: "updateMyDealerProfile",
      route: "/dealer/profile",
      userId: user.id,
    });
    const message =
      err instanceof Error && err.message.includes("Dealer profile address is permanently reserved")
        ? "This public profile address is already in use"
        : err instanceof Error
          ? err.message
          : "Failed to update dealer profile";
    return { error: message };
  }
}

export async function deactivateMyAccount(input: DeactivateMyAccountInput) {
  const user = await requireAcceptedAuth();

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
      const { enqueueAccountDeletionJob } = await import(
        "@/lib/privacy/account-deletion"
      );
      await enqueueAccountDeletionJob(tx, user.id);
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
    await reportHandledException({
      error: err,
      action: "deactivateMyAccount",
      route: "/account",
      userId: user.id,
    });
    const message =
      err instanceof Error ? err.message : "Failed to deactivate account";
    return { error: message };
  }
}
