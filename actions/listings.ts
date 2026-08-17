"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import {
  getDealerEntitlement,
  getCurrentDealerEntitlement,
  hasDealerAccountAccess,
} from "@/lib/dealers/entitlement";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import {
  createListingSchema,
  updateListingSchema,
  reportListingSchema,
  contactSellerSchema,
  submitListingForReviewSchema,
  type CreateListingInput,
  type ContactSellerInput,
  type ReportListingInput,
} from "@/lib/validations/listing";
import {
  sendContactConfirmationEmail,
  sendReportNotificationEmail,
  sendSellerContactEmail,
} from "@/lib/email/resend";
import { validateListingAttributes } from "@/lib/listings/attribute-ui";
import { captureBusinessEvent, captureException } from "@/lib/monitoring";
import {
  transitionListingStatus,
} from "@/lib/listings/status-events";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import { canSkipListingPayment } from "@/lib/listings/payment-skip";
import {
  getOpenRevision,
  getOrCreateDraftRevision,
  submitRevision,
  updateDraftRevision,
} from "@/lib/listings/revisions";
import { isInPlaceEditable, usesPendingRevision } from "@/lib/listings/visibility";
import { expireAbandonedListingImageIntents, processListingImageCleanupJobs } from "@/lib/listings/photo-cleanup";
import { isListingPubliclyVisible } from "@/lib/listings/visibility";
import {
  syncListingImagesForUser,
  type ListingPhotoMutationItem,
  type SyncListingImagesInput,
} from "@/lib/listings/photo-mutation";
import { claimFreeListingSlot } from "@/lib/config/marketplace";

// ---------------------------------------------------------------------------
// Create Listing
// ---------------------------------------------------------------------------

export async function createListing(input: CreateListingInput) {
  const user = await requireAcceptedAuth();

  if (user.role === "DEALER" && !user.dealerProfile) {
    return { error: "A dealer profile is required to post listings." };
  }

  if (hasDealerAccountAccess(user)) {
    const entitlement = await getCurrentDealerEntitlement(user);
    if (!entitlement) {
      return { error: "Active dealer access is required to post listings." };
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
  const category = await db.category.findUnique({
    where: { id: data.categoryId, active: true },
    select: {
      slug: true,
      attributeDefinitions: {
        select: {
          id: true,
          slug: true,
          name: true,
          dataType: true,
          required: true,
          options: true,
        },
      },
    },
  });
  if (!category) {
    return { error: { categoryId: ["Invalid or inactive category."] } };
  }

  const region = await db.region.findUnique({
    where: { id: data.regionId, active: true },
    select: { id: true },
  });
  if (!region) {
    return { error: { regionId: ["Invalid or inactive region."] } };
  }

  const attributeValidation = validateListingAttributes({
    categorySlug: category.slug,
    definitions: category.attributeDefinitions,
    attributes,
  });
  if (Object.keys(attributeValidation.fieldErrors).length > 0) {
    return { error: attributeValidation.fieldErrors };
  }

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
            create: attributeValidation.sanitizedAttributes.map((attr) => ({
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
  const user = await requireAcceptedAuth();

  const parsed = updateListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { id, attributes, ...data } = parsed.data;

  const existing = await db.listing.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      categoryId: true,
      status: true,
      trustDeclarationAcceptedAt: true,
      lifecycleRevision: true,
    },
  });
  if (!existing) return { error: "Listing not found" };
  if (existing.userId !== user.id) {
    return { error: "Not authorized to edit this listing" };
  }
  if (!isInPlaceEditable(existing.status) && !usesPendingRevision(existing.status)) {
    return { error: "This listing cannot be edited in its current status." };
  }

  let sanitizedAttributes:
    | Array<{ attributeDefinitionId: string; value: string }>
    | undefined;

  if (data.categoryId || attributes !== undefined) {
    const category = await db.category.findUnique({
      where: { id: data.categoryId ?? existing.categoryId },
      select: {
        slug: true,
        attributeDefinitions: {
          select: {
            id: true,
            slug: true,
            name: true,
            dataType: true,
            required: true,
            options: true,
          },
        },
      },
    });

    if (!category) {
      return { error: { categoryId: ["Invalid category."] } };
    }

    if (attributes !== undefined) {
      const attributeValidation = validateListingAttributes({
        categorySlug: category.slug,
        definitions: category.attributeDefinitions,
        attributes,
      });

      if (Object.keys(attributeValidation.fieldErrors).length > 0) {
        return { error: attributeValidation.fieldErrors };
      }

      sanitizedAttributes = attributeValidation.sanitizedAttributes;
    }
  }

  try {
    if (usesPendingRevision(existing.status)) {
      const open = await getOpenRevision(id);
      const revision = open ?? (await getOrCreateDraftRevision({ listingId: id, userId: user.id }));
      const currentListing = await db.listing.findUniqueOrThrow({
        where: { id },
        select: { lifecycleRevision: true },
      });
      const updatedRevision = await updateDraftRevision({
        listingId: id,
        userId: user.id,
        expectedVersion: revision.version,
        expectedListingRevision: currentListing.lifecycleRevision,
        data,
        attributes: sanitizedAttributes,
      });
      revalidatePath(`/listings/${id}`);
      revalidatePath("/account/listings");
      revalidatePath("/dealer/dashboard");
      return { data: { ...updatedRevision, id } };
    }

    const listing = await db.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id },
        data: {
          ...data,
          ...(data.trustDeclarationAccepted !== undefined
            ? {
                trustDeclarationAcceptedAt: data.trustDeclarationAccepted
                  ? existing.trustDeclarationAcceptedAt ?? new Date()
                  : null,
              }
            : {}),
        },
      });

      if (attributes !== undefined) {
        await tx.listingAttributeValue.deleteMany({ where: { listingId: id } });
        if (sanitizedAttributes && sanitizedAttributes.length > 0) {
          await tx.listingAttributeValue.createMany({
            data: sanitizedAttributes.map((attr) => ({
              listingId: id,
              attributeDefinitionId: attr.attributeDefinitionId,
              value: attr.value,
            })),
          });
        }
      }

      return updated;
    });

    revalidatePath(`/listings/${id}`);
    revalidatePath("/account/listings");
    revalidatePath("/dealer/dashboard");
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

