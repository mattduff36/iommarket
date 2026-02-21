import { z } from "zod";

export const createListingSchema = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(120, "Title must be under 120 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(5000, "Description must be under 5,000 characters"),
  price: z
    .number()
    .int("Price must be a whole number (in pence)")
    .min(100, "Minimum price is £1")
    .max(100_000_000, "Maximum price is £1,000,000"),
  categoryId: z.string().cuid("Invalid category"),
  regionId: z.string().cuid("Invalid region"),
  attributes: z
    .array(
      z.object({
        attributeDefinitionId: z.string().cuid(),
        value: z.string().min(1, "Value is required"),
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

export const reportListingSchema = z.object({
  listingId: z.string().cuid(),
  reporterEmail: z.string().email("Valid email required"),
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

export const moderateListingSchema = z.object({
  listingId: z.string().cuid(),
  action: z.enum(["APPROVE", "REJECT", "TAKE_DOWN"]),
  adminNotes: z.string().max(2000).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ReportListingInput = z.infer<typeof reportListingSchema>;
export type ModerateListingInput = z.infer<typeof moderateListingSchema>;
export type ContactSellerInput = z.infer<typeof contactSellerSchema>;
