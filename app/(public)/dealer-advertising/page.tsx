import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { db } from "@/lib/db";
import { buildCategorySearchPath } from "@/lib/navigation-paths";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Dealer advertising",
  description:
    "Dealer profiles and subscriptions on iTrader.im. Marketing measurement is optional and stays off until a visitor opts in.",
  path: "/dealer-advertising",
});

export default async function DealerAdvertisingPage() {
  const categories = await db.category.findMany({
    where: { active: true },
    select: { slug: true, name: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: "Dealer advertising", href: "/dealer-advertising" }]} />
      <h1 className="section-heading-accent text-2xl font-bold text-text-primary font-heading sm:text-3xl">
        Advertise as a dealer
      </h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          Dealers on iTrader.im can publish a public profile and stock. Subscription prices are on the{" "}
          <Link href="/pricing" className="text-text-trust hover:underline">pricing page</Link>.
          New dealers start at{" "}
          <Link href="/dealer/onboarding" className="text-text-trust hover:underline">dealer onboarding</Link>.
        </p>
        <p>
          Advertising measurement is a separate choice from site analytics. It stays off until a visitor opts in,
          and a preview deployment does not send events to a live advertising account.
        </p>
        <p>
          <Link href="/dealers" className="text-text-trust hover:underline">Browse dealers</Link>
          {" "}or{" "}
          <Link href="/sell-on-the-isle-of-man" className="text-text-trust hover:underline">
            read how private selling works
          </Link>.
        </p>
      </div>
      {categories.length > 0 ? (
        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link href={buildCategorySearchPath(category.slug)} className="text-text-trust hover:underline">
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
