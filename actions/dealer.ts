"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { z } from "zod";

const selfServiceDealerProfileSchema = z.object({
  name: z
    .string()
    .min(2, "Business name must be at least 2 characters")
    .max(100, "Business name must be at most 100 characters"),
  phone: z.string().max(30).optional(),
  website: z.string().url().max(500).optional().or(z.literal("")),
});

export type SelfServiceDealerProfileInput = z.infer<
  typeof selfServiceDealerProfileSchema
>;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createSelfServiceDealerProfile(
  input: SelfServiceDealerProfileInput
) {
  const user = await requireAuth();

  if (user.dealerProfile) {
    return { data: user.dealerProfile };
  }

  const parsed = selfServiceDealerProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const base = slugify(parsed.data.name) || `dealer-${user.id.slice(-6)}`;

  for (let i = 0; i < 100; i += 1) {
    const slug = i === 0 ? base : `${base}-${i}`;
    const existing = await db.dealerProfile.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) continue;

    try {
      const profile = await db.dealerProfile.create({
        data: {
          userId: user.id,
          name: parsed.data.name,
          slug,
          phone: parsed.data.phone || undefined,
          website: parsed.data.website || undefined,
        },
      });

      revalidatePath("/dealer/subscribe");
      revalidatePath("/dealer/dashboard");
      return { data: profile };
    } catch (err) {
      const isUniqueViolation =
        err instanceof Error &&
        (err.message.includes("Unique constraint") ||
          err.message.includes("unique constraint") ||
          err.message.includes("P2002"));
      if (isUniqueViolation) continue;

      const message =
        err instanceof Error ? err.message : "Failed to create dealer profile";
      return { error: message };
    }
  }

  return { error: "Could not generate a unique URL slug. Try a different business name." };
}
