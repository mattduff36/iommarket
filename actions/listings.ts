"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAcceptedAuth } from "@/lib/policy/gate";
import { getDealerListingCap } from "@/lib/config/dealer-tiers";
import {
  hasDealerAccountAccess,
  hasMismatchedDealerListing,
  hasOperationalDealerAccess,
  listingDealerMatchesActor,
} from "@/lib/dealers/entitlement";
import {
  detachListingDealerIdIfNeeded,
  effectiveListingDealerId,
  runWithDealerDetach,
} from "@/lib/listings/submit-dealer-access";
import { checkRateLimit, makeRateLimitKey } from "@/lib/rate-limit";
import {
  createListingSchema,
  updateListingSchema,
  reportListingSchema,
  contactSellerSchema,
  submitListingForReviewSchema,
  withdrawListingSubmissionSchema,
  type CreateListingInput,
  type ContactSellerInput,
  type ReportListingInput,
} from "@/lib/validations/listing";
import {
  sendContactConfirmationEmail,
  sendReportNotificationEmail,
  sendSellerContactEmail,
} from "@/lib/email/resend";
import {
  captureBusinessEvent,
  captureException,
  reportHandledException,
} from "@/lib/monitoring";
import { transitionListingStatus } from "@/lib/listings/status-events";
import {
  ListingLifecycleConflictError,
  ListingLifecycleError,
  isListingConflictError,
  isListingLifecycleDomainError,
} from "@/lib/listings/errors";
import { dispatchListingNotifications } from "@/lib/email/listing-notifications";
import {
  canAdminSkipOwnedListingPayment,
  canSkipListingPayment,
} from "@/lib/listings/payment-skip";
import {
  getOpenRevision,
  getOrCreateDraftRevision,
  submitRevision,
  updateDraftRevision,
} from "@/lib/listings/revisions";
import {
  isAdminPreviewListing,
  isInPlaceEditable,
  isListingPubliclyVisible,
  usesPendingRevision,
} from "@/lib/listings/visibility";
import {
  type ListingPhotoMutationItem,
  type SyncListingImagesInput,
} from "@/lib/listings/photo-mutation";
import {
  runSaveListingImagesAction,
  runSyncListingImagesAction,
} from "@/lib/listings/sync-images-action";
import { claimFreeListingSlot } from "@/lib/config/marketplace";
import { validateVehicleCatalogueSubmission } from "@/lib/vehicle-catalogue/listing-validation";

const LISTING_LIFECYCLE_RATE_LIMIT = {
  windowMs: 10 * 60_000,
  maxRequests: 6,
} as const;
const USER_LIFECYCLE_RATE_LIMIT = {
  windowMs: 10 * 60_000,
  maxRequests: 12,
} as const;
const LISTING_LIFECYCLE_RATE_LIMIT_ERROR =
  "Too many listing status changes. Please wait a few minutes and try again.";

function canChangeListingLifecycle(userId: string, listingId: string) {
  const userCheck = checkRateLimit(
    makeRateLimitKey("listing-lifecycle-user", userId),
    USER_LIFECYCLE_RATE_LIMIT,
  );
  if (!userCheck.allowed) return false;

  return checkRateLimit(
    makeRateLimitKey("listing-lifecycle", `${userId}:${listingId}`),
    LISTING_LIFECYCLE_RATE_LIMIT,
  ).allowed;
}

