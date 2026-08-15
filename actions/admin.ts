"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  moderateListingSchema,
  takeDownFromReportSchema,
  type ModerateListingInput,
  type TakeDownFromReportInput,
} from "@/lib/validations/listing";
import { logAdminAction } from "@/lib/admin/audit";
import { liveListingWhere } from "@/lib/listings/expiry";
import {
  createCategorySchema,
  createAttributeDefinitionSchema,
  type CreateCategoryInput,
  type CreateAttributeDefinitionInput,
} from "@/lib/validations/category";
import { transitionListingStatus } from "@/lib/listings/status-events";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import { approveRevision, rejectRevision } from "@/lib/listings/revisions";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Moderate Listing (Approve / Reject / Take Down)
// ---------------------------------------------------------------------------

export async function moderateListing(input: ModerateListingInput) {
  const admin = await requireRole("ADMIN");

  const parsed = moderateListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const {
    listingId,
    action,
    adminNotes,
    expectedRevision,
    expectedRevisionVersion,
    reasonCode,
    reportId,
  } = parsed.data;

  try {
    if (action === "APPROVE_REVISION") {
      if (expectedRevisionVersion == null) {
        return { error: "A revision version is required." };
      }
      const result = await approveRevision({
        listingId,
        adminId: admin.id,
        expectedListingRevision: expectedRevision,
        expectedVersion: expectedRevisionVersion,
      });
      revalidatePath("/admin/listings");
      revalidatePath(`/listings/${listingId}`);
      revalidatePath("/");
      return { data: result.listing };
    }
    if (action === "REJECT_REVISION") {
      if (!reasonCode) return { error: "A reason is required." };
      if (expectedRevisionVersion == null) {
        return { error: "A revision version is required." };
      }
      const result = await rejectRevision({
        listingId,
        adminId: admin.id,
        expectedListingRevision: expectedRevision,
        expectedVersion: expectedRevisionVersion,
        reasonCode,
        notes: adminNotes,
      });
      revalidatePath("/admin/listings");
      revalidatePath(`/listings/${listingId}`);
      revalidatePath("/");
      return { data: result.listing };
    }

    const result = await transitionListingStatus({
      listingId,
      action,
      expectedRevision,
      actor: { id: admin.id, role: "ADMIN" },
      source: "ADMIN",
      notes: adminNotes,
      reasonCode,
      reportId,
    });

    revalidatePath("/admin/listings");
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/");
    return { data: result.listing };
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
  const admin = await requireRole("ADMIN");

  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const category = await db.category.create({ data: parsed.data });
    await logAdminAction({
      adminId: admin.id,
      action: "CREATE_CATEGORY",
      entityType: "Category",
      entityId: category.id,
    });
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
    db.listing.count({
      where: {
        OR: [
          { status: "PENDING" },
          { revisions: { some: { status: "PENDING" } } },
        ],
      },
    }),
    db.listing.count({ where: liveListingWhere() }),
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
  const admin = await requireRole("ADMIN");
  const parsed = updateReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const report = await db.$transaction(async (tx) => {
      const existing = await tx.report.findUnique({
        where: { id: parsed.data.reportId },
        select: { id: true, status: true, listingId: true },
      });
      if (!existing) throw new Error("Report not found");

      const updated = await tx.report.update({
        where: { id: parsed.data.reportId },
        data: {
          status: parsed.data.status,
          adminNotes: parsed.data.adminNotes,
        },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "UPDATE_REPORT_STATUS",
          entityType: "Report",
          entityId: updated.id,
          details: {
            fromStatus: existing.status,
            toStatus: updated.status,
            listingId: existing.listingId,
          },
        },
        tx,
      );
      return updated;
    });
    revalidatePath("/admin/reports");
    return { data: report };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update report";
    return { error: message };
  }
}