export async function submitListingForReview(
  input:
    | string
    | {
        listingId: string;
        privateSellerTermsAccepted?: true;
      },
) {
  const user = await requireAcceptedAuth();
  const parsedInput = submitListingForReviewSchema.safeParse(
    typeof input === "string" ? { listingId: input } : input,
  );
  if (!parsedInput.success) {
    return { error: parsedInput.error.flatten().fieldErrors };
  }
  const { listingId, privateSellerTermsAccepted } = parsedInput.data;

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      images: { select: { id: true } },
      dealer: { select: { tier: true } },
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  const { getPolicyFlags } = await import("@/lib/policy/flags");
  const policyFlags = getPolicyFlags();
  if (policyFlags.enforceListingNs) {
    const { isWriteOffCategoryValue, WRITE_OFF_SUBMIT_ERROR } = await import(
      "@/lib/listings/write-off-category"
    );
    const writeOff =
      listing.status === "LIVE"
        ? await db.listingRevisionAttributeValue.findFirst({
            where: {
              revision: { listingId, status: { in: ["DRAFT", "PENDING"] } },
              attributeDefinition: { slug: "write-off-category" },
            },
            select: { value: true },
          })
        : await db.listingAttributeValue.findFirst({
            where: {
              listingId,
              attributeDefinition: { slug: "write-off-category" },
            },
            select: { value: true },
          });
    if (!isWriteOffCategoryValue(writeOff?.value)) {
      return { error: WRITE_OFF_SUBMIT_ERROR };
    }
  }
  const {
    hasCurrentBundleAcceptance,
    recordAcceptance,
    requireBundleAcceptance,
  } = await import("@/lib/policy/acceptance");
  if (listing.dealerId) {
    const dealerGate = await requireBundleAcceptance(user.id, "DEALER_BUNDLE");
    if (!dealerGate.ok) return { error: dealerGate.error };
  } else if (privateSellerTermsAccepted === true) {
    try {
      await recordAcceptance(db, {
        userId: user.id,
        acceptanceType: "LISTING_BUNDLE",
        source: "LISTING",
      });
    } catch (err) {
      await captureException({
        source: "SERVER",
        error: err,
        action: "submitListingForReview",
        route: "/sell",
        requestPath: "/sell",
        userId: user.id,
        tags: { listingId, acceptanceType: "LISTING_BUNDLE" },
      });
      return {
        error:
          "Unable to record Private Seller Terms acceptance. Please try again.",
      };
    }
  } else if (policyFlags.enforceAcceptance) {
    try {
      const previouslyAccepted = await hasCurrentBundleAcceptance(
        user.id,
        "LISTING_BUNDLE",
      );
      if (!previouslyAccepted) {
        return {
          error:
            "You must accept the Private Seller Terms before submitting this listing.",
        };
      }
    } catch (err) {
      await captureException({
        source: "SERVER",
        error: err,
        action: "submitListingForReview",
        route: "/sell",
        requestPath: "/sell",
        userId: user.id,
        tags: { listingId, acceptanceType: "LISTING_BUNDLE" },
      });
      return {
        error:
          "Unable to verify Private Seller Terms acceptance. Please try again.",
      };
    }
  }
  if (listing.status === "LIVE") {
    try {
      const openRevision = await getOpenRevision(listingId);
      if (!openRevision || openRevision.status !== "DRAFT") {
        return { error: "No draft changes to submit." };
      }
      const result = await submitRevision({
        listingId,
        userId: user.id,
        expectedListingRevision: listing.lifecycleRevision,
        expectedVersion: openRevision.version,
      });
      revalidatePath(`/listings/${listingId}`);
      revalidatePath("/admin/listings");
      return { data: result.listing };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit listing changes";
      return { error: message };
    }
  }
  if (
    listing.status !== "DRAFT" &&
    listing.status !== "TAKEN_DOWN" &&
    listing.status !== "REJECTED"
  ) {
    return { error: "This listing cannot be submitted in its current status." };
  }
  if (listing.images.length < 2) return { error: "At least 2 photos are required" };
  if (!listing.trustDeclarationAccepted) {
    const { LISTING_DECLARATION_ERROR } = await import(
      "@/lib/listings/write-off-category"
    );
    return { error: LISTING_DECLARATION_ERROR };
  }

  if (listing.dealerId && listing.dealer) {
    const entitlement = await getDealerEntitlement(
      listing.dealerId,
      listing.dealer.tier
    );
    if (!entitlement) {
      return {
        error: "Active dealer access is required before submitting dealer listings.",
      };
    }
  }

  if (listing.status === "TAKEN_DOWN" || listing.status === "REJECTED") {
    const skip = await canSkipListingPayment(db, {
      listingId,
      userId: user.id,
      dealerId: listing.dealerId,
    });
    if (!skip.skip) {
      return { error: "Payment is required before this listing can be resubmitted." };
    }
  }

  if (!listing.dealerId && listing.status === "DRAFT") {
    const isRenewal = Boolean(
      listing.expiresAt && listing.expiresAt.getTime() <= Date.now()
    );
    const hasSuccessfulPayment = await db.payment.findFirst({
      where: {
        listingId,
        type: "LISTING",
        status: "SUCCEEDED",
        ...(isRenewal && listing.expiresAt
          ? { createdAt: { gt: listing.expiresAt } }
          : {}),
      },
      select: { id: true },
    });
    if (!hasSuccessfulPayment) {
      if (isRenewal) {
        return {
          error: "Payment is required to renew an expired listing.",
        };
      }

      try {
        const freeClaim = await claimFreeListingSlot({
          userId: user.id,
          listingId,
          onClaim: async (transaction) => {
            const [currentListing, imageCount, paidListing] = await Promise.all([
              transaction.listing.findUnique({
                where: { id: listingId },
                select: {
                  dealerId: true,
                  expiresAt: true,
                  status: true,
                  trustDeclarationAccepted: true,
                  userId: true,
                  lifecycleRevision: true,
                },
              }),
              transaction.listingImage.count({ where: { listingId } }),
              transaction.payment.findFirst({
                where: {
                  listingId,
                  type: "LISTING",
                  status: "SUCCEEDED",
                },
                select: { id: true },
              }),
            ]);

            if (
              !currentListing ||
              currentListing.userId !== user.id ||
              currentListing.dealerId ||
              currentListing.status !== "DRAFT" ||
              !currentListing.trustDeclarationAccepted ||
              imageCount < 2
            ) {
              throw new Error("This listing changed before it could be submitted. Please refresh and try again.");
            }
            if (currentListing.expiresAt && currentListing.expiresAt.getTime() <= Date.now()) {
              throw new Error("Payment is required to renew an expired listing.");
            }
            if (paidListing) {
              throw new Error("A payment was received for this listing. Please refresh and try again.");
            }

            const updated = await transitionListingStatus(
              {
                listingId,
                action: "SUBMIT",
                expectedRevision: currentListing.lifecycleRevision,
                actor: {
                  id: user.id,
                  role: user.role === "ADMIN" ? "ADMIN" : "USER",
                },
                source: "USER",
                notes: "Submitted for moderation with free listing claim",
              },
              transaction,
            );

            return updated;
          },
        });

        if (freeClaim.status === "already-claimed") {
          return {
            error:
              "Your one free listing has already been used. Complete payment for this listing to submit it.",
          };
        }
        if (freeClaim.status === "slots-exhausted") {
          return {
            error:
              "All free launch listings have now been claimed. Complete payment for this listing to submit it.",
          };
        }

        if (freeClaim.status === "claimed" && freeClaim.data) {
          try {
            await dispatchListingNotifications([freeClaim.data.notification]);
          } catch {
            // Email is best-effort after the free-claim commit.
          }
          revalidatePath(`/listings/${listingId}`);
          return { data: freeClaim.data.listing };
        }
        revalidatePath(`/listings/${listingId}`);
        return { data: freeClaim.data };
      } catch (err) {
        await captureException({
          source: "SERVER",
          error: err,
          action: "submitListingForReview",
          route: `/listings/${listingId}`,
          requestPath: `/listings/${listingId}`,
          userId: user.id,
          userEmail: user.email,
          tags: { listingId, flow: "free-listing-claim" },
        });
        const message = err instanceof Error ? err.message : "Failed to submit listing";
        return {
          error: message,
        };
      }
    }
  }

  try {
    const updated = await transitionListingStatus({
      listingId,
      action: "SUBMIT",
      expectedRevision: listing.lifecycleRevision,
      actor: { id: user.id, role: user.role === "ADMIN" ? "ADMIN" : "USER" },
      source: "USER",
      notes: "Submitted for moderation",
    });

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/admin/listings");
    return { data: updated.listing };
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
  const user = await requireAcceptedAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  const canRenewTakenDown =
    listing.status === "TAKEN_DOWN" &&
    listing.expiresAt !== null &&
    listing.expiresAt.getTime() <= Date.now();
  if (listing.status !== "EXPIRED" && !canRenewTakenDown) {
    return { error: "Only expired listings can be renewed" };
  }

  try {
    const updated = await transitionListingStatus({
      listingId,
      action: "RENEW",
      expectedRevision: listing.lifecycleRevision,
      actor: { id: user.id, role: "USER" },
      source: "USER",
      notes: "Listing renewed",
    });

    revalidatePath(`/listings/${listingId}`);
    return { data: updated.listing };
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

  const targetListing = await db.listing.findUnique({
    where: { id: parsed.data.listingId },
    select: { id: true, title: true, status: true, expiresAt: true },
  });
  if (
    !targetListing ||
    !isListingPubliclyVisible({
      status: targetListing.status,
      expiresAt: targetListing.expiresAt,
    })
  ) {
    return { error: "Listing unavailable" };
  }

  try {
    const report = await db.report.create({
      data: {
        listingId: parsed.data.listingId,
        reporterEmail: parsed.data.reporterEmail,
        reason: parsed.data.reason,
        reasonCode: parsed.data.reasonCode,
      },
    });

    const listing = targetListing;
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
  if (
    !listing ||
    !isListingPubliclyVisible({
      status: listing.status,
      expiresAt: listing.expiresAt,
    })
  ) {
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
  const user = await requireAcceptedAuth();

  const listing = await db.listing.findUnique({ where: { id: listingId } });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) {
    return { error: "Not authorized" };
  }
  if (listing.status !== "LIVE") {
    return { error: "Only live listings can be marked as sold" };
  }

  try {
    const updated = await transitionListingStatus({
      listingId,
      action: "MARK_SOLD",
      expectedRevision: listing.lifecycleRevision,
      actor: { id: user.id, role: "USER" },
      source: "USER",
      notes: "Marked as sold",
    });

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/");
    return { data: updated.listing };
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
// Sync listing photos (ordered set, revision-checked)
// ---------------------------------------------------------------------------

export async function syncListingImages(
  listingId: string,
  input: SyncListingImagesInput,
) {
  const user = await requireAcceptedAuth();

  try {
    const result = await syncListingImagesForUser({
      listingId,
      userId: user.id,
      isAdmin: user.role === "ADMIN",
      input,
    });
    if (result.error) return result;

    await expireAbandonedListingImageIntents();
    await processListingImageCleanupJobs();

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/account/listings");
    revalidatePath("/dealer/dashboard");
    return result;
  } catch (err) {
    await captureException({
      source: "SERVER",
      error: err,
      action: "syncListingImages",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId, imageCount: input.photos.length },
    });
    const message = err instanceof Error ? err.message : "Failed to update images";
    return { error: message };
  }
}

export async function saveListingImages(
  listingId: string,
  photos: ListingPhotoMutationItem[],
  input: Omit<SyncListingImagesInput, "photos">,
) {
  return syncListingImages(listingId, { ...input, photos });
}

export async function replaceListingImages(
  listingId: string,
  photos: ListingPhotoMutationItem[],
  input: Omit<SyncListingImagesInput, "photos">,
) {
  return syncListingImages(listingId, { ...input, photos });
}
