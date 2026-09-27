import { z } from "zod";
import {
  canonicalCorrespondenceCategories,
  normalizeCorrespondenceEmail,
  DEALER_EMAIL_CATEGORIES,
  type DealerCorrespondenceCategory,
} from "@/lib/dealers/correspondence";
import { emailField } from "@/lib/validations/email";

export const saveDealerCorrespondenceSchema = z
  .object({
    email: z.string().trim().max(320, "Email address is too long."),
    categories: z.array(z.enum(DEALER_EMAIL_CATEGORIES)).max(DEALER_EMAIL_CATEGORIES.length),
    copyAssignedToPrimary: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const email = emailField.safeParse(value.email);
    if (email.success) return;
    ctx.addIssue({
      code: "custom",
      path: ["email"],
      message: email.error.issues[0]?.message ?? "Enter a valid email address.",
    });
  })
  .transform((value) => ({
    email: normalizeCorrespondenceEmail(value.email),
    categories: canonicalCorrespondenceCategories(value.categories),
    copyAssignedToPrimary: value.copyAssignedToPrimary,
  }));

type SaveDealerCorrespondenceSchemaInput = z.input<typeof saveDealerCorrespondenceSchema>;

export type SaveDealerCorrespondenceInput = Omit<
  SaveDealerCorrespondenceSchemaInput,
  "categories"
> & {
  categories: readonly DealerCorrespondenceCategory[];
};

export const verifyDealerCorrespondenceSchema = z
  .object({
    token: z.string().trim().min(32, "This confirmation link is not valid.").max(128),
  })
  .strict();

export type VerifyDealerCorrespondenceInput = z.input<typeof verifyDealerCorrespondenceSchema>;
