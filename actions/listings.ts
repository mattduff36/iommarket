"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createListingSchema,
  updateListingSchema,
  reportListingSchema,
  type CreateListingInput,
  type ReportListingInput,
} from "@/lib/validations/listing";

// ---------------------------------------------------------------------------
// Create Listing
// ---------------------------------------------------------------------------

export async function createListing(input: CreateListingInput) {
  const user = await requireAuth();

  const rateCheck = checkRateLimit(`create-listing:${user.id}`, {
    windowMs: 60_000,
    maxRequests: 5,
  });
  if (!rateCheck.allowed) {
    return { error: "Too many requests. Please try again shortly." };
  }

  const parsed = createListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { attributes, ...data } = parsed.data;

  try {
    const listing = await db.listing.create({
      data: {
        ...data,
        userId: user.id,
        dealerId: user.dealerProfile?.id ?? null,
        status: "DRAFT",
        attributeValues: {
          create: attributes.map((attr) => ({
            attributeDefinitionId: attr.attributeDefinitionId,
            value: attr.value,
          })),
        },
      },
    });

    revalidatePath("/");
    return { data: listing };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Update Listing
// ---------------------------------------------------------------------------

export async function updateListing(input: unknown) {
  const user = await requireAuth();

  const parsed = updateListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { id, attributes, ...data } = parsed.data;

  const existing = await db.listing.findUnique({ where: { id } });
  if (!existing) return { error: "Listing not found" };
  if (existing.userId !== user.id && user.role !== "ADMIN") {
    return { error: "Not authorized to edit this listing" };
  }

  try {
    const listing = await db.listing.update({
      where: { id },
      data: {
        ...data,
        status: "DRAFT", // edits reset to draft for re-moderation
      },
    });

    if (attributes && attributes.length > 0) {
      await db.listingAttributeValue.deleteMany({ where: { listingId: id } });
      await db.listingAttributeValue.createMany({
        data: attributes.map((attr) => ({
          listingId: id,
          attributeDefinitionId: attr.attributeDefinitionId,
          value: attr.value,
        })),
      });
    }

    revalidatePath(`/listings/${id}`);
    revalidatePath("/");
    return { data: listing };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Submit for Review (Draft → Pending)
// ---------------------------------------------------------------------------

export async function submitListingForReview(listingId: string) {
  const user = await requireAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status !== "DRAFT") return { error: "Listing is not in draft status" };

  try {
    const updated = await db.listing.update({
      where: { id: listingId },
      data: { status: "PENDING" },
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Renew Listing
// ---------------------------------------------------------------------------

export async function renewListing(listingId: string) {
  const user = await requireAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status !== "EXPIRED") {
    return { error: "Only expired listings can be renewed" };
  }

  try {
    const updated = await db.listing.update({
      where: { id: listingId },
      data: { status: "DRAFT" },
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to renew listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Report Listing
// ---------------------------------------------------------------------------

export async function reportListing(input: ReportListingInput) {
  const rateCheck = checkRateLimit(
    `report:${input.reporterEmail}`,
    { windowMs: 300_000, maxRequests: 3 }
  );
  if (!rateCheck.allowed) {
    return { error: "Too many reports. Please try again later." };
  }

  const parsed = reportListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  try {
    const report = await db.report.create({
      data: {
        listingId: parsed.data.listingId,
        reporterEmail: parsed.data.reporterEmail,
        reason: parsed.data.reason,
      },
    });

    return { data: report };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit report";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Upload Listing Images (save records after Cloudinary upload)
// ---------------------------------------------------------------------------

export async function saveListingImages(
  listingId: string,
  images: Array<{ url: string; publicId: string; order: number }>
) {
  const user = await requireAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id && user.role !== "ADMIN") {
    return { error: "Not authorized" };
  }

  try {
    const created = await db.listingImage.createMany({
      data: images.map((img) => ({
        listingId,
        url: img.url,
        publicId: img.publicId,
        order: img.order,
      })),
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: created };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save images";
    return { error: message };
  }
}
