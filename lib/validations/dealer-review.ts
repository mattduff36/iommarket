import { z } from "zod";

const moderationReasonSchema = z.enum([
  "POLICY",
  "ABUSE",
  "SPAM",
  "OFF_TOPIC",
  "OTHER",
]);

function sanitizePlainText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function plainTextSchema(options: { min: number; max: number; label: string }) {
  return z
    .string()
    .transform(sanitizePlainText)
    .pipe(
      z
        .string()
        .min(options.min, `${options.label} is required`)
        .max(options.max, `${options.label} is too long`)
        .refine(
          (value) => !/<\/?[a-z][^>]*>/i.test(value),
          `${options.label} must not contain HTML`,
        ),
    );
}

const optionalAdminNotesSchema = z
  .string()
  .transform(sanitizePlainText)
  .pipe(z.string().max(2000, "Admin notes are too long"))
  .optional();

export const createDealerReviewSchema = z.object({
  dealerId: z.string().cuid("Invalid dealer ID"),
  rating: z
    .number()
    .int("Rating must be a whole number")
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),
  comment: plainTextSchema({ min: 0, max: 2000, label: "Comment" })
    .optional()
    .default(""),
});

export const moderateDealerReviewSchema = z
  .object({
    reviewId: z.string().cuid("Invalid review ID"),
    expectedVersion: z.number().int().min(0),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "HIDDEN"]),
    reasonCode: moderationReasonSchema.optional(),
    adminNotes: optionalAdminNotesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status !== "APPROVED" && !value.reasonCode) {
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

export const saveDealerReviewResponseDraftSchema = z
  .object({
    reviewId: z.string().cuid("Invalid review ID"),
    revisionId: z.string().cuid("Invalid revision ID").optional(),
    expectedVersion: z.number().int().min(0).optional(),
    body: plainTextSchema({ min: 1, max: 2000, label: "Response" }),
  })
  .superRefine((value, ctx) => {
    if (value.revisionId && value.expectedVersion === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedVersion"],
        message: "The current revision version is required.",
      });
    }
  });

export const submitDealerReviewResponseSchema = z.object({
  reviewId: z.string().cuid("Invalid review ID"),
  revisionId: z.string().cuid("Invalid revision ID"),
  expectedVersion: z.number().int().min(0),
});

export const moderateDealerReviewResponseSchema = z
  .object({
    revisionId: z.string().cuid("Invalid revision ID"),
    expectedVersion: z.number().int().min(0),
    expectedResponseVersion: z.number().int().min(0),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reasonCode: moderationReasonSchema.optional(),
    adminNotes: optionalAdminNotesSchema,
  })
  .superRefine((value, ctx) => {
    if (value.decision === "REJECTED" && !value.reasonCode) {
      ctx.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "A reason is required when rejecting a response.",
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

export const openDealerReviewDisputeSchema = z.object({
  reviewId: z.string().cuid("Invalid review ID"),
  reasonCode: moderationReasonSchema,
  body: plainTextSchema({ min: 10, max: 3000, label: "Dispute details" }),
  evidenceNotes: plainTextSchema({
    min: 1,
    max: 2000,
    label: "Evidence notes",
  }).optional(),
});

export const decideDealerReviewDisputeSchema = z
  .object({
    disputeId: z.string().cuid("Invalid dispute ID"),
    expectedVersion: z.number().int().min(0),
    decision: z.enum(["RESOLVED", "REJECTED"]),
    reasonCode: moderationReasonSchema,
    adminNotes: optionalAdminNotesSchema,
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

export type CreateDealerReviewInput = z.infer<typeof createDealerReviewSchema>;
export type ModerateDealerReviewInput = z.infer<typeof moderateDealerReviewSchema>;
export type SaveDealerReviewResponseDraftInput = z.infer<
  typeof saveDealerReviewResponseDraftSchema
>;
export type SubmitDealerReviewResponseInput = z.infer<
  typeof submitDealerReviewResponseSchema
>;
export type ModerateDealerReviewResponseInput = z.infer<
  typeof moderateDealerReviewResponseSchema
>;
export type OpenDealerReviewDisputeInput = z.infer<
  typeof openDealerReviewDisputeSchema
>;
export type DecideDealerReviewDisputeInput = z.infer<
  typeof decideDealerReviewDisputeSchema
>;
