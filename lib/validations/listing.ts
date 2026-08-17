import { z } from "zod";
import { LISTING_DECLARATION_ERROR } from "@/lib/listings/write-off-category";
import {
  MODERATION_TAXONOMY_VERSION,
  validateModerationReason,
} from "@/lib/listings/moderation-reasons";
import { FEATURED_LISTING_PHOTO_LIMIT } from "@/lib/listings/photo-limits";

export const vehicleCatalogueSelectionSchema = z.object({
  makeMode: z.enum(["catalogue", "manual"]),
  modelMode: z.enum(["catalogue", "manual"]),
  canonicalMake: z.string().trim().min(1).max(80).optional(),
  canonicalModel: z.string().trim().min(1).max(80).optional(),
  variant: z.string().trim().max(60).optional(),
});

export const createListingSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters")
    .max(120, "Title must be under 120 characters"),
  description: z
    .string()
    .trim()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description must be under 5,000 characters"),
  price: z
    .number()
    .finite("Price must be a valid number")
    .int("Price must be a whole number (in pence)")
    .min(100, "Minimum price is £1")
    .max(100_000_000, "Maximum price is £1,000,000"),
  categoryId: z.string().cuid("Invalid category"),
  regionId: z.string().cuid("Invalid region"),
  trustDeclarationAccepted: z
    .boolean()
    .refine((value) => value, LISTING_DECLARATION_ERROR),
  attributes: z
    .array(
      z.object({
        attributeDefinitionId: z.string().trim().min(1).max(100),
        value: z.string().trim().min(1, "Value is required"),
      })
    )
    .optional()
    .default([]),
  vehicleCatalogueSelection: vehicleCatalogueSelectionSchema.optional(),
});

export const updateListingSchema = createListingSchema.partial().extend({
  id: z.string().cuid(),
});

export const renewListingSchema = z.object({
  listingId: z.string().cuid(),
});

export const submitListingForReviewSchema = z.object({
  listingId: z.string().min(1).max(100),
  privateSellerTermsAccepted: z.literal(true).optional(),
});
export type SubmitListingForReviewInput = z.infer<
  typeof submitListingForReviewSchema
>;

export const withdrawListingSubmissionSchema = z
  .object({
    listingId: z.string().cuid("Invalid listing"),
    expectedRevision: z.number().int().min(0),
  })
  .strict();

const listingPhotoMutationItemSchema = z
  .object({
    imageId: z.string().trim().min(1).max(100).optional(),
    uploadIntentId: z.string().trim().min(1).max(100).optional(),
    focalX: z.number().finite().min(0).max(1).nullable().optional(),
    focalY: z.number().finite().min(0).max(1).nullable().optional(),
  })
  .strict()
  .superRefine((photo, ctx) => {
    if (Boolean(photo.imageId) === Boolean(photo.uploadIntentId)) {
      ctx.addIssue({
        code: "custom",
        path: ["imageId"],
        message: "Each photo must reference exactly one image or upload.",
      });
    }
    const hasFocalX = photo.focalX !== undefined;
    const hasFocalY = photo.focalY !== undefined;
    if (hasFocalX !== hasFocalY) {
      ctx.addIssue({
        code: "custom",
        path: ["focalX"],
        message: "Focal points must include both X and Y coordinates.",
      });
    }
  });

export const syncListingImagesSchema = z
  .object({
    photos: z.array(listingPhotoMutationItemSchema).max(FEATURED_LISTING_PHOTO_LIMIT),
    basePhotoRevision: z.number().int().min(0),
    mutationId: z.string().trim().min(1).max(100),
  })
  .strict();

export const syncListingImagesActionSchema = z
  .object({
    listingId: z.string().trim().min(1).max(100),
    input: syncListingImagesSchema,
  })
  .strict();

export const REPORT_REASON_CODES = [
  "FRAUD",
  "PROHIBITED",
  "MISLEADING",
  "DUPLICATE",
  "POLICY",
  "SAFETY",
  "OTHER",
] as const;

export const reportListingSchema = z.object({
  listingId: z.string().cuid(),
  reporterEmail: z.string().email("Valid email required"),
  reasonCode: z.enum(REPORT_REASON_CODES),
  reason: z
    .string()
    .min(10, "Please provide more detail")
    .max(2000, "Reason is too long"),
});

