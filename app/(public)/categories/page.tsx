export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Tag, Car, Anchor, Music, Camera, Speaker } from "lucide-react";

export const metadata: Metadata = {
  title: "Categories",
  description: "Browse marketplace categories on itrader.im.",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  vehicles: <Car className="h-8 w-8" />,
  marine: <Anchor className="h-8 w-8" />,
  instruments: <Music className="h-8 w-8" />,
  photography: <Camera className="h-8 w-8" />,
  "hifi-home-av": <Speaker className="h-8 w-8" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  vehicles: "from-royal-700 to-royal-800",
  marine: "from-sky-500 to-sky-700",
  "hifi-home-av": "from-amber-400 to-amber-600",
  instruments: "from-emerald-500 to-emerald-700",
  photography: "from-rose-400 to-rose-600",
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
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mb-12">
        <h1 className="section-heading-accent text-3xl font-bold text-slate-900">
          Categories
        </h1>
        <p className="mt-4 text-slate-500">
          Browse all categories on itrader.im.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const gradient = CATEGORY_COLORS[cat.slug] ?? "from-slate-600 to-slate-800";
          return (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br p-8 text-white transition-all duration-200 hover:shadow-lg hover:scale-[1.02]"
              style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
              <div className="relative z-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20 text-white mb-4">
                  {CATEGORY_ICONS[cat.slug] ?? <Tag className="h-8 w-8" />}
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
                <span className="mt-5 inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-slate-900">
                  Browse
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {categories.length === 0 && (
        <p className="text-center text-slate-500 py-16">
          No categories available yet. Check back soon.
        </p>
      )}
    </div>
  );
}
