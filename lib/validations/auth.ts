import { z } from "zod";

export const signUpSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().max(120).optional().or(z.literal("")),
  nextPath: z
    .string()
    .refine(
      (value) => value.startsWith("/") && !value.startsWith("//"),
      "Invalid redirect",
    )
    .default("/account"),
  ageAttested: z
    .boolean()
    .refine((value) => value, "You must confirm you are 18 or over"),
  policiesAccepted: z
    .boolean()
    .refine((value) => value, "You must acknowledge the current policies"),
});

export const acceptPoliciesSchema = z.object({
  ageAttested: z
    .boolean()
    .refine((value) => value, "You must confirm you are 18 or over"),
  policiesAccepted: z
    .boolean()
    .refine((value) => value, "You must acknowledge the current policies"),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type AcceptPoliciesInput = z.infer<typeof acceptPoliciesSchema>;
