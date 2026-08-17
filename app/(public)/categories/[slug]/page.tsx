export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { buildCategorySearchPath } from "@/lib/navigation-paths";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = slug.trim()
    ? await db.category.findFirst({
        where: { slug, active: true },
        select: { slug: true },
      })
    : null;
  if (!category) notFound();

  redirect(buildCategorySearchPath(category.slug));
}
