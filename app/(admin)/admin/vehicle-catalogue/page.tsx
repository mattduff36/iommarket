export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
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
    <>
      <AdminPageHeader
        title="Vehicle catalogue"
        description="Maintain canonical makes, models, aliases, source versions, and display order. Deactivate records instead of deleting them."
      />
      <VehicleCatalogueAdmin makes={makes} query={query} />
    </>
  );
}
