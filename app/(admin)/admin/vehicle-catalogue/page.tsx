export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { VehicleCatalogueAdmin } from "./vehicle-catalogue-admin";

export const metadata: Metadata = { title: "Vehicle Catalogue" };

interface Props {
  searchParams?: Promise<{ q?: string }>;
}

export default async function VehicleCataloguePage({ searchParams }: Props) {
  const query = (searchParams ? (await searchParams).q : "")?.trim().slice(0, 80) ?? "";
  const makes = await db.vehicleMake.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            {
              models: {
                some: {
                  OR: [
                    { name: { contains: query, mode: "insensitive" } },
                    {
                      aliases: {
                        some: { name: { contains: query, mode: "insensitive" } },
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 100,
    include: {
      models: {
        where: query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                {
                  aliases: {
                    some: { name: { contains: query, mode: "insensitive" } },
                  },
                },
              ],
            }
          : undefined,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        take: 150,
        include: {
          aliases: {
            where: query
              ? { name: { contains: query, mode: "insensitive" } }
              : undefined,
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            take: 20,
          },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Vehicle Catalogue</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Maintain canonical makes, models, aliases, source versions, and display order.
          Deactivate records instead of deleting them.
        </p>
      </div>
      <VehicleCatalogueAdmin makes={makes} query={query} />
    </div>
  );
}
