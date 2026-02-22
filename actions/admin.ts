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
import { z } from "zod";

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
    APPROVE: "LIVE" as const,
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

const updateReportSchema = z.object({
  reportId: z.string().cuid(),
  status: z.enum(["OPEN", "REVIEWED", "ACTIONED", "DISMISSED"]),
  adminNotes: z.string().max(2000).optional(),
});

export async function updateReportStatus(input: {
  reportId: string;
  status: "OPEN" | "REVIEWED" | "ACTIONED" | "DISMISSED";
  adminNotes?: string;
}) {
  await requireRole("ADMIN");
  const parsed = updateReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const report = await db.report.update({
      where: { id: parsed.data.reportId },
      data: {
        status: parsed.data.status,
        adminNotes: parsed.data.adminNotes,
      },
    });
    revalidatePath("/admin/reports");
    return { data: report };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update report";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Delete Attribute Definition
// ---------------------------------------------------------------------------

export async function deleteAttributeDefinition(id: string) {
  await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  try {
    await db.attributeDefinition.delete({ where: { id } });
    revalidatePath("/admin/categories");
    return { data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete attribute";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Toggle Category Active
// ---------------------------------------------------------------------------

export async function toggleCategoryActive(id: string, active: boolean) {
  await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  try {
    const category = await db.category.update({ where: { id }, data: { active } });
    revalidatePath("/admin/categories");
    revalidatePath("/");
    return { data: category };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update category";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Delete Category
// ---------------------------------------------------------------------------

export async function deleteCategory(id: string) {
  await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  const listingCount = await db.listing.count({ where: { categoryId: id } });
  if (listingCount > 0) {
    return { error: `Cannot delete: category has ${listingCount} listing${listingCount !== 1 ? "s" : ""}` };
  }
  try {
    await db.category.delete({ where: { id } });
    revalidatePath("/admin/categories");
    return { data: { deleted: true } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete category";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Feature Toggle (listing)
// ---------------------------------------------------------------------------

const toggleFeatureSchema = z.object({
  listingId: z.string().cuid(),
  featured: z.boolean(),
});

export async function setListingFeatured(input: {
  listingId: string;
  featured: boolean;
}) {
  await requireRole("ADMIN");
  const parsed = toggleFeatureSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const listing = await db.listing.update({
      where: { id: parsed.data.listingId },
      data: { featured: parsed.data.featured },
    });
    revalidatePath("/admin/listings");
    revalidatePath(`/listings/${parsed.data.listingId}`);
    revalidatePath("/search");
    return { data: listing };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update listing";
    return { error: message };
  }
}
