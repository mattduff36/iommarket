import { z } from "zod";

export const EARLY_ACCESS_CONFIRM_PHRASE = "SEND EARLY ACCESS";
export const EARLY_ACCESS_BODY_MAX = 2000;

export const earlyAccessBodySchema = z.object({
  bodyText: z
    .string()
    .trim()
    .min(1, "Enter the invitation message.")
    .max(EARLY_ACCESS_BODY_MAX, "Keep the message under 2000 characters."),
});

export const confirmEarlyAccessSchema = earlyAccessBodySchema.extend({
  confirmation: z
    .string()
    .refine(
      (value) => value === EARLY_ACCESS_CONFIRM_PHRASE,
      "Enter SEND EARLY ACCESS to confirm.",
    ),
});

export const earlyAccessClaimSchema = z.object({
  recipientId: z.string().trim().min(1).max(64),
  proof: z.string().trim().min(20).max(200),
});
