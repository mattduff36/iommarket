import { z } from "zod";
import { emailField } from "@/lib/validations/email";

export const sendDealerOnboardingSchema = z.object({
  dealerId: z.string().cuid("Choose a dealer account."),
  recipientEmail: emailField,
});

export const onboardingInviteIdSchema = z.object({
  inviteId: z.string().cuid("Choose an invitation."),
});

export const onboardingClaimSchema = z.object({
  token: z.string().trim().min(32).max(200),
});

export const onboardingAcceptanceSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters.").max(72),
    confirmPassword: z.string().min(8).max(72),
    ageAttested: z.boolean().refine((value) => value === true, "Confirm that you are 18 or over."),
    accountPoliciesAccepted: z
      .boolean()
      .refine(
        (value) => value === true,
        "Accept the Terms, Acceptable Use Policy, and Privacy Policy.",
      ),
    dealerPoliciesAccepted: z
      .boolean()
      .refine(
        (value) => value === true,
        "Accept the Dealer Terms, Acceptable Use Policy, and Refund Policy.",
      ),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });
