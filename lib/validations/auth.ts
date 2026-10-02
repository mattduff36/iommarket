import { z } from "zod";
import { emailField } from "@/lib/validations/email";
import { profileNameSchema } from "@/lib/validations/profile-name";

export const AGE_ATTESTED_MESSAGE = "Tick the box to confirm you are 18 or over.";
export const POLICIES_ACCEPTED_MESSAGE =
  "Tick the box to acknowledge the Terms, Acceptable Use Policy, and Privacy Policy.";

export const signUpSchema = z.object({
  email: emailField,
  password: z.string().min(8, "Password must be at least 8 characters."),
  name: profileNameSchema,
  nextPath: z
    .string()
    .refine(
      (value) => value.startsWith("/") && !value.startsWith("//"),
      "Invalid redirect",
    )
    .default("/account"),
  ageAttested: z.boolean().refine((value) => value, AGE_ATTESTED_MESSAGE),
  policiesAccepted: z.boolean().refine((value) => value, POLICIES_ACCEPTED_MESSAGE),
});

export const acceptPoliciesSchema = z.object({
  ageAttested: z.boolean().refine((value) => value, AGE_ATTESTED_MESSAGE),
  policiesAccepted: z.boolean().refine((value) => value, POLICIES_ACCEPTED_MESSAGE),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type AcceptPoliciesInput = z.infer<typeof acceptPoliciesSchema>;
