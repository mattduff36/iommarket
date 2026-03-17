import { z } from "zod";

export const updateMyProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  regionId: z.string().cuid().nullable(),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  avatarUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
});
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

export const updateDealerSelfProfileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  website: z.string().trim().url().max(500).optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  logoUrl: z.string().trim().url().max(500).optional().or(z.literal("")),
});
export type UpdateDealerSelfProfileInput = z.infer<
  typeof updateDealerSelfProfileSchema
>;

export const deactivateMyAccountSchema = z.object({
  confirmationText: z.literal("DELETE MY ACCOUNT"),
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});
export type DeactivateMyAccountInput = z.infer<
  typeof deactivateMyAccountSchema
>;
