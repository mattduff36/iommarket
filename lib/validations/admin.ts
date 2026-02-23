import { z } from "zod";

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
});
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;

export const setUserDisabledSchema = z.object({
  userId: z.string().cuid(),
  disabled: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type SetUserDisabledInput = z.infer<typeof setUserDisabledSchema>;

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
});
export type CreateRegionInput = z.infer<typeof createRegionSchema>;

export const updateRegionSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(2).max(100).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/).optional(),
  active: z.boolean().optional(),
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
