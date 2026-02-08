"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  moderateListingSchema,
  type ModerateListingInput,
} from "@/lib/validations/listing";
import {
  createCategorySchema,
  createAttributeDefinitionSchema,
  type CreateCategoryInput,
  type CreateAttributeDefinitionInput,
} from "@/lib/validations/category";

// ---------------------------------------------------------------------------
// Moderate Listing (Approve / Reject / Take Down)
// ---------------------------------------------------------------------------

export async function moderateListing(input: ModerateListingInput) {
  await requireRole("ADMIN");

  const parsed = moderateListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { listingId, action, adminNotes } = parsed.data;

  const statusMap = {
    APPROVE: "APPROVED" as const,
    REJECT: "TAKEN_DOWN" as const,
    TAKE_DOWN: "TAKEN_DOWN" as const,
  };

  try {
    const listing = await db.listing.update({
      where: { id: listingId },
      data: {
        status: statusMap[action],
        ...(action === "APPROVE"
          ? {
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            }
          : {}),
      },
    });

    revalidatePath("/admin/listings");
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/");
    return { data: listing };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to moderate listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Create Category
// ---------------------------------------------------------------------------

export async function createCategory(input: CreateCategoryInput) {
  await requireRole("ADMIN");

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const category = await db.category.create({ data: parsed.data });
    revalidatePath("/admin/categories");
    return { data: category };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create category";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Create Attribute Definition
// ---------------------------------------------------------------------------

export async function createAttributeDefinition(
  input: CreateAttributeDefinitionInput
) {
  await requireRole("ADMIN");

  const parsed = createAttributeDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const attr = await db.attributeDefinition.create({ data: parsed.data });
    revalidatePath("/admin/categories");
    return { data: attr };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create attribute";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Admin Dashboard Stats
// ---------------------------------------------------------------------------

export async function getAdminStats() {
  await requireRole("ADMIN");

  const [
    totalListings,
    pendingListings,
    liveListings,
    totalDealers,
    openReports,
    recentPayments,
  ] = await Promise.all([
    db.listing.count(),
    db.listing.count({ where: { status: "PENDING" } }),
    db.listing.count({ where: { status: "LIVE" } }),
    db.dealerProfile.count(),
    db.report.count({ where: { status: "OPEN" } }),
    db.payment.count({
      where: {
        status: "SUCCEEDED",
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return {
    totalListings,
    pendingListings,
    liveListings,
    totalDealers,
    openReports,
    recentPayments,
  };
}
