import type { Metadata } from "next";
import Link from "next/link";
import { FaqExplorer } from "@/components/faq/faq-explorer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { FAQ_CATEGORIES } from "@/lib/faq/content";
import { buildCanonicalUrl } from "@/lib/seo/structured-data";

const title =
  "Frequently Asked Questions – Buying & Selling Vehicles on the Isle of Man";
const description =
  "Answers about buying and selling cars, vans, motorbikes and motorhomes on iTrader.im, including listings, pricing, dealers, payments and safety.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: buildCanonicalUrl("/faq") },
  openGraph: {
    description,
    url: buildCanonicalUrl("/faq"),
  },
};

export default function FaqPage() {
  return (
    <div className="mx-auto min-w-0 max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <Breadcrumbs
        items={[{ label: "Frequently Asked Questions", href: "/faq" }]}
      />
      <header className="max-w-3xl">
        <h1 className="section-heading-accent text-2xl font-bold text-text-primary font-heading sm:text-3xl">
          Frequently Asked Questions
        </h1>
        <p className="mt-4 text-sm leading-7 text-text-secondary sm:text-base">
          iTrader.im is an Isle of Man marketplace for cars, vans, motorbikes
          and motorhomes. These answers cover buying, selling, dealer accounts,
          vehicle listings, payments and using the site.
        </p>
      </header>

      <FaqExplorer categories={FAQ_CATEGORIES} />

      <section className="mt-12 rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-xl font-bold text-text-primary font-heading">
          Still have a question?
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
          Contact iTrader, browse the vehicles currently advertised, or start a
          listing.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button asChild variant="trust" size="sm">
            <Link href="/contact">Contact iTrader</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="border border-border">
            <Link href="/search">Browse vehicles</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="border border-border">
            <Link href="/sell">Sell a vehicle</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
