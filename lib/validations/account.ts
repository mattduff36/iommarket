import { z } from "zod";

export const updateMyProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter a name of at least 2 characters.")
    .max(100, "Name must be under 100 characters."),
  regionId: z.string().cuid("Choose a valid region.").nullable(),
  phone: z
    .string()
    .trim()
    .max(30, "Phone number is too long.")
    .optional()
    .or(z.literal("")),
  bio: z
    .string()
    .trim()
    .max(2000, "Bio is too long.")
    .optional()
    .or(z.literal("")),
  avatarUrl: z
    .string()
    .trim()
    .url("Enter a valid URL, for example https://example.com/photo.jpg.")
    .max(500)
    .optional()
    .or(z.literal("")),
});
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

export const updateDealerSelfProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Enter a dealer name of at least 2 characters.")
    .max(100, "Dealer name must be under 100 characters."),
  slug: z
    .string()
    .trim()
    .min(2, "Enter a profile slug of at least 2 characters.")
    .max(100, "Profile slug must be under 100 characters.")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only."),
  bio: z
    .string()
    .trim()
    .max(2000, "Bio is too long.")
    .optional()
    .or(z.literal("")),
  website: z
    .string()
    .trim()
    .url("Enter a valid website URL, for example https://example.com.")
    .max(500)
    .optional()
    .or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(30, "Phone number is too long.")
    .optional()
    .or(z.literal("")),
}).strict();
export type UpdateDealerSelfProfileInput = z.infer<
  typeof updateDealerSelfProfileSchema
>;

export const deactivateMyAccountSchema = z.object({
  confirmationText: z.literal("DELETE MY ACCOUNT", {
    error: "Type DELETE MY ACCOUNT to confirm.",
  }),
  reason: z
    .string()
    .trim()
    .max(500, "Reason is too long.")
    .optional()
    .or(z.literal("")),
});
export type DeactivateMyAccountInput = z.infer<
  typeof deactivateMyAccountSchema
>;
