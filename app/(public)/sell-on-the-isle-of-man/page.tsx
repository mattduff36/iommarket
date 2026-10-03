import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { db } from "@/lib/db";
import { buildCategorySearchPath } from "@/lib/navigation-paths";
import { publicPageMetadata } from "@/lib/seo/page-metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: "Sell a vehicle on the Isle of Man",
  description:
    "How to advertise a car, van, motorbike or motorhome on iTrader.im. Listing prices are on the pricing page. Registration and import rules come from official Isle of Man sources.",
  path: "/sell-on-the-isle-of-man",
});

export default async function SellOnTheIsleOfManPage() {
  const categories = await db.category.findMany({
    where: { active: true },
    select: { slug: true, name: true },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: "Sell on the Isle of Man", href: "/sell-on-the-isle-of-man" }]} />
      <h1 className="section-heading-accent text-2xl font-bold text-text-primary font-heading sm:text-3xl">
        Sell a vehicle on the Isle of Man
      </h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          iTrader.im is a marketplace for cars, vans, motorbikes and motorhomes.
          Private sellers and dealers create their own listings. A listing can name a location in the Isle of Man or the United Kingdom.
        </p>
        <p>
          iTrader&apos;s own listing and dealer prices are published on the{" "}
          <Link href="/pricing" className="text-text-trust hover:underline">pricing page</Link>.
          Registration, import, duty and licensing rules are set by the relevant Isle of Man authorities.
          Check those official sources before you rely on them. This page does not state those fees.
        </p>
        <p>
          <Link href="/sell" className="text-text-trust hover:underline">Start a listing</Link>
          {" "}after you sign in. You can also{" "}
          <Link href="/dealer-advertising" className="text-text-trust hover:underline">advertise as a dealer</Link>.
        </p>
      </div>
      {categories.length > 0 ? (
        <ul className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link href={buildCategorySearchPath(category.slug)} className="text-text-trust hover:underline">
                {category.name} for sale
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
