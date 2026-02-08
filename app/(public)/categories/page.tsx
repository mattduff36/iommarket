export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Tag, Car, Anchor, Music, Camera, Speaker } from "lucide-react";

export const metadata: Metadata = {
  title: "Categories",
  description: "Browse marketplace categories on IOM Market.",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  vehicles: <Car className="h-8 w-8" />,
  marine: <Anchor className="h-8 w-8" />,
  instruments: <Music className="h-8 w-8" />,
  photography: <Camera className="h-8 w-8" />,
  "hifi-home-av": <Speaker className="h-8 w-8" />,
};

export default async function CategoriesPage() {
  const categories = await db.category.findMany({
    where: { active: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { listings: { where: { status: "LIVE" } } } },
      children: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-text-primary mb-8">
        Categories
      </h1>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="flex items-start gap-4 rounded-lg border border-border bg-surface p-6 transition-shadow hover:shadow-md"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-royal-50 text-royal-600">
              {CATEGORY_ICONS[cat.slug] ?? <Tag className="h-8 w-8" />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-text-primary">
                {cat.name}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {cat._count.listings} listing
                {cat._count.listings !== 1 ? "s" : ""}
              </p>
              {cat.children.length > 0 && (
                <p className="mt-2 text-xs text-text-tertiary">
                  {cat.children.map((c) => c.name).join(", ")}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>

      {categories.length === 0 && (
        <p className="text-center text-text-secondary py-16">
          No categories available yet. Check back soon.
        </p>
      )}
    </div>
  );
}
