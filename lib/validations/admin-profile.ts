import { z } from "zod";
import { PROFILE_NAME_REQUIRED_MESSAGE } from "@/lib/validations/profile-name";

const DEALER_NAME_MESSAGE = "Enter a dealer name of at least 2 characters.";

function clearableText(max: number) {
  return z.union([z.string().trim().max(max), z.null()]).optional();
}

function requiredName(message: string) {
  return z
    .string()
    .trim()
    .min(2, message)
    .max(100, "Name must be under 100 characters.")
    .optional();
}

const websiteSchema = z
  .union([
    z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => value.length === 0 || z.string().url().safeParse(value).success,
        "Enter a valid website address.",
      ),
    z.null(),
  ])
  .optional();

const accountProfileSchema = z
  .object({
    name: requiredName(PROFILE_NAME_REQUIRED_MESSAGE),
    phone: clearableText(30),
    bio: clearableText(2000),
    regionId: z.union([z.string().cuid(), z.null()]).optional(),
  })
  .strict();

const dealerProfileSchema = z
  .object({
    dealerId: z.string().cuid(),
    expectedDealerUpdatedAt: z.string().datetime(),
    name: requiredName(DEALER_NAME_MESSAGE),
    phone: clearableText(30),
    website: websiteSchema,
    bio: clearableText(2000),
  })
  .strict();

export const adminProfileEditSchema = z
  .object({
    userId: z.string().cuid(),
    expectedUserUpdatedAt: z.string().datetime(),
    account: accountProfileSchema.optional(),
    dealer: dealerProfileSchema.optional(),
  })
  .strict();

export type AdminProfileEditInput = z.infer<typeof adminProfileEditSchema>;
