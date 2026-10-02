import type { Prisma } from "@prisma/client";
import { getAdminDealerWhere } from "@/lib/dealers/access";
import {
  applySampleDealerVisibility,
  DEFAULT_SAMPLE_VISIBILITY,
  type SampleVisibility,
} from "@/lib/listings/sample-visibility";

export function buildAdminDealersWhere(input: {
  query?: string;
  verified?: boolean;
  id?: string;
}, sampleVisibility: SampleVisibility = DEFAULT_SAMPLE_VISIBILITY): Prisma.DealerProfileWhereInput {
  const dealerId = input.id?.trim();
  return applySampleDealerVisibility({
    ...getAdminDealerWhere(),
    ...(dealerId ? { id: dealerId } : {}),
    ...(input.query
      ? {
          OR: [
            { name: { contains: input.query, mode: "insensitive" as const } },
            { slug: { contains: input.query, mode: "insensitive" as const } },
            { user: { email: { contains: input.query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(input.verified !== undefined ? { verified: input.verified } : {}),
  }, sampleVisibility);
}
