"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import {
  createListingSchema,
  updateListingSchema,
  reportListingSchema,
  contactSellerSchema,
  type CreateListingInput,
  type ContactSellerInput,
  type ReportListingInput,
} from "@/lib/validations/listing";
import {
  sendContactConfirmationEmail,
  sendReportNotificationEmail,
  sendSellerContactEmail,
} from "@/lib/email/resend";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";
import {
  transitionListingStatus,
} from "@/lib/listings/status-events";

// ---------------------------------------------------------------------------
// Create Listing
// ---------------------------------------------------------------------------

export async function createListing(input: CreateListingInput) {
  const user = await requireAuth();

  if (user.role === "DEALER") {
    if (!user.dealerProfile) {
      return { error: "A dealer profile is required to post listings." };
    }
    const activeSub = await db.subscription.findFirst({
      where: {
        dealerId: user.dealerProfile.id,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!activeSub) {
      return { error: "Active dealer subscription required to post listings." };
    }

    const listingCap = getDealerListingCap(user.dealerProfile.tier);
    const activeListingCount = await db.listing.count({
      where: {
        dealerId: user.dealerProfile.id,
        status: {
          in: ["DRAFT", "PENDING", "APPROVED", "LIVE"],
        },
      },
    });
    if (activeListingCount >= listingCap) {
      return {
        error: `Your ${user.dealerProfile.tier === "PRO" ? "Pro" : "Starter"} plan allows up to ${listingCap} active listings. Upgrade to list more vehicles.`,
      };
    }
  }

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

  const { attributes, trustDeclarationAccepted, ...data } = parsed.data;

  try {
    const listing = await db.$transaction(async (tx) => {
      const created = await tx.listing.create({
        data: {
          ...data,
          userId: user.id,
          dealerId: user.dealerProfile?.id ?? null,
          status: "DRAFT",
          trustDeclarationAccepted,
          trustDeclarationAcceptedAt: trustDeclarationAccepted ? new Date() : null,
          attributeValues: {
            create: attributes.map((attr) => ({
              attributeDefinitionId: attr.attributeDefinitionId,
              value: attr.value,
            })),
          },
        },
      });

      await tx.listingStatusEvent.create({
        data: {
          listingId: created.id,
          toStatus: "DRAFT",
          changedByUserId: user.id,
          source: user.role === "ADMIN" ? "ADMIN" : "USER",
          notes: "Listing created",
        },
      });

      return created;
    });

    revalidatePath("/");
    return { data: listing };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "createListing",
      route: "/sell/private",
      requestPath: "/sell/private",
      userId: user.id,
      userEmail: user.email,
    });
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
    const listing = await transitionListingStatus({
      listingId: id,
      toStatus: "DRAFT",
      changedByUserId: user.id,
      source: user.role === "ADMIN" ? "ADMIN" : "USER",
      notes: "Listing edited and reset for moderation",
      additionalData: data,
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
    await captureException({
      source: "SERVER",
      error: err,
      action: "updateListing",
      route: `/listings/${id}`,
      requestPath: `/listings/${id}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId: id },
    });
    const message = err instanceof Error ? err.message : "Failed to update listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Submit for Review (Draft → Pending)
// ---------------------------------------------------------------------------

export async function submitListingForReview(listingId: string) {
  const user = await requireAuth();

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      images: { select: { id: true } },
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (listing.status !== "DRAFT") return { error: "Listing is not in draft status" };
  if (listing.images.length < 2) return { error: "At least 2 photos are required" };
  if (!listing.trustDeclarationAccepted) {
    return {
      error:
        "Please confirm the vehicle is not stolen and has no outstanding finance before submitting.",
    };
  }

  try {
    const updated = await transitionListingStatus({
      listingId,
      toStatus: "PENDING",
      changedByUserId: user.id,
      source: user.role === "ADMIN" ? "ADMIN" : "USER",
      notes: "Submitted for moderation",
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: updated };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "submitListingForReview",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
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
    const updated = await transitionListingStatus({
      listingId,
      toStatus: "DRAFT",
      changedByUserId: user.id,
      source: user.role === "ADMIN" ? "ADMIN" : "USER",
      notes: "Listing renewed",
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: updated };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "renewListing",
      route: "/account/listings",
      requestPath: "/account/listings",
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    const message = err instanceof Error ? err.message : "Failed to renew listing";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Report Listing
// ---------------------------------------------------------------------------

export async function reportListing(input: ReportListingInput) {
  const parsed = reportListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const rateCheck = checkRateLimit(
    makeRateLimitKey("report", parsed.data.reporterEmail),
    { windowMs: 300_000, maxRequests: 3 }
  );
  if (!rateCheck.allowed) {
    return { error: "Too many reports. Please try again later." };
  }

  try {
    const report = await db.report.create({
      data: {
        listingId: parsed.data.listingId,
        reporterEmail: parsed.data.reporterEmail,
        reason: parsed.data.reason,
      },
    });

    const listing = await db.listing.findUnique({
      where: { id: parsed.data.listingId },
      select: { title: true },
    });
    if (listing) {
      try {
        await sendReportNotificationEmail({
          reporterEmail: parsed.data.reporterEmail,
          listingTitle: listing.title,
          reason: parsed.data.reason,
        });
      } catch (err) {
        await captureBusinessEvent({
          source: "BUSINESS",
          severity: "MEDIUM",
          title: "Report confirmation email failed",
          message: "Report created successfully but notification email sending failed.",
          action: "reportListing",
          route: `/listings/${parsed.data.listingId}`,
          requestPath: `/listings/${parsed.data.listingId}`,
          tags: {
            listingId: parsed.data.listingId,
            reporterEmail: parsed.data.reporterEmail,
          },
          extra: {
            error:
              err instanceof Error
                ? { name: err.name, message: err.message }
                : { message: "Unknown error" },
          },
        });
      }
    }

    return { data: report };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "reportListing",
      route: `/listings/${parsed.data.listingId}`,
      requestPath: `/listings/${parsed.data.listingId}`,
      tags: { listingId: parsed.data.listingId },
    });
    const message = err instanceof Error ? err.message : "Failed to submit report";
    return { error: message };
  }
}

// ---------------------------------------------------------------------------
// Contact Seller (public; account not required)
// ---------------------------------------------------------------------------
export async function contactSeller(input: ContactSellerInput) {
  const parsed = contactSellerSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const rateCheck = checkRateLimit(
    makeRateLimitKey("contact-seller", parsed.data.email),
    { windowMs: 300_000, maxRequests: 5 }
  );
  if (!rateCheck.allowed) {
    return { error: "Too many messages sent. Please try again later." };
  }
  if (parsed.data.website) {
    return { error: "Spam detected." };
  }

  const listing = await db.listing.findUnique({
    where: { id: parsed.data.listingId },
    include: {
      user: { select: { email: true } },
    },
  });
  if (!listing || (listing.status !== "LIVE" && listing.status !== "APPROVED")) {
    return { error: "Listing unavailable" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const listingUrl = `${appUrl}/listings/${listing.id}`;
  try {
    await sendSellerContactEmail({
      sellerEmail: listing.user.email,
      listingTitle: listing.title,
      listingUrl,
      fromName: parsed.data.name,
      fromEmail: parsed.data.email,
      message: parsed.data.message,
    });
    await sendContactConfirmationEmail({
      buyerEmail: parsed.data.email,
      listingTitle: listing.title,
    });
    return { data: { sent: true } };
  } catch (err) {
    await captureException({
      source: "BUSINESS",
      error: err,
      severity: "MEDIUM",
      title: "Contact seller email delivery failure",
      action: "contactSeller",
      route: `/listings/${parsed.data.listingId}`,
      requestPath: `/listings/${parsed.data.listingId}`,
      tags: { listingId: parsed.data.listingId },
    });
    return { error: "Failed to send message. Please try again later." };
  }
}

// ---------------------------------------------------------------------------
// Mark Listing As Sold
// ---------------------------------------------------------------------------

export async function markListingAsSold(listingId: string) {
  const user = await requireAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id && user.role !== "ADMIN") {
    return { error: "Not authorized" };
  }
  if (listing.status !== "LIVE") {
    return { error: "Only live listings can be marked as sold" };
  }

  try {
    const updated = await transitionListingStatus({
      listingId,
      toStatus: "SOLD",
      changedByUserId: user.id,
      source: user.role === "ADMIN" ? "ADMIN" : "USER",
      notes: "Marked as sold",
      additionalData: { soldAt: new Date() },
    });

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/");
    return { data: updated };
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "markListingAsSold",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    const message = err instanceof Error ? err.message : "Failed to mark listing as sold";
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
    const existingCount = await db.listingImage.count({ where: { listingId } });
    if (existingCount + images.length > 20) {
      return { error: "Maximum 20 images allowed" };
    }
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
    await captureException({
      source: "SERVER",
      error: err,
      action: "saveListingImages",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId, imageCount: images.length },
    });
    const message = err instanceof Error ? err.message : "Failed to save images";
    return { error: message };
  }
}
