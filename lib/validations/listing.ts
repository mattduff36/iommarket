import { z } from "zod";
import { LISTING_DECLARATION_ERROR } from "@/lib/listings/write-off-category";

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
        attributeDefinitionId: z.string().cuid(),
        value: z.string().trim().min(1, "Value is required"),
      })
    )
    .optional()
    .default([]),
});

export const updateListingSchema = createListingSchema.partial().extend({
  id: z.string().cuid(),
});

export const renewListingSchema = z.object({
  listingId: z.string().cuid(),
});

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
  })
  .superRefine((value, ctx) => {
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
