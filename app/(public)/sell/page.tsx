export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CreateListingForm } from "./create-listing-form";

export const metadata: Metadata = {
  title: "Sell",
  description: "Create a listing on itrader.im.",
};

export default async function SellPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [categories, regions] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        attributeDefinitions: { orderBy: { sortOrder: "asc" } },
      },
    }),
    db.region.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-text-primary mb-2">
        Create a Listing
      </h1>
      <p className="text-text-secondary mb-8">
        Fill in the details below. After creating, you&apos;ll be taken to
        checkout to publish your listing for 30 days.
      </p>

      <CreateListingForm
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          attributes: c.attributeDefinitions.map((a) => ({
            id: a.id,
            name: a.name,
            slug: a.slug,
            dataType: a.dataType,
            required: a.required,
            options: a.options,
          })),
        }))}
        regions={regions.map((r) => ({
          id: r.id,
          name: r.name,
        }))}
      />
    </div>
  );
}
