export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Tag, Car } from "lucide-react";

export const metadata: Metadata = {
  title: "Categories",
  description: "Browse vehicle categories on itrader.im. Cars, vans, motorbikes.",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  car: <Car className="h-8 w-8" />,
  van: <Car className="h-8 w-8" />,
  motorbike: <Car className="h-8 w-8" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  car: "from-neon-red-500 to-neon-red-600",
  van: "from-neon-blue-500 to-neon-blue-600",
  motorbike: "from-premium-gold-500 to-premium-gold-600",
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
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-16 sm:px-6 lg:px-8">
      <div className="mb-8 sm:mb-12">
        <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
          Categories
        </h1>
        <p className="mt-3 sm:mt-4 text-text-secondary">
          Browse vehicle categories. Cars, vans, motorbikes.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const gradient = CATEGORY_COLORS[cat.slug] ?? "from-graphite-700 to-graphite-900";
          return (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 sm:p-8 text-white transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
              style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
              <div className="relative z-10">
                <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl bg-white/20 text-white mb-3 sm:mb-4">
                  {CATEGORY_ICONS[cat.slug] ?? <Tag className="h-6 w-6 sm:h-8 sm:w-8" />}
                </div>
                <h2 className="text-xl font-bold">
                  {cat.name}
                </h2>
                <p className="mt-1 text-sm text-white/80">
                  {cat._count.listings} listing{cat._count.listings !== 1 ? "s" : ""}
                </p>
                {cat.children.length > 0 && (
                  <p className="mt-3 text-xs text-white/60">
                    {cat.children.map((c) => c.name).join(", ")}
                  </p>
                )}
                <span className="mt-5 inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-graphite-950">
                  Browse
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {categories.length === 0 && (
        <p className="text-center text-text-secondary py-16">
          No categories available yet. Check back soon.
        </p>
      )}
    </div>
  );
}