export const contactSellerSchema = z.object({
  listingId: z.string().cuid(),
  name: z.string().min(2, "Name is required").max(120, "Name is too long"),
  email: z.string().email("Valid email required"),
  message: z
    .string()
    .min(10, "Please provide more detail")
    .max(2000, "Message is too long"),
  website: z.string().max(0).optional().default(""),
});

export const LISTING_MODERATION_ACTIONS = [
  "APPROVE",
  "REJECT",
  "TAKE_DOWN",
  "REINSTATE_LIVE",
  "RETURN_TO_DRAFT",
  "APPROVE_REVISION",
  "REJECT_REVISION",
] as const;

export const moderateListingSchema = z
  .object({
    listingId: z.string().cuid(),
    action: z.enum(LISTING_MODERATION_ACTIONS),
    expectedRevision: z.number().int().min(0),
    expectedRevisionVersion: z.number().int().min(0).optional(),
    reasonCode: z
      .enum([
        "FRAUD",
        "PROHIBITED",
        "MISLEADING",
        "DUPLICATE",
        "POLICY",
        "SAFETY",
        "ACCOUNT_DISABLED",
        "OTHER",
      ])
      .optional(),
    adminNotes: z.string().max(2000).optional(),
    reportId: z.string().cuid().optional(),
    moderationSubReason: z.string().min(1).max(120).optional(),
    moderationTaxonomyVersion: z
      .literal(MODERATION_TAXONOMY_VERSION)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const needsReason = value.action !== "APPROVE" && value.action !== "APPROVE_REVISION";
    if (
      (value.action === "APPROVE_REVISION" || value.action === "REJECT_REVISION") &&
      value.expectedRevisionVersion == null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedRevisionVersion"],
        message: "A revision version is required.",
      });
    }
    if (needsReason && !value.reasonCode) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "A reason is required.",
      });
    }
    if (needsReason && !value.moderationSubReason) {
      ctx.addIssue({
        code: "custom",
        path: ["moderationSubReason"],
        message: "A moderation subreason is required.",
      });
    }
    if (needsReason && !value.moderationTaxonomyVersion) {
      ctx.addIssue({
        code: "custom",
        path: ["moderationTaxonomyVersion"],
        message: "A moderation taxonomy version is required.",
      });
    }
    const taxonomyError = validateModerationReason({
      reasonCode: value.reasonCode,
      moderationSubReason: value.moderationSubReason,
      moderationTaxonomyVersion: value.moderationTaxonomyVersion,
      notes: value.adminNotes,
      required: needsReason,
    });
    if (taxonomyError) {
      ctx.addIssue({
        code: "custom",
        path: ["moderationSubReason"],
        message: taxonomyError,
      });
    }
    if (value.reasonCode === "OTHER" && !value.adminNotes?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["adminNotes"],
        message: "Notes are required when the reason is Other.",
      });
    }
  });

export const takeDownFromReportSchema = z
  .object({
    reportId: z.string().cuid(),
    expectedRevision: z.number().int().min(0),
    reasonCode: z.enum([
      "FRAUD",
      "PROHIBITED",
      "MISLEADING",
      "DUPLICATE",
      "POLICY",
      "SAFETY",
      "OTHER",
    ]),
    adminNotes: z.string().max(2000).optional(),
    moderationSubReason: z.string().min(1).max(120),
    moderationTaxonomyVersion: z.literal(MODERATION_TAXONOMY_VERSION),
  })
  .superRefine((value, ctx) => {
    const taxonomyError = validateModerationReason({
      reasonCode: value.reasonCode,
      moderationSubReason: value.moderationSubReason,
      moderationTaxonomyVersion: value.moderationTaxonomyVersion,
      notes: value.adminNotes,
      required: true,
    });
    if (taxonomyError) {
      ctx.addIssue({
        code: "custom",
        path: ["moderationSubReason"],
        message: taxonomyError,
      });
    }
    if (value.reasonCode === "OTHER" && !value.adminNotes?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["adminNotes"],
        message: "Notes are required when the reason is Other.",
      });
    }
  });

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ReportListingInput = z.infer<typeof reportListingSchema>;
export type ModerateListingInput = z.infer<typeof moderateListingSchema>;
export type TakeDownFromReportInput = z.infer<typeof takeDownFromReportSchema>;
export type ContactSellerInput = z.infer<typeof contactSellerSchema>;
