import type { Prisma } from "@prisma/client";
import { getAdminDealerWhere } from "@/lib/dealers/access";

export function buildAdminDealersWhere(input: {
  query?: string;
  verified?: boolean;
  id?: string;
}): Prisma.DealerProfileWhereInput {
  const dealerId = input.id?.trim();
  return {
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
  };
}
