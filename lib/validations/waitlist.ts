import { z } from "zod";
import { emailField } from "@/lib/validations/email";

export const WAITLIST_INTEREST_OPTIONS = [
  "BUYING_CARS",
  "SELLING_CARS",
  "DEALER",
] as const;

export type WaitlistInterest = (typeof WAITLIST_INTEREST_OPTIONS)[number];

export const WAITLIST_INTERESTS_MESSAGE =
  "Choose buying, selling, or dealer so we know what to send you.";
export const WAITLIST_CONSENT_MESSAGE =
  "Tick this box to confirm you want launch updates. You cannot join the waiting list without it.";

export const joinWaitlistSchema = z.object({
  email: emailField,
  interests: z
    .array(z.enum(WAITLIST_INTEREST_OPTIONS))
    .min(1, WAITLIST_INTERESTS_MESSAGE)
    .transform((items) => Array.from(new Set(items))),
  source: z.string().trim().min(1).max(120).default("coming_soon_page"),
  marketingConsent: z
    .boolean()
    .refine((value) => value, WAITLIST_CONSENT_MESSAGE),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
