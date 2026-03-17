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

export const moderateDealerReviewSchema = z.object({
  reviewId: z.string().cuid("Invalid review ID"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "HIDDEN"]),
  adminNotes: z.string().max(2000, "Admin notes are too long").optional(),
});

export type CreateDealerReviewInput = z.infer<typeof createDealerReviewSchema>;
export type ModerateDealerReviewInput = z.infer<typeof moderateDealerReviewSchema>;