function expectedListingActionError(
  error: unknown,
  conflictMessage: string,
): { error: string; conflict?: true } | null {
  if (isListingConflictError(error)) {
    return { error: conflictMessage, conflict: true };
  }
  if (isListingLifecycleDomainError(error)) {
    return { error: error.message };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Create Listing
// ---------------------------------------------------------------------------

export async function createListing(input: CreateListingInput) {
  const user = await requireAcceptedAuth();

  const parsed = createListingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { flow } = parsed.data;
  if (flow === "dealer" && user.role === "USER") {
    return { error: "A dealer account is required to post dealer listings." };
  }
  if (flow === "private" && user.role === "DEALER") {
    return { error: "Dealer accounts must use the dealer listing flow." };
  }

  if (flow === "dealer") {
    if (!hasDealerAccountAccess(user)) {
      return { error: "A dealer profile is required to post listings." };
    }
    if (!(await hasOperationalDealerAccess(user))) {
      return { error: "Active dealer access is required to post listings." };
    }

    if (user.role !== "ADMIN") {
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
  }

  const rateCheck = checkRateLimit(`create-listing:${user.id}`, {
    windowMs: 60_000,
    maxRequests: 5,
  });
  if (!rateCheck.allowed) {
    return { error: "Too many requests. Please try again shortly." };
  }

  const {
    attributes,
    trustDeclarationAccepted,
    vehicleCatalogueSelection,
    flow: listingFlow,
    ...data
  } = parsed.data;
  const [category, region] = await Promise.all([
    db.category.findUnique({
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
    }),
    db.region.findUnique({
      where: { id: data.regionId, active: true },
      select: { id: true },
    }),
  ]);
  if (!category) {
    return { error: { categoryId: ["Invalid or inactive category."] } };
  }

  if (!region) {
    return { error: { regionId: ["Invalid or inactive region."] } };
  }

  const { validateListingAttributesWithServerPolicy } = await import(
    "@/lib/listings/listing-ns-policy"
  );
  const attributeValidation = validateListingAttributesWithServerPolicy({
    categorySlug: category.slug,
    definitions: category.attributeDefinitions,
    attributes,
  });
  if (attributeValidation.configurationError) {
    return { error: attributeValidation.configurationError };
  }
  if (Object.keys(attributeValidation.fieldErrors).length > 0) {
    return { error: attributeValidation.fieldErrors };
  }
  const catalogueErrors = await validateVehicleCatalogueSubmission({
    definitions: category.attributeDefinitions,
    attributes: attributeValidation.sanitizedAttributes,
    selection: vehicleCatalogueSelection,
  });
  if (Object.keys(catalogueErrors).length > 0) {
    return { error: catalogueErrors };
  }

  try {
    const listing = await db.$transaction(async (tx) => {
      const created = await tx.listing.create({
        data: {
          ...data,
          userId: user.id,
          dealerId:
            listingFlow === "dealer" && hasDealerAccountAccess(user)
              ? user.dealerProfile.id
              : null,
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

  const { id, attributes, vehicleCatalogueSelection, ...data } = parsed.data;

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
      const { validateListingAttributesWithServerPolicy } = await import(
        "@/lib/listings/listing-ns-policy"
      );
      const attributeValidation = validateListingAttributesWithServerPolicy({
        categorySlug: category.slug,
        definitions: category.attributeDefinitions,
        attributes,
      });
      if (attributeValidation.configurationError) {
        return { error: attributeValidation.configurationError };
      }

      if (Object.keys(attributeValidation.fieldErrors).length > 0) {
        return { error: attributeValidation.fieldErrors };
      }

      sanitizedAttributes = attributeValidation.sanitizedAttributes;
      const catalogueErrors = await validateVehicleCatalogueSubmission({
        definitions: category.attributeDefinitions,
        attributes: sanitizedAttributes,
        selection: vehicleCatalogueSelection,
      });
      if (Object.keys(catalogueErrors).length > 0) {
        return { error: catalogueErrors };
      }
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
  if (!canChangeListingLifecycle(user.id, listingId)) {
    return { error: LISTING_LIFECYCLE_RATE_LIMIT_ERROR };
  }

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      images: { select: { id: true } },
      dealer: { select: { tier: true } },
    },
  });
  if (!listing) return { error: "Listing not found" };
  if (listing.userId !== user.id) return { error: "Not authorized" };
  if (hasMismatchedDealerListing(user, listing)) {
    return { error: "Not authorized" };
  }
  if (
    listingDealerMatchesActor(user, listing) &&
    !(await hasOperationalDealerAccess(user))
  ) {
    return {
      error: "Active dealer access is required before submitting dealer listings.",
    };
  }
  const adminOwnedPaymentSkip = canAdminSkipOwnedListingPayment({
    actor: user,
    listing,
  });
  const { getPolicyFlags } = await import("@/lib/policy/flags");
  const policyFlags = getPolicyFlags();
  const { getListingWriteOffReadiness } = await import(
    "@/lib/listings/listing-ns-policy"
  );
  const writeOffReadiness = await getListingWriteOffReadiness({
    listingId,
    listingStatus: listing.status,
  });
  if (!writeOffReadiness.ok) {
    return { error: writeOffReadiness.error };
  }
  const {
    hasCurrentBundleAcceptance,
    recordAcceptance,
    requireBundleAcceptance,
  } = await import("@/lib/policy/acceptance");
  const effectiveDealerId = effectiveListingDealerId(user, listing);
  if (effectiveDealerId) {
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
        seller: user,
      });
      revalidatePath(`/listings/${listingId}`);
      revalidatePath("/admin/listings");
      return { data: result.listing };
    } catch (err) {
      const expected = expectedListingActionError(
        err,
        "These listing changes changed before they could be submitted. Refresh and try again.",
      );
      if (expected) return expected;
      await reportHandledException({
        error: err,
        action: "submitListingRevisionForReview",
        route: `/listings/${listingId}`,
        requestPath: `/listings/${listingId}`,
        userId: user.id,
        userEmail: user.email,
        tags: { listingId },
      });
      return {
        error: "Unable to submit these listing changes. Please try again.",
      };
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

  if (effectiveDealerId && listing.dealer && !adminOwnedPaymentSkip) {
    if (!(await hasOperationalDealerAccess(user))) {
      return {
        error: "Active dealer access is required before submitting dealer listings.",
      };
    }
  }

  if (listing.status === "TAKEN_DOWN" || listing.status === "REJECTED") {
    if (
      !adminOwnedPaymentSkip &&
      !(
        await canSkipListingPayment(db, {
          listingId,
          userId: user.id,
          dealerId: effectiveDealerId,
        })
      ).skip
    ) {
      return { error: "Payment is required before this listing can be resubmitted." };
    }
  }

  if (!effectiveDealerId && listing.status === "DRAFT" && !adminOwnedPaymentSkip) {
    const isRenewal = Boolean(
      listing.expiresAt && listing.expiresAt.getTime() <= Date.now()
    );
    if (isRenewal) {
      const renewalPayment = await db.payment.findFirst({
        where: {
          listingId,
          type: "LISTING",
          status: "SUCCEEDED",
          ...(listing.expiresAt
            ? { createdAt: { gt: listing.expiresAt } }
            : {}),
        },
        select: { id: true },
      });
      if (!renewalPayment) {
        return {
          error: "Payment is required to renew an expired listing.",
        };
      }
    } else {
      const priorEntitlement = await canSkipListingPayment(db, {
        listingId,
        userId: user.id,
        dealerId: null,
      });

      if (!priorEntitlement.skip) {
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
                (currentListing.dealerId && hasDealerAccountAccess(user)) ||
                currentListing.status !== "DRAFT" ||
                !currentListing.trustDeclarationAccepted ||
                imageCount < 2
              ) {
                throw new ListingLifecycleConflictError(
                  "This listing changed before it could be submitted. Please refresh and try again.",
                );
              }
              await detachListingDealerIdIfNeeded(
                transaction,
                listingId,
                user,
                currentListing,
              );
              if (
                currentListing.expiresAt &&
                currentListing.expiresAt.getTime() <= Date.now()
              ) {
                throw new ListingLifecycleError(
                  "Payment is required to renew an expired listing.",
                );
              }
              if (paidListing) {
                throw new ListingLifecycleConflictError(
                  "A payment was received for this listing. Please refresh and try again.",
                );
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
          const expected = expectedListingActionError(
            err,
            "This listing changed before it could be submitted. Refresh and try again.",
          );
          if (expected) return expected;
          await reportHandledException({
            error: err,
            action: "submitListingForReview",
            route: `/listings/${listingId}`,
            requestPath: `/listings/${listingId}`,
            userId: user.id,
            userEmail: user.email,
            tags: { listingId, flow: "free-listing-claim" },
          });
          return {
            error: "Unable to submit this listing. Please try again.",
          };
        }
      }
    }
  }

  try {
    const submitPayload = {
      listingId,
      action: "SUBMIT" as const,
      expectedRevision: listing.lifecycleRevision,
      actor: {
        id: user.id,
        role: user.role === "ADMIN" ? ("ADMIN" as const) : ("USER" as const),
      },
      source: "USER" as const,
      notes: "Submitted for moderation",
    };
    const updated = await runWithDealerDetach(db, {
      listingId,
      user,
      listing,
      submit: (client) =>
        client
          ? transitionListingStatus(submitPayload, client)
          : transitionListingStatus(submitPayload),
    });

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/admin/listings");
    return { data: updated.listing };
  } catch (err) {
    const expected = expectedListingActionError(
      err,
      "This listing changed before it could be submitted. Refresh and try again.",
    );
    if (expected) return expected;
    await reportHandledException({
      error: err,
      action: "submitListingForReview",
      route: `/listings/${listingId}`,
      requestPath: `/listings/${listingId}`,
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    return { error: "Unable to submit this listing. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Withdraw Submission (Pending → Draft)
// ---------------------------------------------------------------------------

export async function withdrawListingSubmission(input: unknown) {
  const user = await requireAcceptedAuth();
  const parsed = withdrawListingSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Invalid withdrawal request." };
  }

  const { listingId, expectedRevision } = parsed.data;
  if (!canChangeListingLifecycle(user.id, listingId)) {
    return { error: LISTING_LIFECYCLE_RATE_LIMIT_ERROR };
  }

  try {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        userId: true,
        status: true,
        lifecycleRevision: true,
      },
    });
    if (!listing || listing.userId !== user.id) {
      return { error: "Submission not found." };
    }
    if (listing.status !== "PENDING") {
      return {
        error: "Only submissions awaiting review can be withdrawn.",
        conflict: true,
      };
    }
    if (listing.lifecycleRevision !== expectedRevision) {
      return {
        error:
          "This submission changed before it could be withdrawn. Refresh and try again.",
        conflict: true,
      };
    }

    const result = await transitionListingStatus({
      listingId,
      action: "WITHDRAW",
      expectedRevision,
      actor: { id: user.id, role: user.role === "DEALER" ? "DEALER" : "USER" },
      source: "USER",
      notes: "Submission withdrawn by seller",
    });

    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/account/listings");
    revalidatePath("/dealer/dashboard");
    revalidatePath("/admin/listings");
    return { data: result.listing };
  } catch (err) {
    const expected = expectedListingActionError(
      err,
      "This submission changed before it could be withdrawn. Refresh and try again.",
    );
    if (expected) return expected;

    await reportHandledException({
      error: err,
      action: "withdrawListingSubmission",
      route: "/account/listings",
      requestPath: "/account/listings",
      userId: user.id,
      userEmail: user.email,
      tags: { listingId },
    });
    return {
      error: "Unable to withdraw this submission. Please try again.",
    };
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
    isAdminPreviewListing(targetListing.status) ||
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
    isAdminPreviewListing(listing.status) ||
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

export async function syncListingImages(
  listingId: string,
  input: SyncListingImagesInput,
) {
  const user = await requireAcceptedAuth();
  return runSyncListingImagesAction(user, listingId, input);
}

export async function saveListingImages(
  listingId: string,
  photos: ListingPhotoMutationItem[],
  input: Omit<SyncListingImagesInput, "photos">,
) {
  const user = await requireAcceptedAuth();
  return runSaveListingImagesAction(user, listingId, photos, input);
}

export async function replaceListingImages(
  listingId: string,
  photos: ListingPhotoMutationItem[],
  input: Omit<SyncListingImagesInput, "photos">,
) {
  return syncListingImages(listingId, { ...input, photos });
}
