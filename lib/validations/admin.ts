import { z } from "zod";
import { parseGbpInputToPence } from "@/lib/formatting/gbp";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const listUsersSchema = z.object({
  query: z.string().max(200).optional(),
  role: z.enum(["USER", "DEALER", "ADMIN"]).optional(),
  regionId: z.string().cuid().optional(),
  disabled: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type ListUsersInput = z.infer<typeof listUsersSchema>;

export const setUserRoleSchema = z.object({
  userId: z.string().cuid(),
  role: z.enum(["USER", "DEALER", "ADMIN"]),
  grantDurationDays: z.number().int().min(1).max(3_650).optional(),
});
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

export const grantDealerAccessSchema = z.object({
  userId: z.string().cuid(),
  durationDays: z.number().int().min(1).max(3_650),
});
export type GrantDealerAccessInput = z.infer<typeof grantDealerAccessSchema>;

export const revokeDealerAccessSchema = z.object({
  userId: z.string().cuid(),
});
export type RevokeDealerAccessInput = z.infer<typeof revokeDealerAccessSchema>;

export const setUserDisabledSchema = z.object({
  userId: z.string().cuid(),
  disabled: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type SetUserDisabledInput = z.infer<typeof setUserDisabledSchema>;

export const deleteUserSchema = z.object({
  userId: z.string().cuid(),
});
export type DeleteUserInput = z.infer<typeof deleteUserSchema>;

export const setUserRegionSchema = z.object({
  userId: z.string().cuid(),
  regionId: z.string().cuid().nullable(),
});
export type SetUserRegionInput = z.infer<typeof setUserRegionSchema>;

// ---------------------------------------------------------------------------
// Dealers
// ---------------------------------------------------------------------------

export const createDealerProfileSchema = z.object({
  userId: z.string().cuid(),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  grantDurationDays: z.number().int().min(1).max(3_650),
  bio: z.string().max(2000).optional(),
  website: z.string().url().max(500).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
});
export type CreateDealerProfileInput = z.infer<typeof createDealerProfileSchema>;

export const updateDealerProfileSchema = z.object({
  dealerId: z.string().cuid(),
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens").optional(),
  bio: z.string().max(2000).optional(),
  website: z.string().url().max(500).optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
  verified: z.boolean().optional(),
});
export type UpdateDealerProfileInput = z.infer<typeof updateDealerProfileSchema>;

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

export const createRegionSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});
export type CreateRegionInput = z.infer<typeof createRegionSchema>;

export const updateRegionSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type UpdateRegionInput = z.infer<typeof updateRegionSchema>;

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const searchPaymentsSchema = z.object({
  query: z.string().max(200).optional(),
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export type SearchPaymentsInput = z.infer<typeof searchPaymentsSchema>;

export const refundPaymentSchema = z.object({
  paymentId: z.string().cuid(),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const refundSubscriptionPaymentSchema = z.object({
  subscriptionId: z.string().cuid(),
});
export type RefundSubscriptionPaymentInput = z.infer<
  typeof refundSubscriptionPaymentSchema
>;

export const cancelSubscriptionSchema = z.object({
  subscriptionId: z.string().cuid(),
  immediately: z.boolean().default(false),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

// ---------------------------------------------------------------------------
// Content Pages
// ---------------------------------------------------------------------------

export const upsertContentPageSchema = z.object({
  id: z.string().cuid().optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1).max(200),
  markdown: z.string().max(50000),
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(500).optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});
export type UpsertContentPageInput = z.infer<typeof upsertContentPageSchema>;

// ---------------------------------------------------------------------------
// Site Settings
// ---------------------------------------------------------------------------

export const updateSiteSettingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.unknown(),
});
export type UpdateSiteSettingInput = z.infer<typeof updateSiteSettingSchema>;

const gbpPriceInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a price")
  .transform((value, context) => {
    try {
      return parseGbpInputToPence(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "Enter a valid GBP amount.",
      });
      return z.NEVER;
    }
  })
  .pipe(z.number().int().min(1).max(10_000_000));

export const updateMarketplacePricingSchema = z.object({
  privateListing: gbpPriceInputSchema,
  featuredUpgrade: gbpPriceInputSchema,
  dealerStarterMonthly: gbpPriceInputSchema,
  dealerProMonthly: gbpPriceInputSchema,
  optionalListingSupport: gbpPriceInputSchema,
});
export type UpdateMarketplacePricingInput = z.input<
  typeof updateMarketplacePricingSchema
>;
