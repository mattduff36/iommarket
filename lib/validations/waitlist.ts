import { z } from "zod";

export const WAITLIST_INTEREST_OPTIONS = [
  "BUYING_CARS",
  "SELLING_CARS",
  "DEALER",
] as const;

export type WaitlistInterest = (typeof WAITLIST_INTEREST_OPTIONS)[number];

export const joinWaitlistSchema = z.object({
  email: z.string().trim().email("Valid email required"),
  interests: z
    .array(z.enum(WAITLIST_INTEREST_OPTIONS))
    .min(1, "Select at least one interest")
    .transform((items) => Array.from(new Set(items))),
  source: z.string().trim().min(1).max(120).default("coming_soon_page"),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
