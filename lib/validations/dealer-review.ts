import { z } from "zod";

export const createDealerReviewSchema = z.object({
  dealerId: z.string().cuid("Invalid dealer ID"),
  rating: z
    .number()
    .int("Rating must be a whole number")
    .min(1, "Rating must be between 1 and 5")
    .max(5, "Rating must be between 1 and 5"),
  comment: z
    .string()
    .max(2000, "Comment is too long")
    .optional()
    .default(""),
});

export const moderateDealerReviewSchema = z
  .object({
    reviewId: z.string().cuid("Invalid review ID"),
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "HIDDEN"]),
    reasonCode: z.enum(["POLICY", "ABUSE", "SPAM", "OFF_TOPIC", "OTHER"]).optional(),
    adminNotes: z.string().max(2000, "Admin notes are too long").optional(),
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

export type CreateDealerReviewInput = z.infer<typeof createDealerReviewSchema>;
export type ModerateDealerReviewInput = z.infer<typeof moderateDealerReviewSchema>;