export async function takeDownListingFromReport(input: TakeDownFromReportInput) {
  const admin = await requireRole("ADMIN");
  const parsed = takeDownFromReportSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const report = await db.report.findUnique({
      where: { id: parsed.data.reportId },
      include: { listing: { select: { id: true, status: true, lifecycleRevision: true } } },
    });
    if (!report) return { error: "Report not found" };

    const canModerate =
      report.listing.status === "LIVE" ||
      report.listing.status === "APPROVED" ||
      report.listing.status === "PENDING";
    const alreadyModerated =
      report.listing.status === "TAKEN_DOWN" || report.listing.status === "REJECTED";
    if (!canModerate && !alreadyModerated) {
      return { error: "This listing cannot be taken down from its current status." };
    }

    const notifications = await db.$transaction(async (tx) => {
      const collected = [];
      if (report.listing.status === "LIVE" || report.listing.status === "APPROVED") {
        const result = await transitionListingStatus(
          {
            listingId: report.listingId,
            action: "TAKE_DOWN",
            expectedRevision: parsed.data.expectedRevision,
            actor: { id: admin.id, role: "ADMIN" },
            source: "ADMIN",
            reasonCode: parsed.data.reasonCode,
            notes: parsed.data.adminNotes,
            reportId: report.id,
          },
          tx,
        );
        collected.push(result.notification);
      } else if (report.listing.status === "PENDING") {
        const result = await transitionListingStatus(
          {
            listingId: report.listingId,
            action: "REJECT",
            expectedRevision: parsed.data.expectedRevision,
            actor: { id: admin.id, role: "ADMIN" },
            source: "ADMIN",
            reasonCode: parsed.data.reasonCode,
            notes: parsed.data.adminNotes,
            reportId: report.id,
          },
          tx,
        );
        collected.push(result.notification);
      }

      await tx.report.update({
        where: { id: report.id },
        data: {
          status: "ACTIONED",
          adminNotes: parsed.data.adminNotes,
        },
      });
      await logAdminAction(
        {
          adminId: admin.id,
          action: "TAKE_DOWN_FROM_REPORT",
          entityType: "Report",
          entityId: report.id,
          details: {
            listingId: report.listingId,
            reasonCode: parsed.data.reasonCode,
          },
        },
        tx,
      );
      return collected;
    });

    try {
      await dispatchListingNotifications(notifications);
    } catch {
      // Email is best-effort after the report take-down commit.
    }

    revalidatePath("/admin/reports");
    revalidatePath("/admin/listings");
    revalidatePath(`/listings/${report.listingId}`);
    return { data: { actioned: true } };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to take down listing from report";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Delete Attribute Definition
// ---------------------------------------------------------------------------

export async function deleteAttributeDefinition(id: string) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  try {
    await db.attributeDefinition.delete({ where: { id } });
    await logAdminAction({
      adminId: admin.id,
      action: "DELETE_ATTRIBUTE",
      entityType: "AttributeDefinition",
      entityId: id,
    });
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
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  try {
    const listingCount = await db.listing.count({
      where: { categoryId: id, ...liveListingWhere() },
    });
    const category = await db.category.update({ where: { id }, data: { active } });
    await logAdminAction({
      adminId: admin.id,
      action: "TOGGLE_CATEGORY_ACTIVE",
      entityType: "Category",
      entityId: id,
      details: { active, liveListingCount: listingCount },
    });
    revalidatePath("/admin/categories");
    revalidatePath("/");
    return { data: { ...category, liveListingCount: listingCount } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update category";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Delete Category
// ---------------------------------------------------------------------------

export async function deleteCategory(id: string) {
  const admin = await requireRole("ADMIN");
  if (!id) return { error: "Missing id" };
  const listingCount = await db.listing.count({ where: { categoryId: id } });
  if (listingCount > 0) {
    return { error: `Cannot delete: category has ${listingCount} listing${listingCount !== 1 ? "s" : ""}` };
  }
  try {
    await db.category.delete({ where: { id } });
    await logAdminAction({
      adminId: admin.id,
      action: "DELETE_CATEGORY",
      entityType: "Category",
      entityId: id,
    });
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
  const admin = await requireRole("ADMIN");
  const parsed = toggleFeatureSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  try {
    const listing = await db.listing.update({
      where: { id: parsed.data.listingId },
      data: { featured: parsed.data.featured },
    });
    await logAdminAction({
      adminId: admin.id,
      action: "SET_LISTING_FEATURED",
      entityType: "Listing",
      entityId: listing.id,
      details: { featured: parsed.data.featured },
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
